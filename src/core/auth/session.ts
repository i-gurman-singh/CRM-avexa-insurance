import '@/lib/server-guard';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { UnauthorizedError } from '@/lib/errors';
import { log } from '@/lib/logger';
import type { UserRole } from '@/lib/types';
import type { Actor } from '@/core/context';

const logger = log('auth:session');

/**
 * Session management.
 *
 * A short-lived signed JWT in an httpOnly, SameSite=Lax cookie. The token
 * carries only an id and a version marker; the role and permissions are read
 * from the database on every request, so revoking access or changing a role
 * takes effect immediately rather than at the next login.
 *
 * Why not Auth.js: at the time of writing, Auth.js v5 — the App Router–native
 * version — is still pre-release, and v4 predates the App Router. This module
 * is ~150 lines, has no third-party surface, and exposes an Auth.js-shaped API
 * (`auth()`, `signIn()`, `signOut()`) so migrating later is a contained change.
 * See docs/adr/0003-authentication.md.
 */

const COOKIE_NAME = 'crm_session';
const ISSUER = 'insurance-crm';

function secret(): Uint8Array {
  return new TextEncoder().encode(env.NEXTAUTH_SECRET);
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
  permissionOverrides: Record<string, boolean>;
}

interface TokenPayload {
  sub: string;
  email: string;
}

async function createToken(userId: string, email: string): Promise<string> {
  return new SignJWT({ email } satisfies Omit<TokenPayload, 'sub'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${env.SESSION_MAX_AGE}s`)
    .sign(secret());
}

async function readToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER });
    if (!payload.sub) return null;
    return { sub: payload.sub, email: String(payload.email ?? '') };
  } catch {
    return null;
  }
}

/**
 * Sign in with email and password.
 * Returns null on failure without saying which part was wrong — that
 * distinction is exactly what account enumeration attacks look for.
 */
export async function signIn(
  email: string,
  password: string,
  meta: { ipAddress?: string; userAgent?: string } = {},
): Promise<SessionUser | null> {
  const { verifyPassword } = await import('./passwords');
  const normalized = email.trim().toLowerCase();

  const user = await db.user.findUnique({ where: { email: normalized } });

  // Always run a comparison so timing does not reveal whether the account
  // exists.
  const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';
  const valid = await verifyPassword(password, hash);

  if (!user || !valid || !user.isActive) {
    logger.warn({ email: normalized, reason: !user ? 'no_user' : !valid ? 'bad_password' : 'inactive' }, 'Sign-in failed');
    await db.auditLog
      .create({
        data: {
          action: 'auth.signIn.failed',
          entityType: 'User',
          entityId: user?.id ?? null,
          metadata: { email: normalized } as object,
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
        },
      })
      .catch(() => undefined);
    return null;
  }

  const token = await createToken(user.id, user.email);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: env.SESSION_MAX_AGE,
  });

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await db.auditLog
    .create({
      data: {
        userId: user.id,
        action: 'auth.signIn',
        entityType: 'User',
        entityId: user.id,
        metadata: {} as object,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      },
    })
    .catch(() => undefined);

  logger.info({ userId: user.id }, 'User signed in');

  return toSessionUser(user);
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;

  if (token) {
    const payload = await readToken(token);
    if (payload) {
      await db.auditLog
        .create({
          data: {
            userId: payload.sub,
            action: 'auth.signOut',
            entityType: 'User',
            entityId: payload.sub,
            metadata: {} as object,
          },
        })
        .catch(() => undefined);
    }
  }

  store.delete(COOKIE_NAME);
}

/**
 * The current user, or null. Reads the database every call so role changes and
 * deactivations take effect immediately.
 */
export async function auth(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await readToken(token);
  if (!payload) return null;

  const user = await db.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) return null;

  return toSessionUser(user);
}

/** Throws when signed out. Use in server actions and API routes. */
export async function requireAuth(): Promise<SessionUser> {
  const user = await auth();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** The current user as an `Actor` for the core services. */
export async function currentActor(meta: { ipAddress?: string; userAgent?: string } = {}): Promise<Actor> {
  const user = await requireAuth();
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    permissionOverrides: user.permissionOverrides,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  };
}

/** Non-throwing variant for layouts that render a signed-out state. */
export async function optionalActor(): Promise<Actor | null> {
  const user = await auth();
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    permissionOverrides: user.permissionOverrides,
  };
}

function toSessionUser(user: {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
  permissionOverrides: unknown;
}): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl,
    permissionOverrides: (user.permissionOverrides ?? {}) as Record<string, boolean>,
  };
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

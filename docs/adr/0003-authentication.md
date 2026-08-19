# 3. Session auth in-house rather than Auth.js

**Status:** accepted

## Context

The plan was to use Auth.js (NextAuth). On implementation, the situation is:

- **v4** predates the App Router. It works, but awkwardly, and its session
  model does not fit server components well.
- **v5** — the App Router–native rewrite — is still published as a pre-release
  after a long beta.

The CRM needs email/password only. There is no OAuth provider, no social login,
no magic link. That is a small fraction of what Auth.js exists to do.

## Decision

A ~150-line session module (`src/core/auth/session.ts`): a signed JWT in an
`httpOnly` cookie via `jose`, bcrypt password hashing, and an Auth.js-shaped
API — `auth()`, `signIn()`, `signOut()`, `requireAuth()`.

## Reasoning

Taking a pre-release dependency for the single most security-sensitive part of
a system holding driver licence numbers is a poor trade when the requirement is
this narrow. The alternative is small enough to read in one sitting, has no
third-party surface, and behaves exactly as intended.

Keeping the function signatures Auth.js-shaped means migrating later — if
social login or SSO is ever wanted — is a contained change to one module rather
than a rewrite of every call site.

One property worth calling out: the token carries only a user id. Role and
permissions are read from the database on every request, so revoking access
takes effect immediately instead of at the next login. Several session
libraries encode the role into the token and inherit the opposite behaviour.

## Consequences

- Password reset by email is not included. Administrators set passwords
  directly, which suits a four-person team and does not scale beyond that.
- MFA is not included and should be added before this holds a large book.
- No dependency on a beta package for authentication.

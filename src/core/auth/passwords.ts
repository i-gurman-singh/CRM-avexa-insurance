import bcrypt from 'bcryptjs';

/**
 * Password hashing and strength rules.
 *
 * Cost 12 is a deliberate choice: ~250ms per hash on Lightsail's smaller
 * instances, which is slow enough to make offline cracking expensive and fast
 * enough that login does not feel broken.
 */

const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export interface PasswordCheck {
  ok: boolean;
  problems: string[];
}

/**
 * NIST-style rules: length matters most, arbitrary composition rules mostly
 * push people toward "Password1!". We require length and reject the obvious.
 */
export function checkPasswordStrength(password: string): PasswordCheck {
  const problems: string[] = [];

  if (password.length < 12) problems.push('Use at least 12 characters');
  if (password.length > 200) problems.push('That password is unreasonably long');
  if (/^\s|\s$/.test(password)) problems.push('Remove leading or trailing spaces');

  const lowered = password.toLowerCase();
  const common = [
    'password',
    'insurance',
    'welcome',
    'letmein',
    'qwerty',
    '12345678',
    'changeme',
    'admin123',
  ];
  if (common.some((c) => lowered.includes(c))) {
    problems.push('Avoid common words like "password" or "welcome"');
  }

  if (/^(.)\1+$/.test(password)) problems.push('Avoid repeating a single character');

  return { ok: problems.length === 0, problems };
}

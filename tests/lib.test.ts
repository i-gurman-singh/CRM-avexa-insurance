import { describe, expect, it } from 'vitest';
import { calculateAge, formatPhone, normalizePhone, percentage, slugify, toNumber } from '@/lib/utils';
import { can, permissionsFor, requiresHumanApproval, ROLE_PERMISSIONS } from '@/lib/rbac';
import { checkPasswordStrength } from '@/core/auth/passwords';
import { redactMetadata, changedFields } from '@/core/audit/service';

describe('phone normalisation', () => {
  it('accepts the formats people actually type', () => {
    for (const input of ['4165550123', '416-555-0123', '(416) 555-0123', '+1 416 555 0123', '14165550123']) {
      expect(normalizePhone(input)).toBe('+14165550123');
    }
  });

  it('keeps international numbers intact', () => {
    expect(normalizePhone('+447700900123')).toBe('+447700900123');
  });

  it('rejects nonsense rather than storing it', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it('formats Canadian numbers for display', () => {
    expect(formatPhone('+14165550123')).toBe('(416) 555-0123');
    expect(formatPhone(null)).toBe('—');
  });
});

describe('age calculation', () => {
  it('does not count a birthday that has not happened yet', () => {
    const at = new Date('2026-03-01T12:00:00Z');
    expect(calculateAge(new Date('2000-06-15'), at)).toBe(25);
    expect(calculateAge(new Date('2000-01-15'), at)).toBe(26);
  });

  it('handles the birthday itself', () => {
    const at = new Date('2026-06-15T12:00:00Z');
    expect(calculateAge(new Date('2000-06-15'), at)).toBe(26);
  });

  it('returns null rather than a wrong number', () => {
    expect(calculateAge(null)).toBeNull();
    expect(calculateAge('not a date')).toBeNull();
  });
});

describe('permissions', () => {
  it('gives administrators everything', () => {
    const perms = permissionsFor({ role: 'ADMINISTRATOR' });
    expect(perms.has('policies.bind')).toBe(true);
    expect(perms.has('settings.manage')).toBe(true);
  });

  it('keeps binding away from agents and assistants', () => {
    expect(can({ role: 'AGENT' }, 'policies.bind')).toBe(false);
    expect(can({ role: 'ASSISTANT' }, 'policies.bind')).toBe(false);
    expect(can({ role: 'BROKER' }, 'policies.bind')).toBe(true);
  });

  it('keeps raw document downloads away from assistants by default', () => {
    expect(can({ role: 'ASSISTANT' }, 'documents.download')).toBe(false);
    expect(can({ role: 'AGENT' }, 'documents.download')).toBe(true);
  });

  it('lets a per-user exception grant a permission the role lacks', () => {
    expect(can({ role: 'ASSISTANT', permissionOverrides: { 'documents.download': true } }, 'documents.download')).toBe(true);
  });

  it('lets a per-user exception revoke a permission the role grants', () => {
    expect(can({ role: 'BROKER', permissionOverrides: { 'policies.bind': false } }, 'policies.bind')).toBe(false);
  });

  it('ignores unknown permission strings in overrides', () => {
    const perms = permissionsFor({ role: 'AGENT', permissionOverrides: { 'not.a.permission': true } });
    expect(perms.has('not.a.permission' as never)).toBe(false);
  });

  it('names the regulated actions as human-only', () => {
    expect(requiresHumanApproval('policies.bind')).toBe(true);
    expect(requiresHumanApproval('underwriting.decision')).toBe(true);
    expect(requiresHumanApproval('clients.view')).toBe(false);
  });

  it('gives every role a non-empty permission set', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      expect(perms.length, `${role} has no permissions`).toBeGreaterThan(0);
    }
  });
});

describe('password strength', () => {
  it('requires meaningful length', () => {
    expect(checkPasswordStrength('short').ok).toBe(false);
    expect(checkPasswordStrength('correct horse battery staple').ok).toBe(true);
  });

  it('rejects the obvious choices', () => {
    expect(checkPasswordStrength('Password1234').ok).toBe(false);
    expect(checkPasswordStrength('welcome12345').ok).toBe(false);
    expect(checkPasswordStrength('aaaaaaaaaaaaaa').ok).toBe(false);
  });

  it('explains what is wrong', () => {
    expect(checkPasswordStrength('abc').problems.length).toBeGreaterThan(0);
  });
});

describe('audit redaction', () => {
  it('removes identity documents and financial numbers', () => {
    const redacted = redactMetadata({
      licenceNumber: 'S1234-56789-01234',
      vin: '1HGCM82633A004352',
      accountNumber: '1234567',
      clientName: 'Jane Doe',
    });

    expect(redacted.licenceNumber).toBe('[redacted]');
    expect(redacted.vin).toBe('[redacted]');
    expect(redacted.accountNumber).toBe('[redacted]');
    // Non-sensitive context survives so the log stays useful.
    expect(redacted.clientName).toBe('Jane Doe');
  });

  it('redacts inside nested objects', () => {
    const redacted = redactMetadata({ driver: { licenceNumber: 'ABC', name: 'Jane' } }) as {
      driver: Record<string, unknown>;
    };
    expect(redacted.driver.licenceNumber).toBe('[redacted]');
    expect(redacted.driver.name).toBe('Jane');
  });
});

describe('change detection', () => {
  it('reports only fields that actually changed', () => {
    const before = { name: 'Jane', city: 'Toronto', age: 30 };
    const after = { name: 'Jane', city: 'Brampton' };
    expect(changedFields(before, after)).toEqual(['city']);
  });

  it('compares dates by value, not identity', () => {
    const date = new Date('2026-01-01');
    expect(changedFields({ d: date }, { d: new Date('2026-01-01') })).toEqual([]);
    expect(changedFields({ d: date }, { d: new Date('2026-02-01') })).toEqual(['d']);
  });

  it('ignores undefined, so a partial update is not read as a clear', () => {
    expect(changedFields({ name: 'Jane' }, { name: undefined })).toEqual([]);
  });
});

describe('small helpers', () => {
  it('slugifies into stable keys', () => {
    expect(slugify('Gore Mutual')).toBe('gore_mutual');
    expect(slugify('  Price too high!  ')).toBe('price_too_high');
  });

  it('converts Prisma decimals without throwing', () => {
    expect(toNumber('475.50')).toBe(475.5);
    expect(toNumber(null)).toBeNull();
    expect(toNumber('not a number')).toBeNull();
  });

  it('does not divide by zero', () => {
    expect(percentage(5, 0)).toBe(0);
    expect(percentage(1, 4)).toBe(25);
  });
});

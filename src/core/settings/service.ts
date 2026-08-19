import '@/lib/server-guard';
import { db } from '@/lib/db';
import { log } from '@/lib/logger';
import { recordAudit } from '@/core/audit/service';
import { requirePermission, type AnyActor } from '@/core/context';
import { SETTING_LIST, SETTING_SPECS, type SettingKey, type SettingValue } from './defaults';

const logger = log('settings');

/**
 * Settings access.
 *
 * Values are cached in-process for a short window because they are read on
 * nearly every inbound message. The TTL is short enough that an admin change
 * takes effect within seconds without needing a cache-invalidation mechanism.
 */

const CACHE_TTL_MS = 15_000;
let cache: { values: Map<string, unknown>; expiresAt: number } | null = null;

async function loadAll(): Promise<Map<string, unknown>> {
  if (cache && cache.expiresAt > Date.now()) return cache.values;

  const values = new Map<string, unknown>();
  try {
    const rows = await db.setting.findMany();
    for (const row of rows) values.set(row.key, row.value);
  } catch (e) {
    // If the settings table is unreachable we fall back to defaults rather
    // than taking the whole CRM down.
    logger.error({ err: e }, 'Failed to load settings; using defaults');
  }

  cache = { values, expiresAt: Date.now() + CACHE_TTL_MS };
  return values;
}

export function invalidateSettingsCache() {
  cache = null;
}

/** Read one setting, falling back to its declared default. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const values = await loadAll();
  const stored = values.get(key);
  if (stored === undefined || stored === null) {
    return SETTING_SPECS[key].default as SettingValue<K>;
  }
  return stored as SettingValue<K>;
}

/** Read several settings at once — one cache hit instead of N. */
export async function getSettings<K extends SettingKey>(
  keys: K[],
): Promise<{ [P in K]: SettingValue<P> }> {
  const values = await loadAll();
  const out = {} as { [P in K]: SettingValue<P> };
  for (const key of keys) {
    const stored = values.get(key);
    out[key] = (stored === undefined || stored === null
      ? SETTING_SPECS[key].default
      : stored) as SettingValue<typeof key>;
  }
  return out;
}

/** Every setting with its current value — powers the Settings screen. */
export async function listSettings() {
  const values = await loadAll();
  return SETTING_LIST.map((spec) => ({
    ...spec,
    value: values.get(spec.key) ?? spec.default,
    isOverridden: values.has(spec.key),
  }));
}

export async function setSetting(
  actor: AnyActor,
  key: SettingKey,
  value: unknown,
): Promise<void> {
  requirePermission(actor, 'settings.manage');

  const spec = SETTING_SPECS[key];
  if (!spec) throw new Error(`Unknown setting: ${key}`);

  const coerced = coerce(value, spec.type);

  await db.setting.upsert({
    where: { key },
    create: {
      key,
      value: coerced as object,
      category: spec.category,
      label: spec.label,
      description: spec.description,
    },
    update: { value: coerced as object },
  });

  invalidateSettingsCache();

  await recordAudit({
    actor,
    action: 'setting.update',
    entityType: 'Setting',
    entityId: key,
    metadata: { key, value: coerced },
  });
}

/** Restore a setting to its shipped default. */
export async function resetSetting(actor: AnyActor, key: SettingKey): Promise<void> {
  requirePermission(actor, 'settings.manage');
  await db.setting.deleteMany({ where: { key } });
  invalidateSettingsCache();
  await recordAudit({ actor, action: 'setting.reset', entityType: 'Setting', entityId: key });
}

function coerce(value: unknown, type: string): unknown {
  switch (type) {
    case 'boolean':
      return value === true || value === 'true' || value === 1 || value === '1';
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) throw new Error('Expected a number');
      return n;
    }
    case 'string':
      return String(value ?? '');
    default:
      return value;
  }
}

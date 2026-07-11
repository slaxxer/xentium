import { prisma } from "../../infrastructure/db.js";
import { TtlCache } from "./memoTtl.js";

// Settings are read on hot paths (maintenanceGuard runs on every /api request)
// but change rarely, so reads are cached in-process. Writers in this process
// must call bustSettingsCache(); other processes (worker, replicas) converge
// within the TTL. Reads that must never be stale use getFreshSetting.
const TTL_MS = 15_000;

// A cached "no row for this key" — distinct from a stored null value.
const MISSING = Symbol("setting-missing");

const cache = new TtlCache<string, unknown>(TTL_MS);

/** Read a single setting, returning `defaultValue` if not set. Cached (~15s). */
export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit === MISSING ? defaultValue : (hit as T);
  return getFreshSetting(key, defaultValue);
}

/** Read a single setting straight from the DB, bypassing (but refreshing) the
 *  cache. For reads where TTL staleness is not acceptable — e.g. appearance
 *  tokens rebuilt right after a cross-process style publish. */
export async function getFreshSetting<T>(key: string, defaultValue: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  cache.set(key, row === null ? MISSING : row.value);
  if (row === null) return defaultValue;
  return (row.value as unknown) as T;
}

/** Batch read: pass `{ key: default }`, get every value resolved in a single
 *  query for the uncached keys. */
export async function getSettings<T extends Record<string, unknown>>(defaults: T): Promise<T> {
  const out: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const key of Object.keys(defaults)) {
    const hit = cache.get(key);
    if (hit === undefined) missing.push(key);
    else out[key] = hit === MISSING ? defaults[key] : hit;
  }

  if (missing.length > 0) {
    const rows = await prisma.setting.findMany({ where: { key: { in: missing } } });
    const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
    for (const key of missing) {
      const value = byKey.has(key) ? byKey.get(key) : MISSING;
      cache.set(key, value);
      out[key] = value === MISSING ? defaults[key] : value;
    }
  }

  return out as T;
}

/** Drop cached value(s) after a write. No key = clear everything (cheap, rare). */
export function bustSettingsCache(key?: string): void {
  if (key === undefined) cache.clear();
  else cache.delete(key);
}

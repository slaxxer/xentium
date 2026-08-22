import { TtlCache } from "./memoTtl.js";

/**
 * Where settings actually live. An application supplies this — the package must
 * not know the table's name, let alone that it is called `ncf_settings`.
 *
 * Two reads rather than one because the batch path exists specifically to
 * resolve many keys in a single query; collapsing it into repeated `get` calls
 * would silently reintroduce the N+1 it was written to remove.
 */
export interface SettingsStore {
  get(key: string): Promise<{ value: unknown } | null>;
  getMany(keys: string[]): Promise<{ key: string; value: unknown }[]>;
}

export interface SettingsOptions {
  /** In-process cache lifetime. Default 15s. */
  ttlMs?: number;
}

export interface Settings {
  /** Read a single setting, returning `defaultValue` if not set. Cached. */
  getSetting<T>(key: string, defaultValue: T): Promise<T>;
  /** Read straight from the store, bypassing (but refreshing) the cache. */
  getFreshSetting<T>(key: string, defaultValue: T): Promise<T>;
  /** Batch read: pass `{ key: default }`, one query for the uncached keys. */
  getSettings<T extends Record<string, unknown>>(defaults: T): Promise<T>;
  /** Drop cached value(s) after a write. No key = clear everything. */
  bustSettingsCache(key?: string): void;
}

/**
 * Settings are read on hot paths but change rarely, so reads are cached
 * in-process. Writers in this process MUST call `bustSettingsCache`; other
 * processes (a worker, a second replica) converge within the TTL. Reads where
 * staleness is unacceptable use `getFreshSetting`.
 */
export function createSettings(store: SettingsStore, opts: SettingsOptions = {}): Settings {
  const ttlMs = opts.ttlMs ?? 15_000;

  // A cached "no row for this key" — distinct from a stored null value, which is
  // a legitimate setting. Collapsing the two would make every unset key hit the
  // store on every read.
  const MISSING = Symbol("setting-missing");
  const cache = new TtlCache<string, unknown>(ttlMs);

  async function getFreshSetting<T>(key: string, defaultValue: T): Promise<T> {
    const row = await store.get(key);
    cache.set(key, row === null ? MISSING : row.value);
    if (row === null) return defaultValue;
    return row.value as T;
  }

  return {
    getFreshSetting,

    async getSetting<T>(key: string, defaultValue: T): Promise<T> {
      const hit = cache.get(key);
      if (hit !== undefined) return hit === MISSING ? defaultValue : (hit as T);
      return getFreshSetting(key, defaultValue);
    },

    async getSettings<T extends Record<string, unknown>>(defaults: T): Promise<T> {
      const out: Record<string, unknown> = {};
      const missing: string[] = [];

      for (const key of Object.keys(defaults)) {
        const hit = cache.get(key);
        if (hit === undefined) missing.push(key);
        else out[key] = hit === MISSING ? defaults[key] : hit;
      }

      if (missing.length > 0) {
        const rows = await store.getMany(missing);
        const byKey = new Map(rows.map((r) => [r.key, r.value]));
        for (const key of missing) {
          const value = byKey.has(key) ? byKey.get(key) : MISSING;
          cache.set(key, value);
          out[key] = value === MISSING ? defaults[key] : value;
        }
      }

      return out as T;
    },

    bustSettingsCache(key?: string): void {
      if (key === undefined) cache.clear();
      else cache.delete(key);
    },
  };
}

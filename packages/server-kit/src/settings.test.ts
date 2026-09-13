/**
 * The settings reader, tested without a database — which is the concrete payoff
 * of the extraction (ADR-0006). It previously reached for the Prisma singleton
 * at module scope, so exercising any of this meant standing up Postgres.
 *
 * Two behaviours carry the real risk:
 *
 *  - A stored `null` is a legitimate value and must stay distinct from "no row".
 *    Collapse them and every unset key hits the store on every read, quietly
 *    turning a cache into a pass-through on the hottest path in the app.
 *  - The batch read exists to resolve many keys in ONE query. If it stops
 *    querying only the uncached keys, it silently becomes an N+1.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSettings, type SettingsStore } from "./settings.js";

let rows: Record<string, unknown>;
let getCalls: string[];
let getManyCalls: string[][];

function store(): SettingsStore {
  return {
    get: vi.fn(async (key: string) => {
      getCalls.push(key);
      return key in rows ? { value: rows[key] } : null;
    }),
    getMany: vi.fn(async (keys: string[]) => {
      getManyCalls.push(keys);
      return keys.filter((k) => k in rows).map((k) => ({ key: k, value: rows[k] }));
    }),
  };
}

beforeEach(() => {
  rows = { "site.name": "Xentium", "site.tagline": null, "flags.beta": true };
  getCalls = [];
  getManyCalls = [];
});

describe("createSettings", () => {
  it("reads a value and falls back to the default when unset", async () => {
    const s = createSettings(store());
    await expect(s.getSetting("site.name", "fallback")).resolves.toBe("Xentium");
    await expect(s.getSetting("nope", "fallback")).resolves.toBe("fallback");
  });

  it("treats a stored null as a value, not as missing", async () => {
    const s = createSettings(store());
    // The default must NOT win here — someone deliberately stored null.
    await expect(s.getSetting("site.tagline", "a default")).resolves.toBeNull();
  });

  it("caches a miss, so an unset key does not hit the store twice", async () => {
    const s = createSettings(store());
    await s.getSetting("nope", 1);
    await s.getSetting("nope", 1);
    expect(getCalls).toEqual(["nope"]);
  });

  it("serves later reads from cache", async () => {
    const s = createSettings(store());
    await s.getSetting("site.name", "");
    await s.getSetting("site.name", "");
    expect(getCalls).toEqual(["site.name"]);
  });

  it("bypasses the cache on getFreshSetting, and refreshes it", async () => {
    const s = createSettings(store());
    await s.getSetting("site.name", "");
    rows["site.name"] = "Renamed";

    await expect(s.getSetting("site.name", "")).resolves.toBe("Xentium");        // still cached
    await expect(s.getFreshSetting("site.name", "")).resolves.toBe("Renamed");  // straight through
    await expect(s.getSetting("site.name", "")).resolves.toBe("Renamed");       // cache updated
  });

  it("batches only the keys it does not already have", async () => {
    const s = createSettings(store());
    await s.getSetting("site.name", "");

    const out = await s.getSettings({ "site.name": "", "flags.beta": false, "missing.key": "dflt" });
    expect(out).toEqual({ "site.name": "Xentium", "flags.beta": true, "missing.key": "dflt" });
    // "site.name" was already cached and must not be re-queried.
    expect(getManyCalls).toEqual([["flags.beta", "missing.key"]]);
  });

  it("busts one key, or all of them", async () => {
    const s = createSettings(store());
    await s.getSetting("site.name", "");
    await s.getSetting("flags.beta", false);

    s.bustSettingsCache("site.name");
    await s.getSetting("site.name", "");
    await s.getSetting("flags.beta", false);
    expect(getCalls).toEqual(["site.name", "flags.beta", "site.name"]);

    s.bustSettingsCache();
    await s.getSetting("flags.beta", false);
    expect(getCalls).toEqual(["site.name", "flags.beta", "site.name", "flags.beta"]);
  });

  it("expires entries after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const s = createSettings(store(), { ttlMs: 1_000 });
      await s.getSetting("site.name", "");
      vi.advanceTimersByTime(1_500);
      await s.getSetting("site.name", "");
      expect(getCalls).toEqual(["site.name", "site.name"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

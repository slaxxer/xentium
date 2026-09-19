/**
 * "Is there a newer Xentium?" — the check every install makes, connected or not.
 *
 * Two properties are worth more than the shape of the cache:
 *
 *  • It asks ANONYMOUSLY. The plugin heartbeat returns early without an account
 *    token, correctly — there are no entitlements to ask about. An install that
 *    never connected an account is also the one most likely to be running an
 *    un-patched forum, so if the core check lived inside that function the sites
 *    that most need a security release would be the only ones never told.
 *  • The acknowledgement anchor only moves when the OFFER changes. Re-checking
 *    daily and finding the same release must not re-nudge an admin who has
 *    already looked, or the dialog becomes noise and stops being read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const world = {
  setting: null as { key: string; value: string } | null,
  fetched: [] as string[],
  response: null as unknown,
  status: 200,
};

vi.mock("../infrastructure/db.js", () => ({
  prisma: {
    setting: {
      findUnique: async () => world.setting,
      upsert: async ({ create, update }: { create: { key: string; value: string }; update: { value: string } }) => {
        world.setting = world.setting
          ? { ...world.setting, value: update.value }
          : { key: create.key, value: create.value };
        return world.setting;
      },
    },
  },
}));

vi.mock("../config/env.js", () => ({
  env: { LICENSE_SERVER_URL: "https://plugins.example.org/api/v1" },
}));

vi.mock("../config/version.js", () => ({ XENTIUM_VERSION: "1.0.0" }));
vi.mock("../shared/utils/settings.js", () => ({ bustSettingsCache: () => {} }));
vi.mock("../infrastructure/logging/logger.js", () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
}));

const { processCoreUpdateCheck, readCoreUpdateCache } = await import("./coreUpdateCheck.js");

const release = (version: string, severity = "normal") => ({
  version, severity, publishedAt: "2026-01-01T00:00:00.000Z",
  notes: null, upgradeNotes: null, minUpgradeFrom: null,
});

beforeEach(() => {
  world.setting = null;
  world.fetched = [];
  world.status = 200;
  world.response = {
    latest: release("1.2.0"), updateAvailable: true,
    path: [release("1.1.0"), release("1.2.0")],
    highestSeverity: "normal", patch: null, via: null,
  };
  vi.stubGlobal("fetch", async (url: string) => {
    world.fetched.push(String(url));
    return { ok: world.status === 200, status: world.status, json: async () => world.response };
  });
});

describe("the request", () => {
  it("sends the version we are on and nothing else — no token, no site id", async () => {
    await processCoreUpdateCheck();

    expect(world.fetched).toHaveLength(1);
    const url = new URL(world.fetched[0]!);
    expect(url.pathname).toBe("/api/v1/core/latest");
    expect(url.searchParams.get("from")).toBe("1.0.0");
    expect(url.searchParams.get("channel")).toBe("stable");
    // Nothing that identifies this install.
    expect([...url.searchParams.keys()].sort()).toEqual(["channel", "from"]);
  });
});

describe("the cache", () => {
  it("records what came back", async () => {
    await processCoreUpdateCheck();

    const cache = await readCoreUpdateCache();
    expect(cache?.current).toBe("1.0.0");
    expect(cache?.latest?.version).toBe("1.2.0");
    expect(cache?.updateAvailable).toBe(true);
    expect(cache?.path).toHaveLength(2);
  });

  it("keeps the anchor while the same release is still on offer", async () => {
    await processCoreUpdateCheck();
    const first = (await readCoreUpdateCache())!.setSince;

    await new Promise((r) => setTimeout(r, 5));
    await processCoreUpdateCheck();
    const second = (await readCoreUpdateCache())!;

    expect(second.setSince).toBe(first);       // an admin who looked stays acknowledged
    expect(second.checkedAt).not.toBe(first);  // but we did check again
  });

  it("moves the anchor when a newer release appears", async () => {
    await processCoreUpdateCheck();
    const first = (await readCoreUpdateCache())!.setSince;

    world.response = {
      latest: release("1.3.0", "security"), updateAvailable: true,
      path: [release("1.3.0", "security")], highestSeverity: "security", patch: null, via: null,
    };
    // The anchor is a timestamp, so two checks inside the same millisecond
    // produce the same string however different the offers are.
    await new Promise((r) => setTimeout(r, 5));
    await processCoreUpdateCheck();

    const second = (await readCoreUpdateCache())!;
    expect(second.setSince).not.toBe(first);
    expect(second.highestSeverity).toBe("security");
  });
});

describe("when the marketplace cannot be reached", () => {
  it("keeps yesterday's answer instead of clearing it", async () => {
    await processCoreUpdateCheck();
    const before = await readCoreUpdateCache();

    world.status = 503;
    await expect(processCoreUpdateCheck()).resolves.toBeUndefined();

    expect(await readCoreUpdateCache()).toEqual(before);
  });

  it("never throws — a failed check must not take the daily job down with it", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("getaddrinfo ENOTFOUND"); });
    await expect(processCoreUpdateCheck()).resolves.toBeUndefined();
  });
});

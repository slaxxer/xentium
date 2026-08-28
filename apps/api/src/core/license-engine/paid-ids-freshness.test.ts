/**
 * `ensurePaidPluginIdsFresh` — the sync clock behind the enable gate.
 *
 * `marketplace.paid_plugin_ids` decides whether a plugin needs a licence AT
 * ALL, and it used to be written from exactly two places: a plugin upload and
 * the daily heartbeat. Neither happens when an operator lists a new paid plugin
 * and a customer buys it ten minutes later, so that plugin was un-gated on
 * every install in the field until each one's next heartbeat — up to 24 hours.
 *
 * The TTL is what closes that window, and the answers it returns are what let
 * the gate tell "we asked recently" apart from "we have never been able to ask".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const world = {
  row:        null as { updatedAt: Date } | null,
  reachable:  true,
  pages:      [] as { data: { id: string; licenseRequired: boolean }[]; meta: { totalPages: number } }[],
};

const upsert = vi.fn(async (_args: { create: { value: string[] } }) => ({}));
const protocolFetch = vi.fn(async ({ query }: any) => {
  if (!world.reachable) throw new Error("unreachable");
  const page = Number(query?.page ?? 1);
  return world.pages[page - 1] ?? { data: [], meta: { totalPages: world.pages.length || 1 } };
});

vi.mock("../../infrastructure/db.js", () => ({
  prisma: {
    setting: {
      findUnique: async () => world.row,
      get upsert() { return upsert; },
    },
  },
}));

vi.mock("./protocol-client.js", () => ({
  SOURCE_ID: "nodevo.io",
  K_REF: "ref", K_AT: "at",
  clearIdentity: async () => {},
  getAccountToken: async () => "tok",
  getOrCreateKeypair: async () => ({ privateKeyPem: "", publicKeyB64: "" }),
  setAccountToken: async () => {},
  readSetting: async () => null,
  writeSetting: async () => {},
  marketplaceWebUrl: (p = "/") => `https://marketplace.example${p}`,
  get protocolFetch() { return protocolFetch; },
}));

vi.mock("./license-engine.js", () => ({ deactivateAccountLicenses: async () => 0 }));
vi.mock("./site-identity.js", () => ({
  getSiteDomain: async () => "example.test",
  getSiteId: async () => "site",
  resolveEnvironment: async () => "production",
}));
vi.mock("../../shared/utils/settings.js", () => ({ bustSettingsCache: () => {} }));

const { marketplaceSource } = await import("./marketplace-source.js");

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

beforeEach(() => {
  world.row = null;
  world.reachable = true;
  world.pages = [{ data: [{ id: "nodevo-forum", licenseRequired: true }], meta: { totalPages: 1 } }];
  upsert.mockClear();
  protocolFetch.mockClear();
});

describe("ensurePaidPluginIdsFresh", () => {
  it("does not call the marketplace when the set was synced recently", async () => {
    world.row = { updatedAt: minutesAgo(1) };
    await expect(marketplaceSource.ensurePaidPluginIdsFresh()).resolves.toBe("fresh");
    expect(protocolFetch).not.toHaveBeenCalled();
  });

  it("re-syncs a set older than the TTL", async () => {
    world.row = { updatedAt: minutesAgo(60) };
    await expect(marketplaceSource.ensurePaidPluginIdsFresh()).resolves.toBe("fresh");
    expect(protocolFetch).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("syncs when no set has ever been written", async () => {
    await expect(marketplaceSource.ensurePaidPluginIdsFresh()).resolves.toBe("fresh");
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("reports `stale` — not `never` — when a cached set survives an outage", async () => {
    // The distinction is the whole point: a set that was once fetched still says
    // something about which ids are paid, so the gate keeps using it. Reporting
    // `never` here would push the gate onto the manifest flag and start refusing
    // free plugins the moment the marketplace hiccups.
    world.row = { updatedAt: minutesAgo(60) };
    world.reachable = false;
    await expect(marketplaceSource.ensurePaidPluginIdsFresh()).resolves.toBe("stale");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reports `never` when it has no set and cannot fetch one", async () => {
    world.reachable = false;
    await expect(marketplaceSource.ensurePaidPluginIdsFresh()).resolves.toBe("never");
  });

  it("does not overwrite a good set with a partial walk", async () => {
    // A catalogue that dies on page 2 would otherwise cache page 1 alone, and
    // everything that fell off the end silently stops needing a licence.
    world.pages = [
      { data: [{ id: "a", licenseRequired: true }], meta: { totalPages: 2 } },
    ];
    protocolFetch.mockImplementation(async ({ query }: any) => {
      if (Number(query?.page) === 2) throw new Error("unreachable");
      return world.pages[0]!;
    });
    await expect(marketplaceSource.ensurePaidPluginIdsFresh()).resolves.toBe("never");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("caches only the ids the catalogue marks paid", async () => {
    world.pages = [{
      data: [
        { id: "paid-one", licenseRequired: true },
        { id: "free-one", licenseRequired: false },
      ],
      meta: { totalPages: 1 },
    }];
    await marketplaceSource.ensurePaidPluginIdsFresh();
    expect(upsert.mock.calls[0]![0]).toMatchObject({ create: { value: ["paid-one"] } });
  });
});

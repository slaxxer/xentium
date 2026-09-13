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

const upsert = vi.fn(async (_args: { where: { key: string }; create: { value: string[] } }) => ({}));
/** The default catalogue: honours `world.reachable` and serves `world.pages`.
 *  ⚠ Restored in `beforeEach` — one test below swaps in a walk that dies on page
 *  two, and `mockClear` keeps the implementation, so without this every later
 *  test in the file inherits it and an "unreachable" world answers happily. */
const catalogue = async ({ query }: any) => {
  if (!world.reachable) throw new Error("unreachable");
  const page = Number(query?.page ?? 1);
  return world.pages[page - 1] ?? { data: [], meta: { totalPages: world.pages.length || 1 } };
};

const protocolFetch = vi.fn(catalogue);

vi.mock("../../infrastructure/db.js", () => ({
  prisma: {
    setting: {
      findUnique: async () => world.row,
      get upsert() { return upsert; },
    },
  },
}));

vi.mock("./protocol-client.js", () => ({
  SOURCE_ID: "xentium.org",
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
  world.pages = [{ data: [{ id: "xentium-forum", licenseRequired: true }], meta: { totalPages: 1 } }];
  upsert.mockClear();
  protocolFetch.mockClear();
  protocolFetch.mockImplementation(catalogue);
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

  /**
   * The catalogue sells themes as well as plugins, and this set is read by the
   * PLUGIN enable gate — `pluginRequiresLicense` asks "is this id in the paid
   * set?" and has no idea what kind the id belongs to. A walk that stopped
   * naming its kind would fill the set with paid theme ids, and every one of
   * them would then be a plugin the gate believes needs a licence.
   *
   * It is a silent failure in the direction that matters least on day one and
   * most later: nothing breaks until a theme and a plugin share an id, or until
   * something else starts reading the set.
   */
  it("walks ONLY the plugin half of the catalogue", async () => {
    await marketplaceSource.ensurePaidPluginIdsFresh();
    for (const [args] of protocolFetch.mock.calls) {
      expect((args as { query?: { kind?: string } }).query?.kind).toBe("plugin");
    }
  });
});

/**
 * The theme half. Same walk, DIFFERENT KEY — and that separation is the whole
 * design, not an implementation detail.
 *
 * `marketplace.paid_plugin_ids` is what the enable gate reads to decide whether
 * code may run. `marketplace.paid_theme_ids` is read by the ACP (buy vs install)
 * and by the download pre-check, and by nothing that renders — a theme has no
 * runtime and never gets checked again once it is on disk. Merging the two sets
 * would hand theme ids to the gate; writing one walk's result under the other's
 * key would do it silently.
 */
describe("paid THEME ids", () => {
  it("walks only the theme half of the catalogue", async () => {
    await marketplaceSource.refreshPaidThemeIds();
    expect(protocolFetch).toHaveBeenCalled();
    for (const [args] of protocolFetch.mock.calls) {
      expect((args as { query?: { kind?: string } }).query?.kind).toBe("theme");
    }
  });

  it("writes its own setting key, never the plugin one", async () => {
    await marketplaceSource.refreshPaidThemeIds();
    expect(upsert.mock.calls[0]![0].where.key).toBe("marketplace.paid_theme_ids");
  });

  it("leaves the plugin key to the plugin walk", async () => {
    await marketplaceSource.refreshPaidPluginIds();
    expect(upsert.mock.calls[0]![0].where.key).toBe("marketplace.paid_plugin_ids");
  });

  it("keeps a cached theme set through an outage, like the plugin set does", async () => {
    world.row = { updatedAt: minutesAgo(60) };
    world.reachable = false;
    await expect(marketplaceSource.ensurePaidIdsFresh("theme")).resolves.toBe("stale");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reports `never` with no set and no marketplace", async () => {
    world.reachable = false;
    await expect(marketplaceSource.ensurePaidIdsFresh("theme")).resolves.toBe("never");
  });
});

/**
 * The other caller of the same walk. The ACP browse list asks for one half at a
 * time, and a request that named no kind would mix themes into the plugin grid.
 */
describe("listPlugins", () => {
  it("asks the catalogue for the kind it was given", async () => {
    await marketplaceSource.listPlugins({ page: 1, limit: 20, order: "desc", kind: "theme" });
    expect(protocolFetch.mock.calls[0]![0].query).toMatchObject({ kind: "theme" });
  });

  it("defaults to plugins, which is the grid this page has always shown", async () => {
    await marketplaceSource.listPlugins({ page: 1, limit: 20, order: "desc" });
    expect(protocolFetch.mock.calls[0]![0].query).toMatchObject({ kind: "plugin" });
  });
});

/**
 * `assertThemeDownloadAllowed` — the ONLY licence check a theme ever gets.
 *
 * A theme is data. It has no runtime, so there is no code in it to check a
 * licence, and once the file is on disk the pages it arranged are already
 * arranged. That is a known, accepted property of selling themes (ADR-0001 /
 * §53): the authenticated download is the chokepoint, and NO runtime theme
 * licence check may ever be built.
 *
 * Which makes this function's job unusually narrow, and its failure mode
 * unusually easy to reach: the marketplace's `/downloads/authorize` is the
 * authority, and this runs BEFORE it only to replace a deliberately vague 404
 * ("no such release, or it is not available to this account") with a sentence
 * naming the theme and where to buy it. So every test here is really the same
 * assertion — it may add a refusal the real gate would also make, and it may
 * never withhold something the gate would hand over.
 *
 * The seat case is the one that catches people. Activation spends a seat;
 * DOWNLOADING does not, and `/downloads/authorize` never looks at one. An
 * account whose production seats are all spent elsewhere therefore holds no
 * entitlement grant for the theme and still downloads it perfectly well — so
 * reading "no grant" as "no licence" invents a rule the marketplace does not
 * have.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XEC } from "@xentium/contracts";

const world = {
  freshness:   "fresh" as "fresh" | "stale" | "never",
  paidThemes:  [] as string[],
  paidPlugins: [] as string[],
  /** Grants in the stored entitlement JWT, verbatim — `<kind>.<id>`. */
  grants:      [] as string[],
  token:       null as string | null,
  owned:       [] as any[],
  ownedThrows: false,
};

const ensurePaidIdsFresh = vi.fn(async (_kind: string) => world.freshness);
const listOwned = vi.fn(async () => {
  if (world.ownedThrows) throw new Error("marketplace unreachable");
  return world.owned;
});

vi.mock("./marketplace-source.js", () => ({
  marketplaceSource: {
    get ensurePaidIdsFresh() { return ensurePaidIdsFresh; },
    get listOwned() { return listOwned; },
  },
}));

vi.mock("../../shared/utils/settings.js", () => ({
  getSetting: async (key: string, fallback: unknown) =>
    key === "marketplace.paid_theme_ids"  ? world.paidThemes  :
    key === "marketplace.paid_plugin_ids" ? world.paidPlugins : fallback,
}));

vi.mock("./protocol-client.js", () => ({
  getAccountToken: async () => world.token,
  // refreshLicense() must never reach the network in these tests.
  protocolFetch: async () => { throw new Error("offline"); },
  marketplaceWebUrl: (path = "/") => `https://marketplace.example${path}`,
}));

vi.mock("./site-identity.js", () => ({
  getSiteDomain:      async () => "example.test",
  getSiteId:          async () => "11111111-2222-3333-4444-555555555555",
  resolveEnvironment: async () => "production",
}));

// A stored entitlement exists whenever `world.grants` is non-empty. The JWT is
// never really verified here — `verifyEntitlementJwt` is stubbed below — so the
// grants list is read straight out of the world.
vi.mock("../../infrastructure/db.js", () => ({
  prisma: {
    entitlement: {
      findFirst: async () =>
        world.grants.length
          ? { entitlementJwt: "stub", domain: "example.test", status: "active", activatedAt: new Date(), expiresAt: null, refreshAfter: null }
          : null,
    },
    installedPlugin: { findUnique: async () => null },
  },
}));

vi.mock("jose", () => ({
  importSPKI: async () => ({}),
  jwtVerify:  async () => ({ payload: { entitlements: world.grants.map((id) => ({ id })), domain: "example.test" } }),
}));

const { assertThemeDownloadAllowed } = await import("./license-engine.js");

/** The refusal, or `null` when the download was allowed to proceed. */
async function refusalFor(id = "aurora-dark", name = "Aurora Dark") {
  try {
    await assertThemeDownloadAllowed(id, name);
    return null;
  } catch (err) {
    return err as { code: string; httpStatus: number; message: string };
  }
}

const licence = (over: Record<string, unknown> = {}) => ({
  keyRef: "NDV-1", status: "active", seats: 1, seatsUsed: 1, activeHere: false,
  updatesUntil: null, purchasedAt: "2026-01-01",
  product: { id: "aurora-dark", kind: "theme", name: "Aurora Dark", vendor: "v", summary: null, latestVersion: "1.0.0", latestReleasedAt: null },
  ...over,
});

beforeEach(() => {
  world.freshness = "fresh";
  world.paidThemes = ["aurora-dark"];
  world.paidPlugins = [];
  world.grants = [];
  world.token = "acct-token";
  world.owned = [];
  world.ownedThrows = false;
  ensurePaidIdsFresh.mockClear();
  listOwned.mockClear();
});

describe("when it must say nothing at all", () => {
  it("lets a FREE theme through without asking anyone anything", async () => {
    world.paidThemes = [];
    expect(await refusalFor()).toBeNull();
    expect(listOwned).not.toHaveBeenCalled();
  });

  it("stays out of the way when no paid-id set has ever been fetched", async () => {
    // `never` means this install has never reached the marketplace, so "not in
    // the set" carries no information whatsoever. Refusing on it would block an
    // offline-until-now install from its first legitimate download.
    world.freshness = "never";
    world.paidThemes = [];
    expect(await refusalFor()).toBeNull();
  });

  it("asks the THEME set, not the plugin one", async () => {
    // The plugin set feeds the enable gate and must never be consulted about a
    // theme — a shared set is how theme ids end up gating plugins.
    world.paidThemes = [];
    world.paidPlugins = ["aurora-dark"];
    expect(await refusalFor()).toBeNull();
    expect(ensurePaidIdsFresh).toHaveBeenCalledWith("theme");
  });
});

describe("the entitlement is a fast yes, never a no", () => {
  it("allows a theme the stored entitlement already grants, with no round trip", async () => {
    world.grants = ["theme.aurora-dark"];
    expect(await refusalFor()).toBeNull();
    expect(listOwned).not.toHaveBeenCalled();
  });

  it("does not accept a PLUGIN grant of the same id", async () => {
    // Grants are keyed `<kind>.<id>`; owning the forum plugin says nothing about
    // a theme that happens to share its id.
    world.grants = ["plugin.aurora-dark"];
    world.owned = [];
    expect(await refusalFor()).not.toBeNull();
  });

  it("⚠ allows a licence held with every SEAT spent elsewhere", async () => {
    // THE invariant. No seat means no activation means no grant — and
    // `/downloads/authorize` does not look at seats at all, only at the licence
    // row. Refusing here would be this pre-check inventing a rule.
    world.grants = [];
    world.owned = [licence({ seats: 1, seatsUsed: 1, activeHere: false })];
    expect(await refusalFor()).toBeNull();
  });

  it("allows a licence in the `expiring` grace state", async () => {
    world.owned = [licence({ status: "expiring" })];
    expect(await refusalFor()).toBeNull();
  });

  it("proceeds to the real gate when the marketplace cannot be asked", async () => {
    // Being offline is not proof of anything about ownership, and the download
    // is about to fail on its own if the account really has no licence.
    world.ownedThrows = true;
    expect(await refusalFor()).toBeNull();
  });
});

describe("the refusals it is allowed to make", () => {
  it("names the theme and where to buy it when the account owns nothing", async () => {
    world.owned = [];
    const err = await refusalFor();
    expect(err?.code).toBe(XEC.LICENSE_NOT_FOUND);
    expect(err?.httpStatus).toBe(402);
    expect(err?.message).toContain("Aurora Dark");
    expect(err?.message).toContain("https://marketplace.example/themes/aurora-dark");
  });

  it("asks an unconnected install to connect its account, not to buy again", async () => {
    world.token = null;
    const err = await refusalFor();
    expect(err?.code).toBe(XEC.LICENSE_ACCOUNT_REQUIRED);
    expect(err?.message).toMatch(/Connect your marketplace account/);
  });

  it("says renew — and that what is installed keeps working — for a lapsed licence", async () => {
    world.owned = [licence({ status: "expired" })];
    const err = await refusalFor();
    expect(err?.code).toBe(XEC.LICENSE_EXPIRED);
    expect(err?.message).toMatch(/keeps working/);
  });

  it("does not mistake a licence for another theme as this one", async () => {
    world.owned = [licence({ product: { ...licence().product, id: "midnight" } })];
    expect(await refusalFor()).not.toBeNull();
  });

  it("does not mistake a PLUGIN licence of the same id as this theme", async () => {
    world.owned = [licence({ product: { ...licence().product, kind: "plugin" } })];
    expect(await refusalFor()).not.toBeNull();
  });
});

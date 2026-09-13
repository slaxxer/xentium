/**
 * `assertPluginEnableAllowed` — the decision that turns a paid plugin on.
 *
 * The gate this replaced was wrong in three ways that all LOOKED the same from
 * the ACP, which is why they survived so long:
 *
 *   • the set that decides "is this id paid" was refreshed only by a plugin
 *     upload and the daily heartbeat, so a newly listed paid plugin was
 *     un-gated on every install for up to a day;
 *   • a plugin bought since the last entitlement refresh was refused, because
 *     the gate read the stored JWT and never asked the marketplace;
 *   • every refusal printed "Activate a license in ACP → Extensions → License",
 *     including to an admin whose licence was active and whose seats were all
 *     spent on other installs — advice that sends them in a circle.
 *
 * Each test below is one of those. The messages are asserted on because the
 * message IS the feature here: a 402 that names the wrong remedy is the bug.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XEC } from "@xentium/contracts";

// ── the world the gate reads ────────────────────────────────────────────────

const world = {
  freshness:  "fresh" as "fresh" | "stale" | "never",
  paidIds:    [] as string[],
  token:      null as string | null,
  manifestLicenseRequired: false,
  owned:      [] as any[],
  ownedThrows: false,
};

const ensurePaidPluginIdsFresh = vi.fn(async () => world.freshness);
const listOwned = vi.fn(async () => {
  if (world.ownedThrows) throw new Error("marketplace unreachable");
  return world.owned;
});

vi.mock("./marketplace-source.js", () => ({
  marketplaceSource: {
    get ensurePaidPluginIdsFresh() { return ensurePaidPluginIdsFresh; },
    get listOwned() { return listOwned; },
  },
}));

vi.mock("../../shared/utils/settings.js", () => ({
  getSetting: async (key: string, fallback: unknown) =>
    (key === "marketplace.paid_plugin_ids" ? world.paidIds : fallback),
}));

vi.mock("./protocol-client.js", () => ({
  getAccountToken: async () => world.token,
  // No license row exists in any of these tests, so refreshLicense() falls
  // through to activateFromAccount(), which must not reach the network.
  protocolFetch: async () => { throw new Error("offline"); },
  marketplaceWebUrl: (path = "/") => `https://marketplace.example${path}`,
}));

vi.mock("./site-identity.js", () => ({
  getSiteDomain:      async () => "example.test",
  getSiteId:          async () => "11111111-2222-3333-4444-555555555555",
  resolveEnvironment: async () => "production",
}));

vi.mock("../../infrastructure/db.js", () => ({
  prisma: {
    entitlement: { findFirst: async () => null },
    installedPlugin: {
      findUnique: async () => ({ licenseRequired: world.manifestLicenseRequired }),
    },
  },
}));

const { assertPluginEnableAllowed } = await import("./license-engine.js");

/** The refusal, or `null` when the gate allowed the enable. */
async function refusalFor(id = "xentium-forum", name = "Forum") {
  try {
    await assertPluginEnableAllowed(id, name);
    return null;
  } catch (err) {
    return err as { code: string; httpStatus: number; message: string };
  }
}

beforeEach(() => {
  world.freshness = "fresh";
  world.paidIds = [];
  world.token = null;
  world.manifestLicenseRequired = false;
  world.owned = [];
  world.ownedThrows = false;
  ensurePaidPluginIdsFresh.mockClear();
  listOwned.mockClear();
});

describe("what counts as paid", () => {
  it("re-syncs the paid-id set before reading it", async () => {
    // THE regression guard. The set used to be written only on upload and on
    // the daily heartbeat, so this call is the whole fix: without it a plugin
    // listed as paid this morning enables freely until tomorrow.
    await refusalFor();
    expect(ensurePaidPluginIdsFresh).toHaveBeenCalledOnce();
  });

  it("lets a plugin the marketplace does not sell through", async () => {
    world.paidIds = ["something-else"];
    expect(await refusalFor()).toBeNull();
  });

  it("ignores a free plugin's manifest claim that it needs a licence", async () => {
    // The by-id design deliberately does not trust the manifest, which an
    // uploaded package controls. A `true` here must not gate a plugin the
    // marketplace does not sell — otherwise any package could demand a licence.
    world.manifestLicenseRequired = true;
    expect(await refusalFor()).toBeNull();
  });
});

describe("when the set has never been fetched", () => {
  beforeEach(() => { world.freshness = "never"; });

  it("still allows a plugin that does not claim to need a licence", async () => {
    expect(await refusalFor()).toBeNull();
  });

  it("refuses one that does, and says the marketplace could not be asked", async () => {
    // With no set ever fetched, "not in the set" carries no information, so the
    // manifest is the only signal left. It may add caution and never remove it:
    // trusting a `false` would reopen the repackage-as-free hole.
    world.manifestLicenseRequired = true;
    const err = await refusalFor();
    expect(err?.code).toBe(XEC.LICENSE_SOURCE_UNREACHABLE);
    expect(err?.message).toMatch(/could not be reached/i);
  });
});

describe("refusing a paid plugin, accurately", () => {
  beforeEach(() => { world.paidIds = ["xentium-forum"]; });

  it("asks for an account when none is connected", async () => {
    const err = await refusalFor();
    expect(err?.code).toBe(XEC.LICENSE_ACCOUNT_REQUIRED);
    expect(err?.message).toMatch(/Connect your marketplace account/i);
    expect(listOwned).not.toHaveBeenCalled();
  });

  it("says the account does not own it, and where to buy it", async () => {
    world.token = "tok";
    const err = await refusalFor();
    expect(err?.code).toBe(XEC.LICENSE_NOT_FOUND);
    expect(err?.message).toContain("https://marketplace.example/plugins/xentium-forum");
  });

  it("names seat exhaustion instead of telling the admin to activate", async () => {
    // The case the old message hid completely. The licence IS active and there
    // is nothing to activate; the fix is to free a seat, which the old advice
    // never mentioned and the old code could not tell apart from "not owned".
    world.token = "tok";
    world.owned = [{
      product: { id: "xentium-forum", kind: "plugin", name: "Forum" },
      status: "active", seats: 3, seatsUsed: 3, activeHere: false,
    }];
    const err = await refusalFor();
    expect(err?.code).toBe(XEC.LICENSE_CAP_REACHED);
    expect(err?.message).toMatch(/All 3 seats/);
    expect(err?.message).toContain("https://marketplace.example/account/licences");
    expect(err?.message).not.toMatch(/Activate a licen[cs]e/i);
  });

  it("pluralises a single seat correctly", async () => {
    world.token = "tok";
    world.owned = [{
      product: { id: "xentium-forum", kind: "plugin", name: "Forum" },
      status: "active", seats: 1, seatsUsed: 1, activeHere: false,
    }];
    expect((await refusalFor())?.message).toMatch(/All 1 seat of/);
  });

  it("does not blame seats when the licence is unlimited", async () => {
    // `seats: null` is unlimited — there is no ceiling to hit, so a refusal
    // here is something else and must not be reported as a full licence.
    world.token = "tok";
    world.owned = [{
      product: { id: "xentium-forum", kind: "plugin", name: "Forum" },
      status: "active", seats: null, seatsUsed: 9, activeHere: false,
    }];
    const err = await refusalFor();
    expect(err?.code).toBe(XEC.LICENSE_NOT_FOUND);
    expect(err?.message).not.toMatch(/seat/i);
  });

  it("does not blame seats when this install already holds one", async () => {
    world.token = "tok";
    world.owned = [{
      product: { id: "xentium-forum", kind: "plugin", name: "Forum" },
      status: "active", seats: 2, seatsUsed: 2, activeHere: true,
    }];
    expect((await refusalFor())?.code).toBe(XEC.LICENSE_NOT_FOUND);
  });

  it("reports an expired licence as expired", async () => {
    world.token = "tok";
    world.owned = [{
      product: { id: "xentium-forum", kind: "plugin", name: "Forum" },
      status: "expired", seats: 1, seatsUsed: 0, activeHere: false,
    }];
    const err = await refusalFor();
    expect(err?.code).toBe(XEC.LICENSE_EXPIRED);
    expect(err?.message).toMatch(/Renew/i);
  });

  it("matches the product by id AND kind", async () => {
    // A theme and a plugin may share an id; matching on id alone would let a
    // theme licence answer for a plugin.
    world.token = "tok";
    world.owned = [{
      product: { id: "xentium-forum", kind: "theme", name: "Forum" },
      status: "active", seats: 3, seatsUsed: 3, activeHere: false,
    }];
    const err = await refusalFor();
    expect(err?.code).toBe(XEC.LICENSE_NOT_FOUND);
    expect(err?.message).toMatch(/does not own/i);
  });

  it("stays vague rather than wrong when the marketplace cannot be asked", async () => {
    // Being offline is not evidence about ownership, so this must not claim the
    // account does not own it.
    world.token = "tok";
    world.ownedThrows = true;
    const err = await refusalFor();
    expect(err?.code).toBe(XEC.LICENSE_NOT_FOUND);
    expect(err?.message).not.toMatch(/does not own/i);
  });
});

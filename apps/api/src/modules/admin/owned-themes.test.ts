/**
 * `listOwned` — what the ACP's Licence panel knows about an owned THEME.
 *
 * The panel draws one row per licence the account holds, and each row states two
 * separate facts: what the account bought, and what this install actually has.
 * The second half was resolved by looking the product id up in `installedPlugin`
 * — a table a theme's id has never been in. So every owned theme came back
 * `installedVersion: null` no matter what the site was wearing: permanently
 * "Inactive", never offering an update, and the row's action fell through to a
 * link away instead of an install.
 *
 * A site wears ONE theme, and the only local record it leaves is the manifest in
 * `appearance.theme.installed`. These tests pin the two things that are easy to
 * get wrong once you start reading it: only the theme actually worn counts as
 * installed, and a theme never borrows the plugin table's vocabulary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const world = {
  owned:     [] as any[],
  installedPlugins: [] as { id: string; installedVersion: string; status: string }[],
  installedTheme: null as Record<string, unknown> | null,
};

vi.mock("../../core/license-engine/marketplace-source.js", () => ({
  marketplaceSource: { listOwned: async () => world.owned },
}));

vi.mock("../appearance/appearance.service.js", () => ({
  appearanceService: { getInstalledTheme: async () => world.installedTheme },
}));

vi.mock("../../infrastructure/db.js", () => ({
  prisma: { installedPlugin: { findMany: async () => world.installedPlugins } },
}));

// Pulled in by the module under test; none of it runs in these tests.
vi.mock("../themes/theme.service.js",   () => ({ themeService: {} }));
vi.mock("../plugins/plugin.service.js", () => ({ pluginService: {} }));
vi.mock("../activity/activity.service.js", () => ({ activityService: {} }));
vi.mock("./admin.service.js",           () => ({ adminService: {} }));
vi.mock("../../jobs/updateCheck.js",    () => ({ processUpdateCheck: async () => {} }));
vi.mock("../../core/license-engine/license-engine.js", () => ({
  getSiteDomain: async () => "example.test",
  getSiteId: async () => "site",
  resolveEnvironment: async () => "production",
  refreshLicense: async () => {},
  activateFromAccount: async () => false,
  assertThemeDownloadAllowed: async () => {},
}));
vi.mock("../../core/license-engine/protocol-client.js", () => ({ marketplaceWebUrl: (p = "/") => p }));
vi.mock("../../shared/utils/settings.js", () => ({ getSetting: async (_k: string, f: unknown) => f }));

const { marketplaceService } = await import("./marketplace.service.js");

const themeLicence = (id: string, latestVersion: string | null) => ({
  keyRef: `NDV-${id}`, status: "active", seats: null, seatsUsed: 0, activeHere: true,
  updatesUntil: null, purchasedAt: "2026-01-01",
  product: { id, kind: "theme", name: id, vendor: "v", summary: null, latestVersion, latestReleasedAt: null },
});

beforeEach(() => {
  world.owned = [];
  world.installedPlugins = [];
  world.installedTheme = null;
});

describe("an owned theme row", () => {
  it("reports the version of the theme this site is actually wearing", async () => {
    world.owned = [themeLicence("aurora-dark", "1.2.0")];
    world.installedTheme = { id: "aurora-dark", version: "1.1.0" };

    const row = (await marketplaceService.listOwned()).licenses[0]!;
    expect(row.installedVersion).toBe("1.1.0");
    expect(row.updateAvailable).toBe(true);
  });

  it("⚠ counts ONLY the theme worn — not every theme the account owns", async () => {
    // The tempting shortcut is "kind is theme, so use the installed manifest".
    // A site wears one theme; the others are owned and not installed, and marking
    // them installed at the WORN theme's version is worse than saying nothing.
    world.owned = [themeLicence("aurora-dark", "1.2.0"), themeLicence("midnight", "3.0.0")];
    world.installedTheme = { id: "aurora-dark", version: "1.2.0" };

    const rows = (await marketplaceService.listOwned()).licenses;
    expect(rows.find((r) => r.product.id === "aurora-dark")!.installedVersion).toBe("1.2.0");
    expect(rows.find((r) => r.product.id === "midnight")!.installedVersion).toBeNull();
    expect(rows.find((r) => r.product.id === "midnight")!.updateAvailable).toBe(false);
  });

  it("offers no update when the worn version is already the latest", async () => {
    world.owned = [themeLicence("aurora-dark", "1.2.0")];
    world.installedTheme = { id: "aurora-dark", version: "1.2.0" };
    expect((await marketplaceService.listOwned()).licenses[0]!.updateAvailable).toBe(false);
  });

  it("carries no installedStatus — a theme has no enabled/disabled state", async () => {
    // It is staged in the appearance draft or it is published, and neither of
    // those is what this field means. Borrowing the plugin vocabulary would put
    // an "Enabled" chip on something whose changes are not live yet.
    world.owned = [themeLicence("aurora-dark", "1.0.0")];
    world.installedTheme = { id: "aurora-dark", version: "1.0.0" };
    expect((await marketplaceService.listOwned()).licenses[0]!.installedStatus).toBeNull();
  });

  it("survives a site that has never imported a theme", async () => {
    world.owned = [themeLicence("aurora-dark", "1.0.0")];
    world.installedTheme = null;
    const row = (await marketplaceService.listOwned()).licenses[0]!;
    expect(row.installedVersion).toBeNull();
    expect(row.updateAvailable).toBe(false);
  });

  it("leaves plugin rows reading the plugin table exactly as before", async () => {
    world.owned = [{
      ...themeLicence("nodevo-forum", "2.0.0"),
      product: { id: "nodevo-forum", kind: "plugin", name: "Forum", vendor: "v", summary: null, latestVersion: "2.0.0", latestReleasedAt: null },
    }];
    world.installedPlugins = [{ id: "nodevo-forum", installedVersion: "1.9.0", status: "enabled" }];
    world.installedTheme = { id: "aurora-dark", version: "1.0.0" };

    const row = (await marketplaceService.listOwned()).licenses[0]!;
    expect(row.installedVersion).toBe("1.9.0");
    expect(row.installedStatus).toBe("enabled");
    expect(row.updateAvailable).toBe(true);
  });
});

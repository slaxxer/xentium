/**
 * Security advisories in the ACP. The update check stores what the marketplace
 * sent; reading it back must reflect the site as it is NOW — an advisory the admin
 * just fixed by updating is gone, one with no fix yet stays.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { marketplaceService } from "./marketplace.service.js";

const PID = "advisory-probe";

async function install(version: string) {
  await prisma.installedPlugin.upsert({
    where: { id: PID },
    create: { id: PID, name: "Probe", vendor: "X", installedVersion: version, packagePath: "x", manifest: {} },
    update: { installedVersion: version },
  });
}

async function cache(advisories: unknown[]) {
  const value = JSON.stringify({ checkedAt: new Date().toISOString(), updates: [], advisories });
  await prisma.setting.upsert({ where: { key: "marketplace.updates" }, create: { key: "marketplace.updates", value }, update: { value } });
  bustSettingsCache();
}

const ADV = (fixedIn: string | null) => ({
  id: "XEN-SA-2026-001", pluginId: PID, name: "Probe", severity: "high",
  affects: "<1.2.0", fixedIn, summary: "Stored XSS in the title field.",
});

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.installedPlugin.deleteMany({ where: { id: PID } });
});
afterEach(async () => {
  await prisma.installedPlugin.deleteMany({ where: { id: PID } });
  await prisma.setting.deleteMany({ where: { key: "marketplace.updates" } });
  bustSettingsCache();
});

describe("advisories on the Updates page", () => {
  it("shows one against the installed version, with its summary", async () => {
    await install("1.1.0");
    await cache([ADV("1.2.0")]);
    const { advisories } = await marketplaceService.getUpdates();
    expect(advisories).toEqual([ADV("1.2.0")]);
  });

  it("drops it the moment the fix is installed, without waiting for the next check", async () => {
    await install("1.2.0");
    await cache([ADV("1.2.0")]);
    expect((await marketplaceService.getUpdates()).advisories).toEqual([]);
  });

  it("keeps one that has no fix yet, and drops one whose plugin is gone", async () => {
    await install("1.1.0");
    await cache([ADV(null), { ...ADV(null), id: "XEN-SA-2026-002", pluginId: "uninstalled-plugin" }]);
    expect((await marketplaceService.getUpdates()).advisories.map((a) => a.id)).toEqual(["XEN-SA-2026-001"]);
  });
});

describe("release notes on the Updates page", () => {
  async function cacheUpdate(notes: unknown[]) {
    const value = JSON.stringify({
      checkedAt: new Date().toISOString(), advisories: [],
      updates: [{ pluginId: PID, name: "Probe", latestVersion: "1.5.0", critical: false, notes }],
    });
    await prisma.setting.upsert({ where: { key: "marketplace.updates" }, create: { key: "marketplace.updates", value }, update: { value } });
    bustSettingsCache();
  }
  const NOTE = (version: string) => ({ version, changelog: `- in ${version}`, publishedAt: null });

  it("passes on what's new for every release newer than the installed one", async () => {
    await install("1.2.0");
    await cacheUpdate([NOTE("1.5.0"), NOTE("1.3.0")]);
    const { updates } = await marketplaceService.getUpdates();
    expect(updates[0]?.notes).toEqual([NOTE("1.5.0"), NOTE("1.3.0")]);
  });

  it("drops the notes of versions the site has reached since the check", async () => {
    await install("1.3.0");
    await cacheUpdate([NOTE("1.5.0"), NOTE("1.3.0")]);
    expect((await marketplaceService.getUpdates()).updates[0]?.notes).toEqual([NOTE("1.5.0")]);
  });
});

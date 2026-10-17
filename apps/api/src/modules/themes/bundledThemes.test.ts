/**
 * Xentium Dark is added to the library once, inactive; an uninstall sticks; a newer
 * bundled version replaces OUR row's package but never a row the admin imported.
 * And Core is offered to readers while it is the site's own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XENTIUM_DARK_ID, XENTIUM_DARK_PACKAGE } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { bustThemeCss } from "../appearance/appearance.service.js";
import { ensureBundledThemes } from "./bundledThemes.js";
import { themeService } from "./theme.service.js";

const FLAG = `themes.bundled.${XENTIUM_DARK_ID}`;

async function clean() {
  await prisma.theme.deleteMany({});
  await prisma.setting.deleteMany({ where: { OR: [{ key: FLAG }, { key: { startsWith: "appearance." } }] } });
  bustSettingsCache();
  bustThemeCss();
}

beforeEach(async () => { assertDisposableDatabase(); await clean(); });
afterEach(clean);

describe("bundled themes", () => {
  it("adds Xentium Dark once, inactive, and leaves the site's look alone", async () => {
    await ensureBundledThemes();
    const row = await prisma.theme.findUniqueOrThrow({ where: { id: XENTIUM_DARK_ID } });
    expect(row.active).toBe(false);
    expect((row.manifest as { appearance?: string }).appearance).toBe("dark");
    await ensureBundledThemes(); // a second boot changes nothing
    expect(await prisma.theme.count()).toBe(1);
  });

  it("an uninstall sticks across boots", async () => {
    await ensureBundledThemes();
    await prisma.theme.delete({ where: { id: XENTIUM_DARK_ID } });
    await ensureBundledThemes();
    expect(await prisma.theme.findUnique({ where: { id: XENTIUM_DARK_ID } })).toBeNull();
  });

  it("updates our row to a newer bundle, keeping it active", async () => {
    await ensureBundledThemes();
    await prisma.theme.update({ where: { id: XENTIUM_DARK_ID }, data: { version: "0.9.0", active: true } });
    await prisma.setting.update({ where: { key: FLAG }, data: { value: "0.9.0" } });
    bustSettingsCache();
    await ensureBundledThemes();
    const row = await prisma.theme.findUniqueOrThrow({ where: { id: XENTIUM_DARK_ID } });
    expect(row.version).toBe(XENTIUM_DARK_PACKAGE.manifest.version);
    expect(row.active).toBe(true);
  });

  it("replaces our row's package in place when the bundle changed at the same version", async () => {
    await ensureBundledThemes();
    await prisma.theme.update({ where: { id: XENTIUM_DARK_ID }, data: { payload: { old: true }, active: true } });
    await ensureBundledThemes();
    const row = await prisma.theme.findUniqueOrThrow({ where: { id: XENTIUM_DARK_ID } });
    expect(row.payload).toEqual(XENTIUM_DARK_PACKAGE.payload);
    expect(row.active).toBe(true);
    const update = vi.spyOn(prisma.theme, "update");
    await ensureBundledThemes(); // unchanged now: no write, despite jsonb's key order
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
  });

  it("never replaces a package the admin imported under the same id", async () => {
    await ensureBundledThemes();
    await prisma.theme.update({ where: { id: XENTIUM_DARK_ID }, data: { version: "2.0.0", payload: { mine: true } } });
    await ensureBundledThemes();
    const row = await prisma.theme.findUniqueOrThrow({ where: { id: XENTIUM_DARK_ID } });
    expect(row.version).toBe("2.0.0");
    expect(row.payload).toEqual({ mine: true });
  });
});

describe("what readers may choose", () => {
  it("lists Core first while it is the site's own — one accent, no colourways", async () => {
    await ensureBundledThemes();
    const choices = await themeService.listThemesForVisitors();
    expect(choices.map((c) => c.id)).toEqual(["", XENTIUM_DARK_ID]);
    expect(choices[0]).toMatchObject({ name: "Xentium", active: true, colourways: [], wornColourway: null });
    expect(choices[1]!.colourways).toEqual([]);
  });

  it("does not offer Core under another active theme", async () => {
    await ensureBundledThemes();
    await prisma.theme.update({ where: { id: XENTIUM_DARK_ID }, data: { active: true } });
    const choices = await themeService.listThemesForVisitors();
    expect(choices.map((c) => c.id)).toEqual([XENTIUM_DARK_ID]);
  });
});

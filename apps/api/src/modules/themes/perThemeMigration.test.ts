/**
 * The carry-over to per-theme appearance, against the disposable test database.
 *
 * The one promise: the live site looks exactly as it did. The single layer of edits
 * becomes the ACTIVE theme's own (or Core's, when none was active), and a theme from
 * before the library existed gets a row built from what it left behind.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { migrateToPerThemeAppearance, PER_THEME_MIGRATED } from "./perThemeMigration.js";

const T = "legacy-theme";

const doc = (marker: string) => ({
  templateKey: "home", schemaVersion: 1, regions: { main: [{ id: marker, type: "spacer", props: {} }] },
});

const set = async (key: string, value: unknown) => {
  await prisma.setting.upsert({ where: { key }, update: { value: value as object }, create: { key, value: value as object } });
};
const get = async (key: string) => (await prisma.setting.findUnique({ where: { key } }))?.value;

const wipe = async () => {
  await prisma.layout.deleteMany({});
  await prisma.styleHistory.deleteMany({});
  await prisma.theme.deleteMany({ where: { id: T } });
  await prisma.setting.deleteMany({ where: { key: { startsWith: "appearance." } } });
  bustSettingsCache();
};

beforeEach(async () => { assertDisposableDatabase(); await wipe(); });
afterEach(wipe);

describe("with a theme active", () => {
  beforeEach(async () => {
    await set("appearance.theme.installed", { id: T, name: "Legacy", version: "2.0.0", vendor: "V" });
    // What the theme shipped, as the old model copied it.
    await set("appearance.tokens.theme", { global: { "--c-accent": "#theme" } });
    await set("appearance.custom_css.theme", ".theme { color: red; }");
    await prisma.layout.create({ data: { templateKey: "home", variant: "", scope: "theme", document: doc("shipped") } });
    // The admin's edits.
    await set("appearance.tokens", { global: { "--c-bg": "#admin" } });
    await set("appearance.custom_css_light", ".mine { color: blue; }");
    await set("appearance.font.family", "Inter");
    await prisma.layout.create({ data: { templateKey: "home", variant: "", scope: "published", document: doc("edited") } });
    const admin = await prisma.user.findFirst({ select: { id: true } });
    if (admin) await prisma.styleHistory.create({ data: { label: "x", tokens: {}, savedById: admin.id } });
    bustSettingsCache();
    await migrateToPerThemeAppearance();
  });

  it("gives a pre-library theme its row, from what it left behind", async () => {
    const row = await prisma.theme.findUnique({ where: { id: T } });
    expect(row?.active).toBe(true);
    const payload = row!.payload as { documents: Record<string, unknown>; tokens: unknown; customCss: string };
    expect(Object.keys(payload.documents)).toEqual(["home"]);
    expect(payload.tokens).toEqual({ global: { "--c-accent": "#theme" } });
    expect(payload.customCss).toBe(".theme { color: red; }");
  });

  it("makes the edits that theme's own", async () => {
    expect(await get(`appearance.tokens@${T}`)).toEqual({ global: { "--c-bg": "#admin" } });
    expect(await get(`appearance.custom_css_light@${T}`)).toBe(".mine { color: blue; }");
    expect(await get(`appearance.font.family@${T}`)).toBe("Inter");
    const rows = await prisma.layout.findMany({});
    expect(rows.map((r) => [r.themeKey, r.scope])).toEqual([[T, "published"]]);
  });

  it("leaves Core fresh and drops the copied package", async () => {
    expect(await get("appearance.tokens")).toBeUndefined();
    expect(await get("appearance.font.family")).toBeUndefined();
    expect(await get("appearance.tokens.theme")).toBeUndefined();
    expect(await get("appearance.custom_css.theme")).toBeUndefined();
  });

  it("moves style history to the theme", async () => {
    const rows = await prisma.styleHistory.findMany({});
    expect(rows.every((r) => r.themeKey === T)).toBe(true);
  });

  it("runs once", async () => {
    expect(await get(PER_THEME_MIGRATED)).toBe(true);
    await set("appearance.tokens", { global: { "--c-bg": "#later" } });
    bustSettingsCache();
    await migrateToPerThemeAppearance();
    expect(await get("appearance.tokens")).toEqual({ global: { "--c-bg": "#later" } });
  });
});

describe("with no theme active", () => {
  it("keeps everything as Core's", async () => {
    await set("appearance.tokens", { global: { "--c-bg": "#core" } });
    await prisma.layout.create({ data: { templateKey: "home", variant: "", scope: "published", document: doc("core") } });
    bustSettingsCache();
    await migrateToPerThemeAppearance();
    expect(await get("appearance.tokens")).toEqual({ global: { "--c-bg": "#core" } });
    const rows = await prisma.layout.findMany({});
    expect(rows.map((r) => r.themeKey)).toEqual([""]);
  });
});

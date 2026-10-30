/**
 * Resetting a theme in Theme Studio puts it back to what its PACKAGE ships (or, for
 * Core, the code default), for visitors and for the editor alike.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUTS, type LayoutDocument } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { layoutService } from "../layouts/layout.service.js";
import { appearanceService, bustThemeCss } from "../appearance/appearance.service.js";
import { publishTheme, stageThemeDefaults, studioStatus } from "./themeStudio.js";

const EMAIL = "reset_probe@example.test";
const T = "reset-theme";
const FOOTER = { templateKey: "chrome.footer", variant: "" } as const;
let userId = "";

/** Core's footer with its band holding `drop` fewer pieces. */
const footerWithout = (drop: number): LayoutDocument => {
  const doc = structuredClone(DEFAULT_LAYOUTS["chrome.footer"]) as LayoutDocument;
  const band = doc.regions[Object.keys(doc.regions)[0]!]![0]!;
  band.children = band.children!.slice(0, -drop);
  return doc;
};
/** The footer as the theme ships it: core's, one piece fewer. */
const shippedFooter = () => footerWithout(1);
/** The admin's edit on top: one piece fewer again. */
const editedFooter = () => footerWithout(2);
/** Pieces in the footer band, which is what the two versions differ by. */
const blockCount = (doc: LayoutDocument) => Object.values(doc.regions).flat().reduce((n, b) => n + (b.children?.length ?? 0), 0);

async function clean() {
  await prisma.layout.deleteMany({});
  await prisma.setting.deleteMany({ where: { key: { startsWith: "appearance." } } });
  await prisma.styleHistory.deleteMany({});
  await prisma.themeRevision.deleteMany({});
  await prisma.theme.deleteMany({ where: { id: T } });
  bustSettingsCache();
  bustThemeCss();
  layoutService.bustCache();
}

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  userId = (await prisma.user.create({ data: { email: EMAIL, username: "reset_probe", passwordHash: "x" } })).id;
  await clean();
  await prisma.theme.create({
    data: {
      id: T, name: T, version: "1.0.0", vendor: "test", manifest: { id: T, name: T },
      payload: { documents: { "chrome.footer": shippedFooter() }, tokens: { global: { "--c-accent": "#111111" } }, customCss: null } as object,
    },
  });
  bustThemeCss(T);
  layoutService.bustCache();
});

afterEach(async () => {
  await clean();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

describe("resetting an installed theme", () => {
  it("puts a published layout edit back to what the package ships", async () => {
    await layoutService.saveDraft(FOOTER, editedFooter(), userId, undefined, T);
    await publishTheme(userId, T);
    expect(blockCount(await layoutService.getPublished(FOOTER, T))).toBe(blockCount(editedFooter()));

    await layoutService.reset(FOOTER, T);

    expect(blockCount(await layoutService.getPublished(FOOTER, T))).toBe(blockCount(shippedFooter()));
    expect(blockCount((await layoutService.getDraft(FOOTER, T)).document)).toBe(blockCount(shippedFooter()));
    expect((await layoutService.getDraftStatus(T)).pending).toEqual([]);
  });

  it("puts published colours back to what the package ships", async () => {
    await appearanceService.saveDraftTokens({ global: { "--c-accent": "#222222" } }, userId, T);
    await publishTheme(userId, T);
    const before = await appearanceService.getCssFor(T);
    expect(before).toContain("#222222");

    await appearanceService.resetAppearance(T);

    const after = await appearanceService.getCssFor(T);
    expect(after).not.toContain("#222222");
    expect(after).toContain("#111111");
    expect(await appearanceService.getDraftTokens(T)).toEqual({});
  });
});

describe("resetting a whole theme (Theme Studio → Reset theme)", () => {
  /** The admin's version of a theme: a changed footer AND home page, colours, CSS and a font, published. */
  async function customise() {
    const home = structuredClone(DEFAULT_LAYOUTS["home"]) as LayoutDocument;
    home.regions.main = [];
    await layoutService.saveDraft(FOOTER, editedFooter(), userId, undefined, T);
    await layoutService.saveDraft({ templateKey: "home", variant: "" }, home, userId, undefined, T);
    await appearanceService.saveDraftTokens({ global: { "--c-accent": "#222222", "--radius-md": "0px" } }, userId, T);
    await appearanceService.saveDraftCustomCss(".mine { color: blue; }", T);
    await appearanceService.saveDraftFont({ family: "Poppins" }, T);
    await publishTheme(userId, T);
  }

  it("stages every part back to what the package ships, and nothing goes live yet", async () => {
    await customise();
    const status = await stageThemeDefaults(userId, T);

    expect(status.pending).toBe(true);
    expect(status.layouts.map((l) => l.templateKey).sort()).toEqual(["chrome.footer", "home"]);
    expect(status.cssPending).toBe(true);
    // The draft is the package: the shipped footer, the code's home page, no overrides.
    expect(blockCount((await layoutService.getDraft(FOOTER, T)).document)).toBe(blockCount(shippedFooter()));
    expect(await appearanceService.getDraftTokens(T)).toEqual({});
    // Live is untouched until Publish.
    expect(blockCount(await layoutService.getPublished(FOOTER, T))).toBe(blockCount(editedFooter()));
    expect(await appearanceService.getCssFor(T)).toContain("#222222");
  });

  it("is the package once published, and the old version stays in History", async () => {
    await customise();
    await stageThemeDefaults(userId, T);
    await publishTheme(userId, T);

    expect(blockCount(await layoutService.getPublished(FOOTER, T))).toBe(blockCount(shippedFooter()));
    const css = await appearanceService.getCssFor(T);
    expect(css).toContain("#111111");
    expect(css).not.toContain("#222222");
    expect(css).not.toContain(".mine");
    expect((await appearanceService.getFont(T)).family).toBe("");
    expect((await studioStatus(T)).pending).toBe(false);
    // Two publishes, two revisions: the customised one can be staged back.
    expect(await prisma.themeRevision.count({ where: { themeKey: T } })).toBe(2);
    // Nothing customised is left, so a package update would follow the new version.
    const owned = await layoutService.getOwnership(T);
    expect(Object.values(owned).some((o) => o.customised)).toBe(false);
  });

  it("does nothing to a theme nobody changed", async () => {
    const status = await stageThemeDefaults(userId, T);
    expect(status.pending).toBe(false);
    expect(status.layouts).toEqual([]);
  });
});

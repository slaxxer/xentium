/**
 * Layouts as a VISITOR WEARING an installed theme sees them.
 *
 * A site has one active theme; a reader may choose another installed one for
 * themselves. That choice reaches the server as `?theme=<id>` on the public layouts
 * endpoint, and this is the resolution behind it. Every theme carries its own edits:
 *
 *  - that theme AS THE ADMIN MADE IT — its own edited documents, then what it ships,
 *    then the code default. Never another theme's arrangement: the active theme's
 *    pages were built for different surfaces, and a mix is a page nobody designed;
 *  - the active theme's layouts for an id naming nothing, because the choice lives in
 *    a cookie and a cookie outlives an uninstall.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_VARIANT, type LayoutDocument } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { bustThemeLayouts, layoutService } from "./layout.service.js";

const THEME = "test-theme";

/** A document distinguishable from anything the site or the code default would give. */
const doc = (marker: string): LayoutDocument => ({
  templateKey: "home",
  schemaVersion: 1,
  regions: { main: [{ id: marker, type: "spacer", props: {} }] },
});

const themeHome = doc;
const siteHome = doc;

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.layout.deleteMany({});
  await prisma.theme.deleteMany({ where: { id: THEME } });
  bustThemeLayouts();

  // The site's own published home, as an admin arranged it.
  await prisma.layout.create({
    data: {
      id: `home|${DEFAULT_VARIANT}|published`,
      templateKey: "home", variant: DEFAULT_VARIANT, scope: "published",
      document: siteHome("site-block") as unknown as object,
    },
  });
});

afterEach(async () => {
  await prisma.layout.deleteMany({});
  await prisma.theme.deleteMany({ where: { id: THEME } });
  bustThemeLayouts();
});

const installTheme = (documents: Record<string, unknown>) =>
  prisma.theme.create({
    data: {
      id: THEME, name: "Test theme", version: "1.0.0", vendor: "tests",
      manifest: {} as object,
      payload: { documents, tokens: null, customCss: null } as unknown as object,
      active: false,
    },
  });

describe("a visitor wearing an installed theme", () => {
  it("gets the theme's own document for a template it ships", async () => {
    await installTheme({ home: themeHome("theme-block") });
    const { templates } = await layoutService.getPublishedAllForTheme(THEME);
    expect(templates.home?.regions.main?.[0]?.id).toBe("theme-block");
  });

  it("still gets every template when the theme ships only some", async () => {
    // The theme ships `home` and nothing else — every other page still renders.
    await installTheme({ home: themeHome("theme-block") });
    const { templates } = await layoutService.getPublishedAllForTheme(THEME);
    expect(templates.profile).toBeDefined();
    expect(templates.profile?.templateKey).toBe("profile");
  });

  it("replaces the site's document rather than merging into it", async () => {
    // A per-template mix of two themes' blocks is an arrangement nobody designed.
    await installTheme({ home: themeHome("theme-block") });
    const { templates } = await layoutService.getPublishedAllForTheme(THEME);
    const ids = (templates.home?.regions.main ?? []).map((b) => b.id);
    expect(ids).toEqual(["theme-block"]);
    expect(ids).not.toContain("site-block");
  });

  it("treats a document that does not parse as not shipped — never another theme's page", async () => {
    await installTheme({ home: { templateKey: "home", regions: "not-an-object" } });
    const { templates } = await layoutService.getPublishedAllForTheme(THEME);
    expect(templates.home?.templateKey).toBe("home");
    expect((templates.home?.regions.main ?? []).map((b) => b.id)).not.toContain("site-block");
  });

  it("carries the admin's edits to THAT theme", async () => {
    await installTheme({ home: themeHome("theme-block") });
    await prisma.layout.create({
      data: {
        themeKey: THEME, templateKey: "home", variant: DEFAULT_VARIANT, scope: "published",
        document: doc("edited-block") as unknown as object,
      },
    });
    bustThemeLayouts(THEME);
    const { templates } = await layoutService.getPublishedAllForTheme(THEME);
    expect(templates.home?.regions.main?.[0]?.id).toBe("edited-block");
  });
});

describe("a choice that no longer names anything", () => {
  it("falls back to the site's own layouts", async () => {
    // A cookie outlives an uninstall; the reader must see the site, not an error.
    const { templates } = await layoutService.getPublishedAllForTheme("gone");
    expect(templates.home?.regions.main?.[0]?.id).toBe("site-block");
  });

  it("answers exactly as the unthemed endpoint does", async () => {
    const themed = await layoutService.getPublishedAllForTheme("gone");
    const plain  = await layoutService.getPublishedAll();
    expect(themed).toEqual(plain);
  });
});

describe("the per-theme cache", () => {
  it("does not go on serving a theme that was uninstalled", async () => {
    await installTheme({ home: themeHome("theme-block") });
    expect((await layoutService.getPublishedAllForTheme(THEME))
      .templates.home?.regions.main?.[0]?.id).toBe("theme-block");

    await prisma.theme.delete({ where: { id: THEME } });
    bustThemeLayouts(THEME);

    expect((await layoutService.getPublishedAllForTheme(THEME))
      .templates.home?.regions.main?.[0]?.id).toBe("site-block");
  });
});

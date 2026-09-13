/**
 * Layouts as a VISITOR WEARING an installed theme sees them.
 *
 * A site has one active theme; a reader may choose another installed one for
 * themselves. That choice reaches the server as `?theme=<id>` on the public layouts
 * endpoint, and this is the resolution behind it. Three rules, and each of them is
 * something a plausible implementation gets wrong:
 *
 *  - the theme's OWN documents where it ships one — not merged with the site's, which
 *    would be an arrangement nobody designed;
 *  - the SITE's document everywhere else, because a theme rarely ships all eight
 *    templates and the alternative is a bare code default on the pages it skipped;
 *  - the site's own layouts for an id naming nothing, because the choice lives in a
 *    cookie and a cookie outlives an uninstall.
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

  it("gets the SITE's document for a template the theme does not ship", async () => {
    // The theme ships `home` and nothing else — every other page must still be the
    // site's, not a bare code default.
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

  it("skips a template whose document does not parse, keeping the site's", async () => {
    // ⚠ The code default is not what this theme ships, so a broken file must not
    // replace an admin's page with an empty one.
    await installTheme({ home: { templateKey: "home", regions: "not-an-object" } });
    const { templates } = await layoutService.getPublishedAllForTheme(THEME);
    expect(templates.home?.regions.main?.[0]?.id).toBe("site-block");
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

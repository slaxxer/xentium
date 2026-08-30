/**
 * The theme's custom-CSS layer.
 *
 * Custom CSS was the one channel a `.nvtheme` did NOT layer. Importing a theme called
 * `saveCustomCss` with the package's contents, which overwrote the admin's own
 * stylesheet outright — no baseline recorded (unlike a layout), nowhere else for it to
 * live (unlike a token), and applied live so it happened before anyone had looked. A
 * package carrying only `custom-light.css` blanked the admin's DARK stylesheet too,
 * because both keys were always written together.
 *
 * These drive the real service against the disposable test database rather than mocking
 * it, because every claim here is about what is actually stored and in what ORDER it is
 * emitted — which is the whole of the inheritance and exactly what a mock would assume.
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { appearanceService } from "./appearance.service.js";

const ADMIN_LIGHT = "appearance.custom_css_light";
const ADMIN_DARK  = "appearance.custom_css_dark";
const THEME_LIGHT = "appearance.custom_css.theme.light";
const THEME_DARK  = "appearance.custom_css.theme.dark";
const THEME_DRAFT_LIGHT = "appearance.custom_css.theme.draft.light";
const THEME_DRAFT_DARK  = "appearance.custom_css.theme.draft.dark";

/** Every key these tests touch — wiped between them so none inherits state. */
const KEYS = [
  ADMIN_LIGHT, ADMIN_DARK, "appearance.custom_css", "appearance.custom_css_compiled",
  THEME_LIGHT, THEME_DARK, THEME_DRAFT_LIGHT, THEME_DRAFT_DARK,
  "appearance.tokens.light", "appearance.tokens.dark",
  "appearance.tokens.draft.light", "appearance.tokens.draft.dark", "appearance.tokens.draft.by",
  "appearance.tokens.theme.light", "appearance.tokens.theme.dark",
  "appearance.tokens.theme.draft.light", "appearance.tokens.theme.draft.dark",
];

const wipe = async () => {
  await prisma.setting.deleteMany({ where: { key: { in: KEYS } } });
  for (const key of KEYS) bustCache(key);
};

// The service caches settings in-process with a TTL, so a test that wrote a row
// directly would otherwise read the previous test's value.
const { bustSettingsCache: bustCache } = await import("../../shared/utils/settings.js");

const put = async (key: string, value: unknown) => {
  await prisma.setting.upsert({
    where: { key }, update: { value: value as object }, create: { key, value: value as object },
  });
  bustCache(key);
};

beforeEach(async () => { assertDisposableDatabase(); await wipe(); });
afterEach(wipe);

// ── Order is the inheritance ────────────────────────────────────────────────

describe("the served stylesheet", () => {
  it("emits the THEME layer before the admin's, so the admin wins a tie", async () => {
    await put(THEME_LIGHT, ".x { color: red }");
    await appearanceService.saveCustomCss({ light: ".x { color: blue }", dark: "" });

    const css = await appearanceService.buildCustomCss();
    expect(css).toContain("red");
    expect(css).toContain("blue");
    // Both are scoped to the same root, so equal specificity is decided by source
    // order. The admin's stylesheet must be the later one or a theme update could take
    // a customisation away.
    expect(css.indexOf("red")).toBeLessThan(css.indexOf("blue"));
  });

  it("keeps serving the theme's stylesheet when the admin saves their own", async () => {
    // `saveCustomCss` writes the whole compiled blob, so compiling it against a blank
    // theme layer would silently uninstall a theme's CSS the first time an admin typed
    // in the console.
    await put(THEME_LIGHT, ".from-theme { color: red }");
    await appearanceService.saveCustomCss({ light: ".mine { color: blue }", dark: "" });
    expect(await appearanceService.buildCustomCss()).toContain(".from-theme");
  });

  it("serves the theme's stylesheet with no admin CSS at all", async () => {
    await put(THEME_LIGHT, ".from-theme { color: red }");
    expect(await appearanceService.recompileCustomCss()).toContain(".from-theme");
  });
});

// ── Staging ─────────────────────────────────────────────────────────────────

describe("the staged theme stylesheet", () => {
  it("changes nothing served until it is published", async () => {
    await appearanceService.saveThemeCustomCss({ light: ".incoming { color: red }", dark: "" });
    expect(await appearanceService.buildCustomCss()).not.toContain(".incoming");
  });

  it("falls back to the live layer when nothing is staged", async () => {
    await put(THEME_LIGHT, ".live { color: red }");
    expect((await appearanceService.getThemeDraftCustomCss()).light).toBe(".live { color: red }");
  });

  it("reports pending — even for a theme that ships CSS and NO tokens", async () => {
    // `publishDraft` returns early when nothing is pending, so without this a package
    // carrying only `styles/custom-*.css` would stage a stylesheet that could never be
    // published: staged forever, invisible, with no way to apply it.
    expect((await appearanceService.getDraftStatus()).pending).toBe(false);
    await appearanceService.saveThemeCustomCss({ light: ".incoming { color: red }", dark: "" });
    expect((await appearanceService.getDraftStatus()).pending).toBe(true);
  });

  it("is not pending when the staged stylesheet equals the live one", async () => {
    await put(THEME_LIGHT, ".same { color: red }");
    await appearanceService.saveThemeCustomCss({ light: ".same { color: red }", dark: "" });
    expect((await appearanceService.getDraftStatus()).pending).toBe(false);
  });
});

// ── Publish ─────────────────────────────────────────────────────────────────

describe("publishing", () => {
  /** `publishDraft` attributes a history entry, so it needs a real administrator. */
  async function anAdmin(): Promise<string> {
    const group = await prisma.group.upsert({
      where:  { key: "admin" },
      update: {},
      create: { key: "admin", name: "Administrator" },
    });
    const user = await prisma.user.upsert({
      where:  { email: "css-layer@test.local" },
      update: {},
      create: {
        email: "css-layer@test.local", username: "csslayer",
        passwordHash: "x", groups: { create: { groupId: group.id } },
      },
    });
    return user.id;
  }

  it("promotes the staged stylesheet, clears the draft and rebuilds what is served", async () => {
    const admin = await anAdmin();
    await appearanceService.saveThemeCustomCss({ light: ".incoming { color: red }", dark: "" });

    expect(await appearanceService.publishDraft(admin, "test")).toBe(true);

    expect((await appearanceService.getThemeCustomCss()).light).toBe(".incoming { color: red }");
    // The served blob is a cache of both layers; promoting without rebuilding it would
    // leave the site on the previous stylesheet until an admin happened to save theirs.
    expect(await appearanceService.buildCustomCss()).toContain(".incoming");
    expect((await appearanceService.getDraftStatus()).pending).toBe(false);
  });

  it("leaves the admin's stylesheet untouched across a publish", async () => {
    const admin = await anAdmin();
    await appearanceService.saveCustomCss({ light: ".mine { color: blue }", dark: "" });
    await appearanceService.saveThemeCustomCss({ light: ".incoming { color: red }", dark: "" });

    await appearanceService.publishDraft(admin, "test");

    expect((await appearanceService.getCustomCss()).light).toBe(".mine { color: blue }");
    const css = await appearanceService.buildCustomCss();
    expect(css.indexOf(".incoming")).toBeLessThan(css.indexOf(".mine"));
  });
});

// ── Reset ───────────────────────────────────────────────────────────────────

describe("resetAppearance", () => {
  it("drops MY stylesheet and keeps the theme's", async () => {
    // Same rule the token layer already follows: reset drops my edits, it does not
    // uninstall someone else's work.
    await put(THEME_LIGHT, ".from-theme { color: red }");
    await appearanceService.saveCustomCss({ light: ".mine { color: blue }", dark: "" });

    await appearanceService.resetAppearance();

    expect((await appearanceService.getCustomCss()).light).toBe("");
    expect((await appearanceService.getThemeCustomCss()).light).toBe(".from-theme { color: red }");
    // And the served blob reflects that immediately, not on the next incidental save.
    const css = await appearanceService.buildCustomCss();
    expect(css).toContain(".from-theme");
    expect(css).not.toContain(".mine");
  });
});

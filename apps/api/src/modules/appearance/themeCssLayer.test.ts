/**
 * The theme's custom-CSS layer.
 *
 * Custom CSS was the one channel a `.xttheme` did NOT layer. Importing a theme called
 * `saveCustomCss` with the package's contents, which overwrote the admin's own
 * stylesheet outright — no baseline recorded (unlike a layout), nowhere else for it to
 * live (unlike a token), and applied live so it happened before anyone had looked.
 *
 * These drive the real service against the disposable test database rather than mocking
 * it, because every claim here is about what is actually stored and in what ORDER it is
 * emitted — which is the whole of the inheritance and exactly what a mock would assume.
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { appearanceService } from "./appearance.service.js";

const ADMIN       = "appearance.custom_css";
const THEME       = "appearance.custom_css.theme";
const THEME_DRAFT = "appearance.custom_css.theme.draft";

/** Every key these tests touch — wiped between them so none inherits state.
 *  The pre-collapse names are in here too: every reader falls back to them, so one
 *  left behind by another test would be indistinguishable from a live value. */
const KEYS = [
  ADMIN, "appearance.custom_css_light", "appearance.custom_css_dark",
  "appearance.custom_css_compiled",
  THEME, THEME_DRAFT,
  "appearance.custom_css.theme.light", "appearance.custom_css.theme.draft.light",
  "appearance.tokens", "appearance.tokens.light", "appearance.tokens.dark",
  "appearance.tokens.draft", "appearance.tokens.draft.light", "appearance.tokens.draft.by",
  "appearance.tokens.theme", "appearance.tokens.theme.light",
  "appearance.tokens.theme.draft", "appearance.tokens.theme.draft.light",
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
    await put(THEME, ".x { color: red }");
    await appearanceService.saveCustomCss(".x { color: blue }");

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
    await put(THEME, ".from-theme { color: red }");
    await appearanceService.saveCustomCss(".mine { color: blue }");
    expect(await appearanceService.buildCustomCss()).toContain(".from-theme");
  });

  it("serves the theme's stylesheet with no admin CSS at all", async () => {
    await put(THEME, ".from-theme { color: red }");
    expect(await appearanceService.recompileCustomCss()).toContain(".from-theme");
  });
});

// ── Staging ─────────────────────────────────────────────────────────────────

/**
 * ⚠⚠ THIS CONTRACT CHANGED. `saveThemeCustomCss` used to write the DRAFT only, so a
 * theme's stylesheet sat staged until someone published — and going fully live took
 * publishes in TWO different pages, because the layouts staged separately.
 *
 * Draft→publish is an EDITING affordance: batch many small edits, publish when the
 * set is coherent. Activating a theme is one atomic decision, and staging it bought
 * nothing once a real preview, an undo and a theme library existed. A theme goes ON
 * when it is applied. The draft is still written, and that mirror is load-bearing.
 */
describe("applying a theme's stylesheet", () => {
  it("is live immediately, with no publish step", async () => {
    await appearanceService.saveThemeCustomCss(".incoming { color: red }");
    expect(await appearanceService.buildCustomCss()).toContain(".incoming");
  });

  it("⚠ mirrors into the draft, so pending admin edits preview against the NEW theme", async () => {
    // An admin with staged Style Editor edits previews `theme.draft ⊕ admin.draft`.
    // Leaving the draft layer on the old theme would show their staged work over a
    // theme that is no longer on the site.
    await appearanceService.saveThemeCustomCss(".incoming { color: red }");
    expect(await appearanceService.getThemeDraftCustomCss()).toBe(".incoming { color: red }");
  });

  it("leaves nothing pending, because nothing is waiting to be published", async () => {
    await appearanceService.saveThemeCustomCss(".incoming { color: red }");
    expect((await appearanceService.getDraftStatus()).pending).toBe(false);
  });

  it("falls back to the live layer when nothing is staged", async () => {
    await put(THEME, ".live { color: red }");
    expect(await appearanceService.getThemeDraftCustomCss()).toBe(".live { color: red }");
  });

  it("still reports pending for a stylesheet that reached the draft another way", async () => {
    // `publishDraft` returns early when nothing is pending, and a draft row can still
    // arrive without going through `saveThemeCustomCss` — restored by an undo, or
    // written by an older build. It must not be strandable.
    expect((await appearanceService.getDraftStatus()).pending).toBe(false);
    await put(THEME_DRAFT, ".incoming { color: red }");
    expect((await appearanceService.getDraftStatus()).pending).toBe(true);
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

  /** The promotion path still exists and still has to work — a stylesheet can reach
   *  the draft layer without `saveThemeCustomCss` (an undo restoring one, an older
   *  build), and publishing must promote it rather than strand it. */
  it("promotes a stylesheet that reached the draft layer some other way", async () => {
    const admin = await anAdmin();
    await put(THEME_DRAFT, ".incoming { color: red }");

    expect(await appearanceService.publishDraft(admin, "test")).toBe(true);

    expect(await appearanceService.getThemeCustomCss()).toBe(".incoming { color: red }");
    // The served blob is a cache of both layers; promoting without rebuilding it would
    // leave the site on the previous stylesheet until an admin happened to save theirs.
    expect(await appearanceService.buildCustomCss()).toContain(".incoming");
    expect((await appearanceService.getDraftStatus()).pending).toBe(false);
  });

  it("leaves the admin's stylesheet untouched across a publish", async () => {
    const admin = await anAdmin();
    await appearanceService.saveCustomCss(".mine { color: blue }");
    await put(THEME_DRAFT, ".incoming { color: red }");

    await appearanceService.publishDraft(admin, "test");

    expect(await appearanceService.getCustomCss()).toBe(".mine { color: blue }");
    const css = await appearanceService.buildCustomCss();
    expect(css.indexOf(".incoming")).toBeLessThan(css.indexOf(".mine"));
  });
});

// ── Reset ───────────────────────────────────────────────────────────────────

describe("resetAppearance", () => {
  it("drops MY stylesheet and keeps the theme's", async () => {
    // Same rule the token layer already follows: reset drops my edits, it does not
    // uninstall someone else's work.
    await put(THEME, ".from-theme { color: red }");
    await appearanceService.saveCustomCss(".mine { color: blue }");

    await appearanceService.resetAppearance();

    expect(await appearanceService.getCustomCss()).toBe("");
    expect(await appearanceService.getThemeCustomCss()).toBe(".from-theme { color: red }");
    // And the served blob reflects that immediately, not on the next incidental save.
    const css = await appearanceService.buildCustomCss();
    expect(css).toContain(".from-theme");
    expect(css).not.toContain(".mine");
  });
});

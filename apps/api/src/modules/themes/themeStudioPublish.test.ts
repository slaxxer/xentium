/**
 * Theme Studio's one Publish puts a theme's layout draft AND its style draft live
 * together — the reason the two editors were merged.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUTS, type LayoutDocument } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { layoutService } from "../layouts/layout.service.js";
import { appearanceService } from "../appearance/appearance.service.js";
import { publishTheme, stageHistoryEntry, studioStatus, themeHistory } from "./themeStudio.js";

const EMAIL = "studio_probe@example.test";
let userId = "";

async function clean() {
  await prisma.layout.deleteMany({});
  layoutService.bustCache();
  await prisma.styleHistory.deleteMany({ where: { savedById: userId } });
  await prisma.themeRevision.deleteMany({ where: { themeKey: "" } });
  const keys = ["appearance.tokens", "appearance.tokens.draft", "appearance.tokens.draft.by",
    "appearance.custom_css_light", "appearance.custom_css.draft", "appearance.custom_css_compiled",
    "appearance.font.draft", "appearance.font.family", "appearance.font.weight", "appearance.font.size"];
  await prisma.setting.deleteMany({ where: { key: { in: keys } } });
  for (const k of keys) bustSettingsCache(k);
}

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  userId = (await prisma.user.create({ data: { email: EMAIL, username: "studio_probe", passwordHash: "x" } })).id;
  await clean();
});

afterEach(async () => {
  await clean();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

describe("Theme Studio publish", () => {
  it("counts both drafts and publishes them together", async () => {
    // A layout change: the footer without its last block.
    const footer = structuredClone(DEFAULT_LAYOUTS["chrome.footer"]) as LayoutDocument;
    const region = Object.keys(footer.regions)[0]!;
    footer.regions[region] = footer.regions[region]!.slice(0, -1);
    await layoutService.saveDraft({ templateKey: "chrome.footer", variant: "" }, footer, userId, undefined, "");
    // A style change.
    await appearanceService.saveDraftTokens({ global: { "--c-accent": "#123456" } }, userId, "");

    const before = await studioStatus("");
    expect(before.layouts.map((s) => s.templateKey)).toEqual(["chrome.footer"]);
    expect(before.styleChanges).toBe(1);
    expect(before.pending).toBe(true);

    const res = await publishTheme(userId, "");
    expect(res.layouts.map((s) => s.templateKey)).toEqual(["chrome.footer"]);
    expect(res.styles).toBe(true);

    const after = await studioStatus("");
    expect(after).toMatchObject({ layouts: [], styleChanges: 0, pending: false });
    expect((await appearanceService.getTokenOverrides("")).global?.["--c-accent"]).toBe("#123456");
  });

  it("is a no-op with nothing pending", async () => {
    expect(await publishTheme(userId, "")).toEqual({ layouts: [], styles: false });
  });

  it("records ONE revision per publish, and no separate colour entry", async () => {
    await appearanceService.saveDraftTokens({ global: { "--c-accent": "#123456" } }, userId, "");
    await appearanceService.saveDraftCustomCss(".a { color: red; }", "");
    await publishTheme(userId, "");

    const history = await themeHistory("");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "revision", changes: { tokens: 1, css: true, font: false, layouts: [] } });
    expect(await prisma.styleHistory.count({ where: { savedById: userId } })).toBe(0);
  });

  it("stages a revision back as the draft: layouts, colours and CSS; live is untouched", async () => {
    // Revision 1: accent A, CSS A, a shorter footer.
    const footer = structuredClone(DEFAULT_LAYOUTS["chrome.footer"]) as LayoutDocument;
    const region = Object.keys(footer.regions)[0]!;
    footer.regions[region] = footer.regions[region]!.slice(0, -1);
    await layoutService.saveDraft({ templateKey: "chrome.footer", variant: "" }, footer, userId, undefined, "");
    await appearanceService.saveDraftTokens({ global: { "--c-accent": "#aaaaaa" } }, userId, "");
    await appearanceService.saveDraftCustomCss(".a { color: red; }", "");
    await publishTheme(userId, "");
    const first = (await themeHistory(""))[0]!;

    // Revision 2: accent B, CSS B, the footer back to the code default.
    await layoutService.reset({ templateKey: "chrome.footer", variant: "" }, "");
    await appearanceService.saveDraftTokens({ global: { "--c-accent": "#bbbbbb" } }, userId, "");
    await appearanceService.saveDraftCustomCss(".b { color: blue; }", "");
    await publishTheme(userId, "");

    const status = await stageHistoryEntry("revision", first.id, userId, "")
      .then(() => studioStatus(""));
    expect(status.pending).toBe(true);
    expect(status.layouts.map((x) => x.templateKey)).toEqual(["chrome.footer"]);
    expect((await appearanceService.getDraftTokens("")).global?.["--c-accent"]).toBe("#aaaaaa");
    expect(await appearanceService.getDraftCustomCss("")).toBe(".a { color: red; }");
    // Nothing went live.
    expect((await appearanceService.getTokenOverrides("")).global?.["--c-accent"]).toBe("#bbbbbb");
    expect(await appearanceService.getCustomCss("")).toBe(".b { color: blue; }");
  });

  it("refuses an entry of another theme", async () => {
    await appearanceService.saveDraftTokens({ global: { "--c-accent": "#123456" } }, userId, "");
    await publishTheme(userId, "");
    const entry = (await themeHistory(""))[0]!;
    await expect(stageHistoryEntry("revision", entry.id, userId, "other-theme")).rejects.toMatchObject({ httpStatus: 404 });
  });
});

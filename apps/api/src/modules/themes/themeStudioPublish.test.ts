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
import { publishTheme, studioStatus } from "./themeStudio.js";

const EMAIL = "studio_probe@example.test";
let userId = "";

async function clean() {
  await prisma.layout.deleteMany({});
  layoutService.bustCache();
  await prisma.styleHistory.deleteMany({ where: { savedById: userId } });
  const keys = ["appearance.tokens", "appearance.tokens.draft", "appearance.tokens.draft.by"];
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
});

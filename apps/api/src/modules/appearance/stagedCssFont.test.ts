/**
 * Custom CSS and fonts are STAGED, like the tokens: the Theme Studio edits a draft, the
 * one Publish puts it live. Real service, disposable test database — the claims are
 * about which row is written and which stylesheet reads it.
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { appearanceService, bustThemeCss } from "./appearance.service.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";

const T = "staged-theme";

const wipe = async () => {
  await prisma.setting.deleteMany({ where: { key: { startsWith: "appearance." } } });
  await prisma.theme.deleteMany({ where: { id: T } });
  bustSettingsCache();
  bustThemeCss();
};

beforeEach(async () => {
  assertDisposableDatabase();
  await wipe();
  await prisma.theme.create({
    data: {
      id: T, name: T, version: "1.0.0", vendor: "test", manifest: { id: T, name: T },
      payload: { documents: {}, tokens: null, customCss: null },
    },
  });
});
afterEach(wipe);

const live = () => appearanceService.buildCSS({}, { key: T });
const draft = () => appearanceService.buildCSS({}, { key: T, draft: true });

describe("staged custom CSS", () => {
  it("reaches the draft stylesheet only, until published", async () => {
    await appearanceService.saveDraftCustomCss(".staged { color: red; }", T);
    expect(await draft()).toContain(".staged");
    expect(await live()).not.toContain(".staged");
    expect(await appearanceService.getCustomCss(T)).toBe("");
    expect(await appearanceService.getDraftCustomCss(T)).toBe(".staged { color: red; }");
    expect((await appearanceService.getDraftStatus(T))).toMatchObject({ pending: true, css: true, tokens: false });

    expect(await appearanceService.publishDraft(undefined, undefined, T)).toBe(true);
    expect(await live()).toContain(".staged");
    expect(await appearanceService.getDraftStatus(T)).toMatchObject({ pending: false });
  });

  it("refuses a sheet it cannot parse, and stores nothing", async () => {
    await expect(appearanceService.saveDraftCustomCss(".a { color: red;", T)).rejects.toThrow();
    expect(await appearanceService.getDraftStatus(T)).toMatchObject({ css: false });
  });

  it("a draft equal to live is not pending", async () => {
    await appearanceService.saveCustomCss(".same { color: blue; }", T);
    await appearanceService.saveDraftCustomCss(".same { color: blue; }", T);
    expect(await appearanceService.getDraftStatus(T)).toMatchObject({ pending: false });
  });
});

describe("staged font", () => {
  it("merges partial edits over live and goes live on publish", async () => {
    await appearanceService.saveFont({ family: "Inter", weight: "400", size: "16" }, T);
    await appearanceService.saveDraftFont({ family: "Nunito" }, T);
    await appearanceService.saveDraftFont({ size: "17" }, T);

    expect(await appearanceService.getDraftFont(T)).toEqual({ family: "Nunito", weight: "400", size: "17" });
    expect(await appearanceService.getFont(T)).toEqual({ family: "Inter", weight: "400", size: "16" });
    expect(await draft()).toContain("Nunito");
    expect(await live()).not.toContain("Nunito");
    expect(await appearanceService.getDraftStatus(T)).toMatchObject({ pending: true, font: true });

    await appearanceService.publishDraft(undefined, undefined, T);
    expect(await appearanceService.getFont(T)).toEqual({ family: "Nunito", weight: "400", size: "17" });
    expect(await live()).toContain("Nunito");
  });

  it("reset drops the staged font and CSS too", async () => {
    await appearanceService.saveDraftFont({ family: "Nunito" }, T);
    await appearanceService.saveDraftCustomCss(".x { color: red; }", T);
    await appearanceService.resetAppearance(T);
    expect(await appearanceService.getDraftStatus(T)).toMatchObject({ pending: false });
    expect(await draft()).not.toContain(".x");
  });
});

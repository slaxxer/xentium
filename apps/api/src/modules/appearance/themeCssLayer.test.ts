/**
 * Custom CSS, per theme.
 *
 * Each theme's stylesheet is ITS package's CSS followed by the admin's own CSS for that
 * theme. These drive the real service against the disposable test database, because
 * every claim here is about what is stored and in what ORDER it is emitted — which is
 * the whole of the inheritance and exactly what a mock would assume.
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { appearanceService, bustThemeCss } from "./appearance.service.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";

const T = "css-theme";
const OTHER = "css-other";

const wipe = async () => {
  await prisma.setting.deleteMany({ where: { key: { startsWith: "appearance." } } });
  await prisma.theme.deleteMany({ where: { id: { in: [T, OTHER] } } });
  bustSettingsCache();
  bustThemeCss();
};

const install = async (id: string, customCss: string | null) => {
  await prisma.theme.create({
    data: {
      id, name: id, version: "1.0.0", vendor: "test", manifest: { id, name: id },
      payload: { documents: {}, tokens: null, customCss },
    },
  });
  bustThemeCss(id);
};

beforeEach(async () => { assertDisposableDatabase(); await wipe(); });
afterEach(wipe);

describe("a theme's stylesheet", () => {
  it("emits the THEME's css before the admin's, so the admin wins a tie", async () => {
    await install(T, ".a { color: red; }");
    await appearanceService.saveCustomCss(".a { color: blue; }", T);
    const css = await appearanceService.buildCustomCss(T);
    expect(css.indexOf("red")).toBeLessThan(css.indexOf("blue"));
  });

  it("serves the theme's css with no admin css at all", async () => {
    await install(T, ".a { color: red; }");
    expect(await appearanceService.buildCustomCss(T)).toContain("color: red");
  });

  it("keeps one theme's admin css out of another's", async () => {
    await install(T, null);
    await install(OTHER, null);
    await appearanceService.saveCustomCss(".mine { color: blue; }", T);
    expect(await appearanceService.buildCustomCss(OTHER)).not.toContain("blue");
    expect(await appearanceService.buildCustomCss("")).not.toContain("blue");
  });

  it("is read back as the ADMIN layer alone — the console writes back what it reads", async () => {
    await install(T, ".a { color: red; }");
    await appearanceService.saveCustomCss(".b { color: blue; }", T);
    expect(await appearanceService.getCustomCss(T)).toBe(".b { color: blue; }");
    expect(await appearanceService.getThemeCustomCss(T)).toBe(".a { color: red; }");
  });
});

describe("resetAppearance", () => {
  it("drops MY css for that theme and keeps the theme's own", async () => {
    await install(T, ".a { color: red; }");
    await appearanceService.saveCustomCss(".b { color: blue; }", T);
    await appearanceService.resetAppearance(T);
    const css = await appearanceService.buildCustomCss(T);
    expect(css).toContain("red");
    expect(css).not.toContain("blue");
  });

  it("leaves every other theme alone", async () => {
    await install(T, null);
    await appearanceService.saveCustomCss(".core { color: green; }", "");
    await appearanceService.resetAppearance(T);
    expect(await appearanceService.buildCustomCss("")).toContain("green");
  });
});

describe("Core", () => {
  it("still reads the pre-theme single blob", async () => {
    await prisma.setting.create({ data: { key: "appearance.custom_css", value: ".old { color: pink; }" } });
    bustSettingsCache();
    expect(await appearanceService.getCustomCss("")).toBe(".old { color: pink; }");
  });
});

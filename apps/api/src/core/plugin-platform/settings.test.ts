import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { acpPageRegistry } from "../plugin-engine/acp-page-registry.js";
import { PluginContextImpl } from "../plugin-engine/plugin-context.js";
import { _resetSettings, describeSettings, publicSettings, readSettings, writeSettings } from "./settings.js";

const P = "settings-test";
const schema = z.object({
  perPage: z.number().int().min(6).max(96).default(24).meta({ title: "Photos per page", section: "Display", public: true }),
  comments: z.boolean().default(true).meta({ title: "Comments on photos" }),
  layout: z.enum(["grid", "list"]).default("grid"),
  watermark: z.string().max(40).default(""),
});

beforeAll(() => assertDisposableDatabase());
afterEach(async () => {
  _resetSettings();
  acpPageRegistry.deregister(P);
  await prisma.setting.deleteMany({ where: { key: `plugin.${P}` } });
  bustSettingsCache(`plugin.${P}`);
});
afterAll(async () => { await prisma.setting.deleteMany({ where: { key: `plugin.${P}` } }); });

describe("plugin settings", () => {
  it("answers defaults, saves valid values, and types them from the schema", async () => {
    const s = new PluginContextImpl(P).registerSettings({ title: "Gallery", schema });
    expectTypeOf(s.get).returns.resolves.toEqualTypeOf<{ perPage: number; comments: boolean; layout: "grid" | "list"; watermark: string }>();
    expect(await s.get()).toEqual({ perPage: 24, comments: true, layout: "grid", watermark: "" });
    await s.set({ perPage: 48, layout: "list" });
    expect(await s.get()).toEqual({ perPage: 48, comments: true, layout: "list", watermark: "" });
  });

  it("refuses an invalid save as a whole, with a message per key", async () => {
    new PluginContextImpl(P).registerSettings({ schema });
    await expect(writeSettings(P, { perPage: 500, nope: 1, comments: false })).rejects.toMatchObject({
      httpStatus: 422, details: { fields: { perPage: expect.any(String), nope: "Unknown setting" } },
    });
    expect((await readSettings(P)).comments).toBe(true);
  });

  it("falls back per key when a stored value no longer fits", async () => {
    new PluginContextImpl(P).registerSettings({ schema });
    await prisma.setting.create({ data: { key: `plugin.${P}`, value: { perPage: "lots", comments: false } } });
    bustSettingsCache(`plugin.${P}`);
    expect(await readSettings(P)).toMatchObject({ perPage: 24, comments: false });
  });

  it("refuses a schema field with no default", () => {
    expect(() => new PluginContextImpl(P).registerSettings({ schema: z.object({ need: z.string() }) })).toThrow(/default/);
  });

  it("describes the page, files it in the ACP, and shows guests only public keys", async () => {
    new PluginContextImpl(P).registerSettings({ title: "Gallery", schema });
    const d = await describeSettings(P);
    expect(d.schema).toMatchObject({ properties: { perPage: { type: "integer", minimum: 6, maximum: 96, title: "Photos per page", section: "Display" } } });
    expect(acpPageRegistry.getAll()).toContainEqual(expect.objectContaining({ pluginId: P, section: "extensions", label: "Gallery", path: `/admin/addons/${P}/settings` }));
    expect(await publicSettings(P)).toEqual({ perPage: 24 });
  });

  it("has no settings for a plugin that never declared any", async () => {
    await expect(readSettings("nobody")).rejects.toMatchObject({ httpStatus: 404 });
  });
});

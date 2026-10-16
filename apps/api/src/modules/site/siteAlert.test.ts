/**
 * The site alert travels in the public site config. The settings endpoint stores
 * whatever it is sent, so the config is where an unsafe link or an unknown tone
 * is stopped before every visitor's page draws it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { siteService } from "./site.service.js";

async function cleanup() {
  await prisma.setting.deleteMany({ where: { key: { startsWith: "alert." } } });
  bustSettingsCache();
}
async function put(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) await prisma.setting.create({ data: { key, value: value as never } });
  bustSettingsCache();
}

beforeEach(async () => { assertDisposableDatabase(); await cleanup(); });
afterEach(cleanup);

describe("site alert", () => {
  it("is null while off or empty", async () => {
    expect((await siteService.getConfig()).alert).toBeNull();
    await put({ "alert.enabled": true, "alert.message": "   " });
    expect((await siteService.getConfig()).alert).toBeNull();
  });

  it("sends the admin's message with a site link", async () => {
    await put({ "alert.enabled": true, "alert.message": "Upgrade on Sunday", "alert.tone": "warning",
      "alert.link_url": "/articles/upgrade", "alert.link_label": "Read more", "alert.audience": "members" });
    expect((await siteService.getConfig()).alert).toEqual({
      message: "Upgrade on Sunday", tone: "warning", audience: "members", dismissible: true,
      link: { url: "/articles/upgrade", label: "Read more" },
    });
  });

  it("drops an unsafe link and falls back on unknown values", async () => {
    await put({ "alert.enabled": true, "alert.message": "Hi", "alert.tone": "neon",
      "alert.audience": "robots", "alert.link_url": "javascript:alert(1)" });
    const a = (await siteService.getConfig()).alert;
    expect(a).toMatchObject({ tone: "info", audience: "everyone", link: null });
  });
});

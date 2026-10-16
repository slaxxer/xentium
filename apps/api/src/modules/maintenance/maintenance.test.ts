/**
 * The maintenance screen's texts stay locale-agnostic: an unset title, message or bar
 * label is sent EMPTY so each visitor's page shows the core default in their own
 * language, and only what an admin typed travels as written.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { maintenanceService } from "./maintenance.service.js";

const KEYS = ["maintenance.title", "maintenance.message", "maintenance.progress_label"];

async function cleanup() {
  await prisma.setting.deleteMany({ where: { key: { in: KEYS } } });
  bustSettingsCache();
}

async function put(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    await prisma.setting.create({ data: { key, value } });
  }
  bustSettingsCache();
}

beforeEach(async () => {
  assertDisposableDatabase();
  await cleanup();
});
afterEach(cleanup);

describe("maintenance texts", () => {
  it("sends nothing for unset texts, so the page shows its translation", async () => {
    const s = await maintenanceService.getStatus();
    expect([s.title, s.message, s.progress.label]).toEqual(["", "", ""]);
  });

  it("treats the old English defaults, saved verbatim by the settings page, as unset", async () => {
    await put({
      "maintenance.title":          "Down for a quick tune-up.",
      "maintenance.message":        "We're making the community better. We'll be back shortly.",
      "maintenance.progress_label": "In progress",
    });
    const s = await maintenanceService.getStatus();
    expect([s.title, s.message, s.progress.label]).toEqual(["", "", ""]);
  });

  it("sends an admin's own words as written", async () => {
    await put({
      "maintenance.title":          "Kurze Pause",
      "maintenance.message":        "Wir ziehen auf einen neuen Server um.",
      "maintenance.progress_label": "Datenbank",
    });
    const s = await maintenanceService.getStatus();
    expect([s.title, s.message, s.progress.label]).toEqual(["Kurze Pause", "Wir ziehen auf einen neuen Server um.", "Datenbank"]);
  });
});

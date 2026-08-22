/**
 * The CMS's binding of the framework settings reader (`@nodevo/server-kit`).
 *
 * The package owns the TTL cache and the missing-vs-null distinction; this file
 * supplies the one thing it cannot know — that settings live in `ncf_settings`,
 * reached through this application's Prisma client.
 *
 * Writers in this process MUST still call `bustSettingsCache`; other processes
 * converge within the TTL. Reads where staleness is unacceptable use
 * `getFreshSetting`.
 */
import { createSettings } from "@nodevo/server-kit";
import { prisma } from "../../infrastructure/db.js";

const settings = createSettings({
  get:     (key)  => prisma.setting.findUnique({ where: { key },              select: { value: true } }),
  getMany: (keys) => prisma.setting.findMany({ where: { key: { in: keys } },  select: { key: true, value: true } }),
});

export const { getSetting, getFreshSetting, getSettings, bustSettingsCache } = settings;

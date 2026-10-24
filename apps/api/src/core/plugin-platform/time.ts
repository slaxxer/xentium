import type { PluginTime } from "@xentium/plugin-sdk";
import { getSetting } from "../../shared/utils/settings.js";
import { dayKeyIn, startOfDayIn, validZone } from "../../shared/utils/timeZone.js";

/**
 * The site's time zone (ACP → System Settings) on the server. "Each visitor's own"
 * has no zone there, so server work (a reminder, "today") falls back to UTC.
 */
export async function siteZone(): Promise<string> {
  return validZone(await getSetting<string>("site.timezone", "UTC")) ?? "UTC";
}

/** `host.time`. */
export const pluginTime: PluginTime = {
  zone: siteZone,
  startOfDay: async (date = new Date()) => startOfDayIn(await siteZone(), date),
  dayKey: async (date = new Date()) => dayKeyIn(await siteZone(), date),
};

import { XentiumError, XEC } from "@xentium/errors";

/**
 * Plugin routes that stay reachable while the site is in maintenance.
 *
 * Maintenance closes the site to people. Some plugin routes are not for people:
 * other sites calling a store this site runs, a payment provider's webhook, a feed
 * a reader polls. Closing those does not pause anything, it breaks every caller for
 * as long as maintenance lasts. A plugin names them (`ctx.keepOpenDuringMaintenance`),
 * only under its own prefix (`/api/p/<id>`), and loses them when it is disabled.
 */
const open = new Map<string, string[]>();

const PREFIX = /^\/[A-Za-z0-9._~\-/]*$/;

export function keepOpenDuringMaintenance(pluginId: string, prefixes: string[]): void {
  if (!Array.isArray(prefixes) || prefixes.length > 20) {
    throw new XentiumError({ code: XEC.API_VALIDATION, httpStatus: 422, message: "keepOpenDuringMaintenance takes up to 20 path prefixes." });
  }
  const clean = prefixes.map((p) => {
    // "/" alone would open the whole plugin: say so explicitly by listing what is meant.
    if (typeof p !== "string" || p === "/" || !PREFIX.test(p) || p.includes("..") || p.length > 120) {
      throw new XentiumError({
        code: XEC.API_VALIDATION, httpStatus: 422,
        message: `"${String(p)}" is not a path prefix of your routes (like "/v1" or "/webhooks").`,
      });
    }
    return p.replace(/\/+$/, "");
  });
  open.set(pluginId, clean.map((p) => `/api/p/${pluginId}${p}`));
}

export function clearMaintenanceOpen(pluginId: string): void {
  open.delete(pluginId);
}

/** Whether this request path is one a plugin keeps open (the prefix itself, or below it). */
export function isOpenDuringMaintenance(path: string): boolean {
  for (const prefixes of open.values()) {
    if (prefixes.some((p) => path === p || path.startsWith(`${p}/`))) return true;
  }
  return false;
}

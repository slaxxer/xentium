import { prisma } from "../../infrastructure/db.js";
import { getSetting } from "../../shared/utils/settings.js";

// Admins always bypass maintenance regardless of the configured allowed group.
const ALWAYS_ALLOWED = new Set(["admin"]);

export interface MaintenanceStatus {
  enabled: boolean;
  title: string;
  message: string;
  progress: { label: string; percent: number };
  eta: string | null; // ISO timestamp the site is expected back, or null
  allowedGroups: string[]; // group keys allowed to sign in / bypass (admin always allowed)
}

const DEFAULTS = {
  enabled: false,
  title: "Down for a quick tune-up.",
  message: "We're making the community better. We'll be back shortly.",
  progressLabel: "In progress",
  progressPercent: 0,
  eta: "",
  allowedGroups: ["admin"],
};

/** Resolve the configured allow-list, falling back to the legacy single-group
 *  setting (maintenance.allowed_group) so existing installs keep working. */
async function getAllowedGroups(): Promise<string[]> {
  const arr = await getSetting<string[] | null>("maintenance.allowed_groups", null);
  if (Array.isArray(arr)) return arr.length ? arr : ["admin"];
  const legacy = await getSetting<string>("maintenance.allowed_group", "admin");
  return legacy ? [legacy] : ["admin"];
}

export const maintenanceService = {
  async getStatus(): Promise<MaintenanceStatus> {
    const [enabled, title, message, progressLabel, progressPercent, eta, allowedGroups] = await Promise.all([
      getSetting<boolean>("maintenance.enabled", DEFAULTS.enabled),
      getSetting<string>("maintenance.title", DEFAULTS.title),
      getSetting<string>("maintenance.message", DEFAULTS.message),
      getSetting<string>("maintenance.progress_label", DEFAULTS.progressLabel),
      getSetting<number>("maintenance.progress_percent", DEFAULTS.progressPercent),
      getSetting<string>("maintenance.eta", DEFAULTS.eta),
      getAllowedGroups(),
    ]);

    return {
      enabled: !!enabled,
      title,
      message,
      progress: {
        label: progressLabel,
        percent: Math.max(0, Math.min(100, Number(progressPercent) || 0)),
      },
      eta: eta && eta.trim() ? eta : null,
      allowedGroups,
    };
  },

  async isEnabled(): Promise<boolean> {
    return getSetting<boolean>("maintenance.enabled", false);
  },

  /** True when this user may use the site during maintenance (in any allowed
   *  group, or an administrator). */
  async userMayBypass(userId: string): Promise<boolean> {
    const allowed = new Set(await getAllowedGroups());
    const memberships = await prisma.userGroup.findMany({
      where: { userId },
      select: { group: { select: { key: true } } },
    });
    return memberships.some((m) => allowed.has(m.group.key) || ALWAYS_ALLOWED.has(m.group.key));
  },
};

import { prisma } from "../../infrastructure/db.js";
import { getSetting, getSettings } from "../../shared/utils/settings.js";

// Admins always bypass maintenance regardless of the configured allowed group.
const ALWAYS_ALLOWED = new Set(["admin"]);

export type MaintenanceProgressMode = "steps" | "bar" | "hidden";
export type MaintenanceBackground = "aurora" | "solid";
export type MaintenanceServiceStatus = "offline" | "degraded" | "operational";
/** Fixed icon vocabulary for the footer links. The web app renders FontAwesome
 *  through tree-shaken imports, so an admin cannot supply a class name — it
 *  picks from this list and the client maps each key to an icon it bundles. */
export type MaintenanceLinkIcon =
  | "link" | "discord" | "x" | "github" | "mastodon"
  | "telegram" | "youtube" | "status" | "email";

const LINK_ICONS = new Set<string>([
  "link", "discord", "x", "github", "mastodon", "telegram", "youtube", "status", "email",
]);

// The status document is public and uncached at the edge; bound every list so a
// mis-set setting cannot turn the maintenance screen into a large response.
const MAX_STEPS = 12;
const MAX_SERVICES = 12;
const MAX_LINKS = 8;
const MAX_TEXT = 200;

export interface MaintenanceService {
  name: string;
  status: MaintenanceServiceStatus;
}

export interface MaintenanceLink {
  icon: MaintenanceLinkIcon;
  label: string;
  url: string;
}

export interface MaintenanceStatus {
  enabled: boolean;
  title: string;
  message: string;
  progress: {
    mode: MaintenanceProgressMode;
    label: string;
    percent: number;
    steps: string[];
    /** 1-based index of the step in progress; 0 when there are no steps. */
    currentStep: number;
  };
  eta: string | null; // ISO timestamp the site is expected back, or null
  /** Show the hours/minutes/seconds countdown to the ETA. */
  countdown: boolean;
  /** Bring visitors back automatically once maintenance ends. */
  autoRefresh: boolean;
  background: MaintenanceBackground;
  services: MaintenanceService[];
  links: MaintenanceLink[];
  /** Offer the discreet staff sign-in link in the footer. */
  staffLink: boolean;
  allowedGroups: string[]; // group keys allowed to sign in / bypass (admin always allowed)
}

const DEFAULTS = {
  enabled: false,
  title: "Down for a quick tune-up.",
  message: "We're making the community better. We'll be back shortly.",
  progressMode: "bar" as MaintenanceProgressMode,
  progressLabel: "In progress",
  progressPercent: 0,
  steps: [] as string[],
  currentStep: 1,
  eta: "",
  countdown: true,
  autoRefresh: true,
  background: "aurora" as MaintenanceBackground,
  services: [] as MaintenanceService[],
  links: [] as MaintenanceLink[],
  staffLink: true,
  allowedGroups: ["admin"],
};

/** Settings hold whatever the ACP last wrote, so every structured value is
 *  re-checked here rather than trusted into the public response. */
function str(v: unknown, max = MAX_TEXT): string {
  return typeof v === "string" ? v.slice(0, max).trim() : "";
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function normaliseSteps(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((s) => str(s)).filter(Boolean).slice(0, MAX_STEPS);
}

function normaliseServices(v: unknown): MaintenanceService[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const name = str(o.name);
      if (!name) return null;
      return {
        name,
        status: oneOf(o.status, ["offline", "degraded", "operational"] as const, "operational"),
      };
    })
    .filter((s): s is MaintenanceService => s !== null)
    .slice(0, MAX_SERVICES);
}

function normaliseLinks(v: unknown): MaintenanceLink[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const url = str(o.url, 500);
      // Only absolute http(s) links leave this endpoint — a javascript: URL in a
      // setting must never reach an anchor on the public screen.
      if (!/^https?:\/\//i.test(url)) return null;
      const icon = typeof o.icon === "string" && LINK_ICONS.has(o.icon)
        ? (o.icon as MaintenanceLinkIcon)
        : "link";
      return { icon, label: str(o.label, 60), url };
    })
    .filter((l): l is MaintenanceLink => l !== null)
    .slice(0, MAX_LINKS);
}

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
    const [s, allowedGroups] = await Promise.all([
      getSettings({
        "maintenance.enabled":          DEFAULTS.enabled,
        "maintenance.title":            DEFAULTS.title,
        "maintenance.message":          DEFAULTS.message,
        "maintenance.progress_mode":    DEFAULTS.progressMode,
        "maintenance.progress_label":   DEFAULTS.progressLabel,
        "maintenance.progress_percent": DEFAULTS.progressPercent,
        "maintenance.steps":            DEFAULTS.steps as unknown,
        "maintenance.current_step":     DEFAULTS.currentStep,
        "maintenance.eta":              DEFAULTS.eta,
        "maintenance.countdown":        DEFAULTS.countdown,
        "maintenance.auto_refresh":     DEFAULTS.autoRefresh,
        "maintenance.background":       DEFAULTS.background,
        "maintenance.services":         DEFAULTS.services as unknown,
        "maintenance.links":            DEFAULTS.links as unknown,
        "maintenance.staff_link":       DEFAULTS.staffLink,
      }),
      getAllowedGroups(),
    ]);

    const steps = normaliseSteps(s["maintenance.steps"]);
    const currentStep = steps.length
      ? Math.max(1, Math.min(steps.length, Math.round(Number(s["maintenance.current_step"])) || 1))
      : 0;
    const eta = typeof s["maintenance.eta"] === "string" ? s["maintenance.eta"] : "";

    return {
      enabled: !!s["maintenance.enabled"],
      title: String(s["maintenance.title"] ?? DEFAULTS.title),
      message: String(s["maintenance.message"] ?? DEFAULTS.message),
      progress: {
        mode: oneOf(s["maintenance.progress_mode"], ["steps", "bar", "hidden"] as const, DEFAULTS.progressMode),
        label: String(s["maintenance.progress_label"] ?? DEFAULTS.progressLabel),
        percent: Math.max(0, Math.min(100, Number(s["maintenance.progress_percent"]) || 0)),
        steps,
        currentStep,
      },
      eta: eta.trim() ? eta : null,
      countdown: s["maintenance.countdown"] !== false,
      autoRefresh: s["maintenance.auto_refresh"] !== false,
      background: oneOf(s["maintenance.background"], ["aurora", "solid"] as const, DEFAULTS.background),
      services: normaliseServices(s["maintenance.services"]),
      links: normaliseLinks(s["maintenance.links"]),
      staffLink: s["maintenance.staff_link"] !== false,
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

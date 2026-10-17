/**
 * The moderation policy an admin sets on ACP → Moderation → Mod Settings, read in
 * ONE place by everything that enforces it.
 *
 * ⚠ Before this module, the page saved eight settings that nothing on the server
 * read: warnings never expired, the ban range was never checked, and the "warning
 * thresholds" on the page were hard-coded rows that did not save — the ladder that
 * actually ran lived in `moderation.policy` with no editor at all.
 */
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { getSettings } from "../../shared/utils/settings.js";
import { DEFAULT_MODERATION_POLICY, type ThresholdRule } from "./moderation.types.js";

export interface BanPolicy {
  defaultDays:   number;
  minDays:       number;
  maxDays:       number;
  /** A moderator may go outside min/max; the override is written to the mod log. */
  allowOverride: boolean;
}

export interface ModPolicy {
  ladder:        ThresholdRule[];
  bans:          BanPolicy;
  /** Only warnings issued after a member's most recent ban count toward the ladder. */
  resetAfterBan: boolean;
}

/** Settings key → default. The page, the API and the enforcement all use these. */
export const MOD_POLICY_DEFAULTS: Record<string, unknown> = {
  "moderation.policy":                 DEFAULT_MODERATION_POLICY,
  "moderation.default_ban_days":       7,
  "moderation.min_ban_days":           1,
  "moderation.max_ban_days":           365,
  "moderation.ban_allow_override":     true,
  "moderation.reset_count_after_ban":  false,
};

const DAY_MS = 86_400_000;

function ladderOf(raw: unknown): ThresholdRule[] {
  const list = (raw as { thresholds?: unknown } | null)?.thresholds;
  return Array.isArray(list) ? (list as ThresholdRule[]) : DEFAULT_MODERATION_POLICY.thresholds;
}

export async function getModPolicy(): Promise<ModPolicy> {
  const s = await getSettings(MOD_POLICY_DEFAULTS);
  return {
    ladder: ladderOf(s["moderation.policy"]),
    bans: {
      defaultDays:   Number(s["moderation.default_ban_days"]) || 7,
      minDays:       Number(s["moderation.min_ban_days"]) || 1,
      maxDays:       Number(s["moderation.max_ban_days"]) || 365,
      allowOverride: s["moderation.ban_allow_override"] !== false,
    },
    resetAfterBan: s["moderation.reset_count_after_ban"] === true,
  };
}

/**
 * When a new warning stops counting. There is no site-wide rule (retired
 * 2026-10-17): a warning counts for as long as its TEMPLATE says. An explicit date
 * (the admin API) wins; a warning with neither gets the default length.
 */
export function warningExpiry(chosen: Date | null | undefined, now = new Date()): Date | null {
  if (chosen) return chosen;
  return templateWarningExpiry(DEFAULT_WARN_EXPIRY, now);
}

/**
 * Check a temporary ban's length against the range. Outside it, refused unless the
 * policy lets moderators override; returns whether this ban IS an override, so the
 * caller can say so in the mod log. Permanent bans have no length to check.
 */
export function checkBanLength(
  bans: BanPolicy, type: "temporary" | "permanent", expiresAt: Date | null | undefined, now = new Date(),
): { override: boolean; days: number | null } {
  if (type !== "temporary" || !expiresAt) return { override: false, days: null };
  // Round, not ceil: a dialog pre-filled "7 days from now" is a few seconds short of 7.
  const days = Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / DAY_MS));
  const inside = days >= bans.minDays && days <= bans.maxDays;
  if (inside) return { override: false, days };
  if (bans.allowOverride) return { override: true, days };
  throw new XentiumError({
    code: "XEC-API-4001",
    httpStatus: 400,
    message: `A ban must last between ${bans.minDays} and ${bans.maxDays} days`,
    details: { minDays: bans.minDays, maxDays: bans.maxDays, days },
  });
}

/** How long a warning counts. Every warn template carries one. */
export const WARN_EXPIRIES = ["7d", "30d", "90d", "180d", "365d", "never"] as const;
export type WarnExpiry = (typeof WARN_EXPIRIES)[number];
/** What a new warn template starts with, and what a template-less warning gets. */
export const DEFAULT_WARN_EXPIRY: WarnExpiry = "90d";
const EXPIRY_DAYS: Record<WarnExpiry, number | null> = { "7d": 7, "30d": 30, "90d": 90, "180d": 180, "365d": 365, never: null };

/** When a warning of this length, given now, stops counting (null = never). */
export function templateWarningExpiry(expiry: WarnExpiry | null, now = new Date()): Date | null {
  const days = EXPIRY_DAYS[expiry ?? DEFAULT_WARN_EXPIRY];
  return days === null ? null : new Date(now.getTime() + days * DAY_MS);
}

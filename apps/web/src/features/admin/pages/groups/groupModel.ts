/**
 * ACP → Members → Groups, as data: the shapes the pages read, and the rules they
 * derive from them — kept pure so they can be tested without rendering.
 */
import type { Permission } from "../../../../lib/permissions";

export interface GroupProgressionBadge {
  badgeColor: string | null;
  badgeLabel: string | null;
  badgeTextShadow?: boolean;
  badgeShadowColor?: string | null;
  badgeShadowX?: number;
  badgeShadowY?: number;
  badgeShadowBlur?: number;
}

export interface Group {
  id: string;
  name: string;
  key: string;
  icon: string | null;
  /** Relative upload path of the rank image, or null. */
  rankImage?: string | null;
  isSystem: boolean;
  displayOrder: number;
  showInTeam: boolean;
  _count: { users: number; permissions?: number };
  permissions: { permission: Permission }[];
  progression: GroupProgressionBadge | null;
}

export interface ProgressionData extends GroupProgressionBadge {
  isProgressionGroup: boolean;
  ladderPosition: number | null;
  minArticles: number | null;
  minComments: number | null;
  minDaysMember: number | null;
  minLikesReceived: number | null;
  maxArticleLength: number | null;
  maxDailyArticles: number | null;
  maxCommentLength: number | null;
  maxDailyComments: number | null;
  maxProfileImageBytes: number | null;
  allowedProfileImageTypes: string[];
  canUploadCover: boolean;
}

/** What a badge falls back to before an admin picks a colour. */
export const DEFAULT_BADGE_COLOR = "#7c84ff";

/** Hex only: the colour is stored in 20 characters and alpha-suffixed when drawn. */
export const BADGE_SWATCHES = ["#f87171", "#f4a259", "#3ba55d", "#7c84ff", "#2bd4ee", "#b6bbff"];

export const isHexColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

/**
 * Keys that hand a member power over other people, the site or the install.
 * A plugin's keys are judged by the same rule of thumb: anything under `admin.`,
 * `plugin.` or `system.`, or ending in `.manage` / `.settings`.
 */
const SENSITIVE_KEYS = new Set([
  "admin.access", "admin.plugins", "group.manage", "progression.manage", "user.manage", "user.ban",
  "plugin.install", "plugin.enable", "system.tasks.manage", "moderation.settings", "badge.manage",
  "article.edit.any", "article.delete.any",
]);

export function isSensitive(key: string): boolean {
  return SENSITIVE_KEYS.has(key)
    || /^(admin|plugin|system)\./.test(key)
    || /\.(manage|settings)$/.test(key);
}

export type PowerLevel = "full" | "elevated" | "trusted" | "standard";

export interface Power {
  level: PowerLevel;
  /** 1–4 lit segments on the meter. */
  segments: number;
  sensitive: number;
  total: number;
}

/**
 * How much a group can do, from the keys it actually holds. The admin panel is
 * full control on its own, whatever else is or is not granted.
 */
export function powerOf(keys: string[]): Power {
  const sensitive = keys.filter(isSensitive).length;
  const total = keys.length;
  if (keys.includes("admin.access")) return { level: "full", segments: 4, sensitive, total };
  if (sensitive >= 4) return { level: "elevated", segments: 3, sensitive, total };
  if (sensitive >= 1) return { level: "trusted", segments: 2, sensitive, total };
  return { level: "standard", segments: 1, sensitive, total };
}

export const keysOf = (g: Group) => g.permissions.map((gp) => gp.permission.key);

/**
 * Move `fromId` to where `toId` is, and number the result 1..N — the dense
 * sequence `PUT /admin/groups/reorder` expects, so precedence is never a tie.
 * Returns null when nothing would change.
 */
export function reorder(groups: Group[], fromId: string, toId: string): Array<{ id: string; displayOrder: number }> | null {
  const from = groups.findIndex((g) => g.id === fromId);
  const to = groups.findIndex((g) => g.id === toId);
  if (from < 0 || to < 0 || from === to) return null;
  const next = [...groups];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next.map((g, i) => ({ id: g.id, displayOrder: i + 1 }));
}

/** The username text-shadow a badge's glow settings draw. */
export function glowShadow(b: GroupProgressionBadge | null | undefined, color: string): string | undefined {
  if (!b?.badgeTextShadow) return undefined;
  return `${b.badgeShadowX ?? 1}px ${b.badgeShadowY ?? 1}px ${b.badgeShadowBlur ?? 20}px ${b.badgeShadowColor || color}`;
}

/** Every progression field the group page edits — and nothing the server stamps. */
const PROGRESSION_FIELDS = [
  "isProgressionGroup", "ladderPosition", "minArticles", "minComments", "minDaysMember", "minLikesReceived",
  "maxArticleLength", "maxDailyArticles", "maxCommentLength", "maxDailyComments",
  "maxProfileImageBytes", "allowedProfileImageTypes", "canUploadCover",
  "badgeColor", "badgeLabel", "badgeTextShadow", "badgeShadowColor", "badgeShadowX", "badgeShadowY", "badgeShadowBlur",
] as const satisfies ReadonlyArray<keyof ProgressionData>;

/**
 * The editable part of a progression row. ⚠ Autosave compares draft to saved
 * copy; the server's row also carries `updatedAt`, which changes on every save,
 * so comparing whole rows would save forever.
 */
export function editableProgression(row: Record<string, unknown>): ProgressionData {
  const out: Record<string, unknown> = {};
  for (const k of PROGRESSION_FIELDS) out[k] = row[k] ?? null;
  out.allowedProfileImageTypes = Array.isArray(row.allowedProfileImageTypes) ? row.allowedProfileImageTypes : [];
  out.isProgressionGroup = !!row.isProgressionGroup;
  out.canUploadCover = row.canUploadCover !== false;
  out.badgeTextShadow = !!row.badgeTextShadow;
  out.badgeShadowX = typeof row.badgeShadowX === "number" ? row.badgeShadowX : 1;
  out.badgeShadowY = typeof row.badgeShadowY === "number" ? row.badgeShadowY : 1;
  out.badgeShadowBlur = typeof row.badgeShadowBlur === "number" ? row.badgeShadowBlur : 20;
  return out as unknown as ProgressionData;
}

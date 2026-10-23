import type { PluginBirthday, PluginUserRef, PluginUsers } from "@xentium/plugin-sdk";
import { prisma } from "../../infrastructure/db.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { badgeColorSelect, extractBadgeColor } from "../../shared/utils/userRef.js";
import { profileAccess } from "../../modules/users/profilePrivacy.js";

/**
 * Members for plugins (ADR-0011): named exactly as core names them, and only what
 * each member's Account → Privacy allows. A plugin should learn a birthday ONLY
 * through `birthdays`, and decide what a viewer may see of someone through `canSee`.
 */

const MAX_REFS = 500;
const MAX_DAYS = 366;

/** `host.users.refs`: one query for the batch; ids core does not know are left out. */
export async function userRefs(ids: string[]): Promise<Record<string, PluginUserRef>> {
  const unique = [...new Set(ids.filter((i) => typeof i === "string" && i))].slice(0, MAX_REFS);
  if (!unique.length) return {};
  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, username: true, displayName: true, avatar: true, isActive: true, bannedUntil: true, ...badgeColorSelect },
  });
  const now = Date.now();
  return Object.fromEntries(rows.map((u) => [u.id, {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: resolveAvatar(u.avatar),
    badgeColor: extractBadgeColor(u.groups),
    profileUrl: `/u/${encodeURIComponent(u.username)}`,
    // A banned or deactivated member still has a name; a plugin may want to grey it.
    active: u.isActive && !(u.bannedUntil && u.bannedUntil.getTime() > now),
  }]));
}

/** The month-day keys ("MM-DD") from `from` to `to`, both included, in UTC. */
function dayKeys(from: Date, to: Date): string[] {
  const keys = new Set<string>();
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  for (let t = start, n = 0; t <= end && n < MAX_DAYS; t += 86_400_000, n++) {
    const d = new Date(t);
    keys.add(`${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`);
  }
  return [...keys];
}

/**
 * `host.users.birthdays`: members whose birthday falls between `from` and `to` AND
 * who show it. Only members who chose "birthday" in Account → Privacy are listed
 * (those who show their age, or nothing, keep their date to themselves); the date
 * field's own visibility applies (nobody / members only); a block either way hides
 * both from each other; banned and deactivated accounts are left out. Never a year.
 */
export async function birthdays(from: Date, to: Date, viewerId: string | null): Promise<PluginBirthday[]> {
  if (!(from instanceof Date) || !(to instanceof Date) || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return [];
  const field = await prisma.userProfileField.findUnique({ where: { key: "date_of_birth" }, select: { id: true } });
  if (!field) return [];
  const keys = dayKeys(from, to);
  const privacies = viewerId ? ["public", "members"] : ["public"];

  const rows = await prisma.$queryRaw<Array<{ user_id: string; value: string }>>`
    SELECT v.user_id, v.value
      FROM xcf_user_profile_field_values v
      JOIN xcf_users u ON u.id = v.user_id
     WHERE v.field_id = ${field.id}
       AND v.privacy = ANY(${privacies})
       AND u.dob_display = 'birthday'
       AND u."isActive" = true
       AND (u.banned_until IS NULL OR u.banned_until < now())
       AND substring(v.value from 6 for 5) = ANY(${keys})`;

  let hidden = new Set<string>();
  if (viewerId && rows.length) {
    const blocks = await prisma.userBlock.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    });
    hidden = new Set(blocks.map((b) => (b.blockerId === viewerId ? b.blockedId : b.blockerId)));
  }
  return rows
    .filter((r) => !hidden.has(r.user_id) && /^\d{4}-\d{2}-\d{2}/.test(r.value))
    .map((r) => ({ userId: r.user_id, month: Number(r.value.slice(5, 7)), day: Number(r.value.slice(8, 10)) }))
    .sort((a, b) => a.month - b.month || a.day - b.day);
}

/** `host.users.canSee`: the same answer the profile page acts on. */
export async function canSee(viewerId: string | null, userId: string, what: "profile" | "posts"): Promise<boolean> {
  const access = await profileAccess(userId, viewerId ?? undefined);
  return what === "posts" ? access.view && access.history : access.view;
}

export const pluginUsers: PluginUsers = { refs: userRefs, birthdays, canSee };

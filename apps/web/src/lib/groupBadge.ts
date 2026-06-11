/**
 * Group badge ordering. Driven by Group.displayOrder (ACP-configurable, lower =
 * higher priority). System groups default to admin1·supermod2·moderator3·member4;
 * everything else defaults to 100. So an Administrator badge shows before a
 * progression badge like "Supreme", and the order is editable in the ACP.
 */
export function sortGroups<T>(items: T[], orderOf: (i: T) => number | undefined): T[] {
  return [...items].sort((a, b) => (orderOf(a) ?? 100) - (orderOf(b) ?? 100));
}

/** Up to `n` groups, ordered by displayOrder ascending (smaller → greater). */
export function topGroups<T>(items: T[], orderOf: (i: T) => number | undefined, n = 3): T[] {
  return sortGroups(items, orderOf).slice(0, n);
}

/**
 * The effective highlight colour for a username/role. Prefers the group's own
 * badge colour; falls back to the system-staff palette (admin → coral,
 * supermod/moderator → violet) so staff groups without a progression colour
 * still highlight correctly. Returns undefined for plain members (no highlight).
 */
export function roleColor(
  badgeColor: string | null | undefined,
  roleKey: string | null | undefined,
): string | undefined {
  if (badgeColor) return badgeColor;
  if (roleKey === "admin") return "var(--c-accent2)";
  if (roleKey === "supermod" || roleKey === "moderator") return "var(--c-accent)";
  return undefined;
}

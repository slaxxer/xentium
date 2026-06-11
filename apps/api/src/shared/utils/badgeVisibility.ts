/**
 * Per-user badge visibility (Account → Preferences).
 *
 * A user belongs to one or more groups; each group can surface a badge. Users
 * may hide individual group badges from their stack systemwide — those choices
 * live in `User.hiddenBadges` (an array of Group IDs). This helper drops the
 * hidden ones wherever a user's group list is shaped for display.
 */
export function filterHiddenBadges<T extends { group: { id: string } }>(
  groups: T[],
  hidden: string[] | null | undefined,
): T[] {
  if (!hidden || hidden.length === 0) return groups;
  const hide = new Set(hidden);
  return groups.filter((g) => !hide.has(g.group.id));
}

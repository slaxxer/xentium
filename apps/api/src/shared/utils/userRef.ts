import type { UserRef } from "@nodevo/contracts";

// The one way a response names a user: { id, username, badgeColor } (UserRef in
// @nodevo/contracts). Spread badgeColorSelect into a user select (or use
// USER_REF_SELECT outright), then map the row with toUserRef/extractBadgeColor.

/** Deterministic "primary group first" ordering — lowest displayOrder wins.
 *  Every query reading groups[0] MUST order this way, or which badge a
 *  multi-group user gets is Postgres row-order roulette. */
export const primaryGroupOrder = { group: { displayOrder: "asc" } } as const;

/** Select fragment pulling the primary group's badge colour alongside a user. */
export const badgeColorSelect = {
  groups: {
    orderBy: primaryGroupOrder,
    include: {
      group: { select: { progression: { select: { badgeColor: true } } } },
    },
  },
} as const;

/** Full select for a bare UserRef row. */
export const USER_REF_SELECT = { id: true, username: true, ...badgeColorSelect } as const;

type BadgeGroups = Array<{ group: { progression: { badgeColor: string | null } | null } }>;

export function extractBadgeColor(groups: BadgeGroups): string | null {
  return groups[0]?.group.progression?.badgeColor ?? null;
}

export function toUserRef(user: { id: string; username: string; groups: BadgeGroups }): UserRef {
  return { id: user.id, username: user.username, badgeColor: extractBadgeColor(user.groups) };
}

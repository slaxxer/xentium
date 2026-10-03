import type { UserRef } from "@xentium/contracts";

// The one way a response names a user: { id, username, badgeColor } (UserRef in
// @xentium/contracts). Spread badgeColorSelect into a user select (or use
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

type AuthorRef = { username: string; badgeColor?: string | null };
/** An item that may name an author — what a plugin feed or search source returns. */
type MaybeAuthored = { author?: AuthorRef | null };
/** The same item once core has filled in the author's colour. */
type Coloured<T> = T extends { author?: infer A } ? Omit<T, "author"> & { author?: (A & { badgeColor?: string | null }) | null } : T;

/**
 * Give plugin-supplied items' authors their group colour.
 *
 * A plugin feed or search source names its author by `{ username, avatar }` only —
 * it has no way to know core's group colours — so those names drew plain, without
 * the colour or glow every other name on the site has. One query for the whole batch,
 * by username; an author core does not know (or one that already has a colour) is
 * left as it is.
 */
export async function withAuthorBadgeColors<T extends object>(items: T[]): Promise<Array<Coloured<T>>> {
  const authorOf = (i: T) => (i as MaybeAuthored).author;
  const names = [...new Set(items.map((i) => authorOf(i)?.username).filter((u): u is string => !!u))];
  if (names.length === 0) return items as Array<Coloured<T>>;
  const { prisma } = await import("../../infrastructure/db.js");
  const rows = await prisma.user.findMany({
    where:  { username: { in: names } },
    select: { username: true, ...badgeColorSelect },
  });
  const colour = new Map(rows.map((r) => [r.username, extractBadgeColor(r.groups)]));
  return items.map((i) => {
    const a = authorOf(i);
    return (a && a.badgeColor === undefined && colour.has(a.username)
      ? { ...i, author: { ...a, badgeColor: colour.get(a.username) ?? null } }
      : i) as Coloured<T>;
  });
}

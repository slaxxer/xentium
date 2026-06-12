import { prisma } from "../../infrastructure/db.js";

/**
 * User IDs whose content must be hidden from `viewerId`.
 *
 * Blocking always hides content (it is not gated by any privacy toggle), and the
 * effect is mutual: the set contains anyone the viewer has blocked AND anyone who
 * has blocked the viewer. Guests (no viewerId) get an empty set — no filtering.
 *
 * Used to filter article listings, article comments, profile-wall comments, and
 * (via the forum plugin's own equivalent) forum threads/posts.
 */
export async function getHiddenAuthorIds(viewerId?: string): Promise<string[]> {
  if (!viewerId) return [];
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
    select: { blockerId: true, blockedId: true },
  });
  const ids = new Set<string>();
  for (const r of rows) ids.add(r.blockerId === viewerId ? r.blockedId : r.blockerId);
  return [...ids];
}

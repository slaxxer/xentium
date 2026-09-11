import path from "node:path";
import { prisma } from "../../infrastructure/db.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "@nodevo/contracts";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import type { AwardedBadge, BadgeRow } from "./badges.types.js";

/** A stored path becomes a URL; null stays null. */
function iconUrl(icon: string | null): string | null {
  return icon ? storage.publicUrl(icon) : null;
}

/**
 * ⚠ `displayOrder` then `name`, everywhere a badge is listed.
 *
 * The same convention groups use, and for the same reason: without a deterministic
 * tiebreak, which of two badges at order 100 comes first is Postgres row-order
 * roulette, and a user card would quietly reshuffle between requests.
 */
const BADGE_ORDER = [{ displayOrder: "asc" }, { name: "asc" }] as const;

const CATALOGUE_SELECT = {
  id: true, key: true, name: true, description: true,
  icon: true, faIcon: true, color: true, displayOrder: true, isSystem: true,
} as const;

export const badgesService = {
  /** The catalogue, with holder counts — the admin's view. */
  async list(): Promise<BadgeRow[]> {
    const rows = await prisma.badge.findMany({
      orderBy: [...BADGE_ORDER],
      select: { ...CATALOGUE_SELECT, _count: { select: { users: true } } },
    });
    return rows.map(({ _count, ...b }) => ({ ...b, icon: iconUrl(b.icon), holders: _count.users }));
  },

  async create(data: {
    key: string; name: string; description?: string | null;
    faIcon?: string | null; color?: string | null; displayOrder?: number;
  }): Promise<BadgeRow> {
    const existing = await prisma.badge.findUnique({ where: { key: data.key } });
    if (existing) throw NodevoError.conflict(`A badge with the key "${data.key}" already exists`);

    const row = await prisma.badge.create({
      data: {
        key: data.key, name: data.name,
        description: data.description ?? null,
        faIcon: data.faIcon ?? null,
        color: data.color ?? null,
        displayOrder: data.displayOrder ?? 100,
      },
      select: CATALOGUE_SELECT,
    });
    return { ...row, icon: iconUrl(row.icon), holders: 0 };
  },

  async update(id: string, data: {
    name?: string; description?: string | null; faIcon?: string | null;
    color?: string | null; displayOrder?: number;
  }): Promise<BadgeRow> {
    await this.mustExist(id);
    const row = await prisma.badge.update({ where: { id }, data, select: CATALOGUE_SELECT });
    return { ...row, icon: iconUrl(row.icon) };
  },

  /**
   * ⚠ Deleting a badge takes every award of it with it (`onDelete: Cascade`), which
   * is the point — a badge the site no longer recognises must not keep drawing on
   * cards. A system badge is refused: those are seeded, and something else expects
   * the key to be there.
   */
  async remove(id: string): Promise<void> {
    const badge = await this.mustExist(id);
    if (badge.isSystem) {
      throw new NodevoError({
        code: NEC.API_VALIDATION, httpStatus: 400,
        message: "A system badge cannot be deleted",
      });
    }
    await prisma.badge.delete({ where: { id } });
  },

  /**
   * Replace a badge's icon.
   *
   * Named by the badge id, so re-uploading overwrites rather than accumulating —
   * the previous file has no reference the moment the row is updated, and the purge
   * job would sweep it later anyway.
   */
  async uploadIcon(id: string, buffer: Buffer, originalname: string): Promise<string> {
    await this.mustExist(id);
    const ext      = path.extname(originalname).toLowerCase() || ".png";
    const filename = `${id}${ext}`;
    const relPath  = await storage.save("badges", filename, buffer);
    await prisma.badge.update({ where: { id }, data: { icon: relPath } });
    return storage.publicUrl(relPath);
  },

  /** Drop the uploaded icon and fall back to the FontAwesome glyph. */
  async removeIcon(id: string): Promise<BadgeRow> {
    await this.mustExist(id);
    const row = await prisma.badge.update({
      where: { id }, data: { icon: null }, select: CATALOGUE_SELECT,
    });
    return { ...row, icon: null };
  },

  /**
   * Grant a badge.
   *
   * ⚠ An upsert, not a create: a badge is HELD, so granting one twice is the same
   * badge. The second grant refreshes the note rather than failing — an admin
   * correcting a typo in the reason should not have to revoke first.
   */
  async award(userId: string, badgeId: string, awardedById: string, note?: string | null) {
    await this.mustExist(badgeId);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw NodevoError.notFound("User not found");

    await prisma.userBadge.upsert({
      where:  { userId_badgeId: { userId, badgeId } },
      update: { note: note ?? null },
      create: { userId, badgeId, awardedById, note: note ?? null },
    });
    return this.forUser(userId);
  },

  async revoke(userId: string, badgeId: string) {
    await prisma.userBadge.deleteMany({ where: { userId, badgeId } });
    return this.forUser(userId);
  },

  /**
   * The whole catalogue, as a VISITOR may see it.
   *
   * ⚠ Public on purpose, and the reason is the profile rail: the mockup draws the
   * badges a member has NOT earned as locked placeholders, which is only possible
   * if the set of possible badges is knowable. It carries no holder counts and no
   * award data — what a site recognises is public; who holds what is answered per
   * user by `forUser`.
   */
  async publicCatalogue(): Promise<Omit<BadgeRow, "holders" | "isSystem">[]> {
    const rows = await prisma.badge.findMany({
      orderBy: [...BADGE_ORDER],
      select: {
        id: true, key: true, name: true, description: true,
        icon: true, faIcon: true, color: true, displayOrder: true,
      },
    });
    return rows.map((b) => ({ ...b, icon: iconUrl(b.icon) }));
  },

  /** Every badge one user holds, in card order. */
  async forUser(userId: string): Promise<AwardedBadge[]> {
    const rows = await prisma.userBadge.findMany({
      where:   { userId },
      orderBy: [{ badge: { displayOrder: "asc" } }, { badge: { name: "asc" } }],
      select:  { awardedAt: true, note: true, badge: { select: CATALOGUE_SELECT } },
    });
    return rows.map((r) => ({
      id: r.badge.id, key: r.badge.key, name: r.badge.name,
      description: r.badge.description, icon: iconUrl(r.badge.icon),
      faIcon: r.badge.faIcon, color: r.badge.color,
      awardedAt: r.awardedAt.toISOString(), note: r.note,
    }));
  },

  /**
   * Badges for MANY users at once — what a page of user cards asks for.
   *
   * ⚠ One query for the whole page, keyed by id. A card that fetched its own
   * badges would be one request per author in a thread, which is the shape this
   * endpoint exists to avoid. Users with no badges are present with an empty array,
   * so a caller can tell "none" from "not asked about".
   */
  async forUsers(userIds: string[]): Promise<Record<string, AwardedBadge[]>> {
    const out: Record<string, AwardedBadge[]> = {};
    for (const id of userIds) out[id] = [];
    if (userIds.length === 0) return out;

    const rows = await prisma.userBadge.findMany({
      where:   { userId: { in: userIds } },
      orderBy: [{ badge: { displayOrder: "asc" } }, { badge: { name: "asc" } }],
      select:  { userId: true, awardedAt: true, note: true, badge: { select: CATALOGUE_SELECT } },
    });

    for (const r of rows) {
      out[r.userId]?.push({
        id: r.badge.id, key: r.badge.key, name: r.badge.name,
        description: r.badge.description, icon: iconUrl(r.badge.icon),
        faIcon: r.badge.faIcon, color: r.badge.color,
        awardedAt: r.awardedAt.toISOString(), note: r.note,
      });
    }
    return out;
  },

  /** Who holds one badge — the other direction, for the catalogue's detail view. */
  async holders(badgeId: string, limit = 50) {
    await this.mustExist(badgeId);
    const rows = await prisma.userBadge.findMany({
      where:   { badgeId },
      orderBy: { awardedAt: "desc" },
      take:    limit,
      select:  {
        awardedAt: true, note: true,
        user: { select: { id: true, username: true, avatar: true } },
      },
    });
    return rows.map((r) => ({
      id:        r.user.id,
      username:  r.user.username,
      avatar:    r.user.avatar ? storage.publicUrl(r.user.avatar) : null,
      awardedAt: r.awardedAt.toISOString(),
      note:      r.note,
    }));
  },

  async mustExist(id: string) {
    const badge = await prisma.badge.findUnique({
      where: { id }, select: { id: true, isSystem: true },
    });
    if (!badge) throw NodevoError.notFound("Badge not found");
    return badge;
  },
};

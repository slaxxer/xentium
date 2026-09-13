import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { NEC } from "@xentium/contracts";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import { notificationService } from "../notifications/notification.service.js";
import type { AwardedBadge, BadgeHolder, BadgeRow } from "./badges.types.js";

/**
 * ⚠ `displayOrder` then `name`, everywhere a badge is listed.
 *
 * The same convention groups use, and for the same reason: without a deterministic
 * tiebreak, which of two badges at order 100 comes first is Postgres row-order
 * roulette, and a user card would quietly reshuffle between requests.
 */
const BADGE_ORDER = [{ displayOrder: "asc" }, { name: "asc" }] as const;

/** One award, shaped for a card. */
function shapeAward(r: {
  awardedAt: Date; note: string | null; auto: boolean;
  badge: { id: string; key: string; name: string; description: string | null;
           faIcon: string | null; color: string | null };
}): AwardedBadge {
  const b = r.badge;
  return {
    id: b.id, key: b.key, name: b.name, description: b.description,
    faIcon: b.faIcon, color: b.color,
    awardedAt: r.awardedAt.toISOString(),
    note:      r.note,
    source:    r.auto ? "earned" : "manual",
  };
}

const CATALOGUE_SELECT = {
  id: true, key: true, name: true, description: true,
  faIcon: true, color: true, displayOrder: true, isSystem: true,
} as const;

/** The catalogue plus its reward configuration — what the ACP edits. */
const ADMIN_SELECT = { ...CATALOGUE_SELECT, autoAward: true, criteria: true } as const;

/** `criteria` is `Json`; the rest of the app wants numbers keyed by metric. */
function asCriteria(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    const num = Number(n);
    if (Number.isFinite(num) && num > 0) out[k] = num;
  }
  return out;
}

export const badgesService = {
  /** The catalogue, with holder counts — the admin's view. */
  async list(): Promise<BadgeRow[]> {
    const rows = await prisma.badge.findMany({
      orderBy: [...BADGE_ORDER],
      select: {
        ...ADMIN_SELECT,
        _count: { select: { users: true } },
        /**
         * ⚠ Three holders, for the faces on the listing's holders button. A count
         * cannot draw a face, and the panel that has the full list is not open yet.
         * One extra relation query for the WHOLE page, not one per badge — which is
         * why this is a `select` here rather than a fetch per row in the browser.
         */
        users: {
          take:    3,
          orderBy: { awardedAt: "desc" },
          select:  { user: { select: { id: true, username: true, avatar: true } } },
        },
      },
    });
    return rows.map(({ _count, users = [], criteria, ...b }) => ({
      ...b,
      criteria: asCriteria(criteria),
      holders:  _count.users,
      holderPreview: users.map((u) => ({
        id:       u.user.id,
        username: u.user.username,
        avatar:   u.user.avatar ? storage.publicUrl(u.user.avatar) : null,
      })),
    }));
  },

  async create(data: {
    key: string; name: string; description?: string | null;
    faIcon?: string | null; color?: string | null; displayOrder?: number;
    autoAward?: boolean; criteria?: Record<string, number>;
  }): Promise<BadgeRow> {
    const existing = await prisma.badge.findUnique({ where: { key: data.key } });
    if (existing) throw XentiumError.conflict(`A badge with the key "${data.key}" already exists`);

    const row = await prisma.badge.create({
      data: {
        key: data.key, name: data.name,
        description: data.description ?? null,
        faIcon: data.faIcon ?? null,
        color: data.color ?? null,
        displayOrder: data.displayOrder ?? 100,
        autoAward: data.autoAward ?? false,
        criteria:  data.criteria ?? {},
      },
      select: ADMIN_SELECT,
    });
    return { ...row, criteria: asCriteria(row.criteria), holders: 0 };
  },

  async update(id: string, data: {
    name?: string; description?: string | null; faIcon?: string | null;
    color?: string | null; displayOrder?: number;
    autoAward?: boolean; criteria?: Record<string, number>;
  }): Promise<BadgeRow> {
    await this.mustExist(id);
    const row = await prisma.badge.update({ where: { id }, data, select: ADMIN_SELECT });
    return { ...row, criteria: asCriteria(row.criteria) };
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
      throw new XentiumError({
        code: NEC.API_VALIDATION, httpStatus: 400,
        message: "A system badge cannot be deleted",
      });
    }
    await prisma.badge.delete({ where: { id } });
  },

  /**
   * Grant a badge.
   *
   * ⚠ An upsert, not a create: a badge is HELD, so granting one twice is the same
   * badge. The second grant refreshes the note rather than failing — an admin
   * correcting a typo in the reason should not have to revoke first.
   */
  async award(userId: string, badgeId: string, awardedById: string, note?: string | null) {
    const badge = await this.mustExist(badgeId);
    // `username` comes along so the notification can link the member's own profile,
    // which is where the badge they were just given is on show.
    const user = await prisma.user.findUnique({
      where: { id: userId }, select: { id: true, username: true },
    });
    if (!user) throw XentiumError.notFound("User not found");

    /**
     * ⚠ Was it ALREADY held? The upsert cannot say afterwards, and the answer is what
     * decides whether anyone is told. Re-granting is how an admin CORRECTS A NOTE —
     * a correction is not news, and pinging the member every time someone fixes a
     * typo is how a notification bell stops being worth opening.
     */
    const already = await prisma.userBadge.findUnique({
      where:  { userId_badgeId: { userId, badgeId } },
      select: { userId: true },
    });

    await prisma.userBadge.upsert({
      where:  { userId_badgeId: { userId, badgeId } },
      update: { note: note ?? null },
      create: { userId, badgeId, awardedById, note: note ?? null },
    });

    /**
     * Tell them — a badge handed over in silence is one the member may never notice.
     *
     * ⚠ Not for a self-grant: an admin who just gave themselves a badge in the ACP
     * knows about it, and the bell should carry things you did not already do.
     * ⚠ Wrapped, and after the write. The grant is the job and telling is the
     * courtesy; a notification outage must never fail the award or leave the ACP
     * showing an error over a badge that was in fact granted.
     * ⚠ The note is the admin's stated reason, and it is ALREADY public — `forUser`
     * returns it on the profile card — so repeating it to the member exposes nothing
     * new, and it is the part they will actually care about.
     * ⚠ `badge.granted`, not `badge.earned`: both match the "badge.*" preference, so
     * one toggle covers them, but what the member did to get it is different and the
     * stored type should still say which.
     */
    if (!already && awardedById !== userId) {
      try {
        await notificationService.dispatch({
          userId: user.id,
          type:   "badge.granted",
          title:  `You've been given the "${badge.name}" badge!`,
          body:   note?.trim()
            ? note.trim()
            : "It's on your profile now, for everyone who visits.",
          link:     `/u/${user.username}`,
          channels: ["in_app"],
        });
      } catch { /* the badge is granted either way */ }
    }

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
        faIcon: true, color: true, displayOrder: true,
        autoAward: true, criteria: true,
      },
    });
    return rows.map((b) => ({ ...b, criteria: asCriteria(b.criteria) }));
  },

  /** Every badge one user holds, in card order. */
  async forUser(userId: string): Promise<AwardedBadge[]> {
    const rows = await prisma.userBadge.findMany({
      where:   { userId },
      orderBy: [{ badge: { displayOrder: "asc" } }, { badge: { name: "asc" } }],
      select:  { awardedAt: true, note: true, auto: true, badge: { select: CATALOGUE_SELECT } },
    });
    return rows.map(shapeAward);
  },

  /**
   * Badges for MANY users at once — what a page of user cards asks for.
   *
   * ⚠ One query for the whole page, keyed by id. A card that fetched its own badges
   * would be one request per author in a thread, which is the shape this endpoint
   * exists to avoid. Users with no badges are present with an empty array, so a
   * caller can tell "none" from "not asked about".
   */
  async forUsers(userIds: string[]): Promise<Record<string, AwardedBadge[]>> {
    const out: Record<string, AwardedBadge[]> = {};
    for (const id of userIds) out[id] = [];
    if (userIds.length === 0) return out;

    const rows = await prisma.userBadge.findMany({
      where:   { userId: { in: userIds } },
      orderBy: [{ badge: { displayOrder: "asc" } }, { badge: { name: "asc" } }],
      select:  { userId: true, awardedAt: true, note: true, auto: true, badge: { select: CATALOGUE_SELECT } },
    });

    for (const r of rows) out[r.userId]?.push(shapeAward(r));
    return out;
  },

  /** Who holds one badge — the other direction, for the catalogue's detail view. */
  async holders(badgeId: string, limit = 50): Promise<BadgeHolder[]> {
    await this.mustExist(badgeId);
    const rows = await prisma.userBadge.findMany({
      where:   { badgeId },
      orderBy: { awardedAt: "desc" },
      take:    limit,
      select:  {
        // ⚠ `auto` comes along: the panel says how each holder came by the badge,
        // and "no note" does not mean "not given by a person".
        awardedAt: true, note: true, auto: true,
        user: { select: { id: true, username: true, avatar: true } },
      },
    });
    return rows.map((r) => ({
      id:        r.user.id,
      username:  r.user.username,
      avatar:    r.user.avatar ? storage.publicUrl(r.user.avatar) : null,
      awardedAt: r.awardedAt.toISOString(),
      note:      r.note,
      auto:      r.auto,
    }));
  },

  async mustExist(id: string) {
    const badge = await prisma.badge.findUnique({
      where: { id }, select: { id: true, name: true, isSystem: true },
    });
    if (!badge) throw XentiumError.notFound("Badge not found");
    return badge;
  },
};

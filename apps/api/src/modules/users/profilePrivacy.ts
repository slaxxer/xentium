/**
 * What a member's Account → Privacy settings allow ANOTHER person to do with their
 * profile, decided in one place. Every setting the Privacy tab offers is enforced
 * here on the server; the profile response carries the answers so the page can hide
 * what would only be refused.
 *
 * Unset settings are the tab's defaults: everything open. A block counts both ways:
 * neither side may follow the other or post on the other's wall.
 */
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";

export interface ProfileAccess {
  /** May open the profile page and its parts (wall, follow lists, fields, visitors). */
  view: boolean;
  follow: boolean;
  /** May post on the wall, or reply there. */
  comment: boolean;
  /** May see the member's post history (their articles on the profile). */
  history: boolean;
}

const ALL: ProfileAccess = { view: true, follow: true, comment: true, history: true };

async function settingsOf(userId: string): Promise<Record<string, unknown>> {
  const row = await prisma.userPrivacySettings.findUnique({ where: { userId }, select: { settings: true } });
  return (row?.settings ?? {}) as Record<string, unknown>;
}

export async function profileAccess(ownerId: string, viewerId: string | undefined): Promise<ProfileAccess> {
  if (viewerId && viewerId === ownerId) return ALL;
  const s = await settingsOf(ownerId);
  const member = !!viewerId;

  const view = s.profileVisibility === "members" ? member : true;
  const history = s.postHistoryVisibility === "nobody" ? false
    : s.postHistoryVisibility === "members" ? member
    : true;
  if (!viewerId) return { view, follow: false, comment: false, history };

  const [blocked, ownerFollowsViewer] = await Promise.all([
    prisma.userBlock.findFirst({
      where: { OR: [{ blockerId: ownerId, blockedId: viewerId }, { blockerId: viewerId, blockedId: ownerId }] },
      select: { id: true },
    }),
    s.whoCanComment === "following"
      ? prisma.userFollow.findUnique({ where: { followerId_followingId: { followerId: ownerId, followingId: viewerId } }, select: { followerId: true } })
      : Promise.resolve(null),
  ]);

  const follow = !blocked && s.whoCanFollow !== "nobody";
  const comment = !blocked && s.allowProfileComments !== false && (
    s.whoCanComment === "nobody" ? false
      : s.whoCanComment === "following" ? !!ownerFollowsViewer
      : true
  );
  return { view, follow, comment, history };
}

/** Refuse a guest a members-only profile (and every part of it). */
export async function assertProfileVisible(ownerId: string, viewerId: string | undefined): Promise<void> {
  if (!(await profileAccess(ownerId, viewerId)).view) {
    throw new XentiumError({ code: "XEC-USER-4021", httpStatus: 403, message: "This profile is visible to members only" });
  }
}

/** Refuse a follow the member's settings (or a block) don't allow. */
export async function assertCanFollow(ownerId: string, viewerId: string): Promise<void> {
  if (!(await profileAccess(ownerId, viewerId)).follow) {
    throw new XentiumError({ code: "XEC-USER-4022", httpStatus: 403, message: "This member can't be followed" });
  }
}

/** Refuse a wall post the member's settings (or a block) don't allow. */
export async function assertCanComment(ownerId: string, viewerId: string): Promise<void> {
  if (!(await profileAccess(ownerId, viewerId)).comment) {
    throw new XentiumError({ code: "XEC-USER-4023", httpStatus: 403, message: "This member's wall is closed to you" });
  }
}

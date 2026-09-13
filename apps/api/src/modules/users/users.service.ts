import { prisma } from "../../infrastructure/db.js";
import { userRepository } from "./users.repository.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { notificationService } from "../notifications/notification.service.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { filterHiddenBadges } from "../../shared/utils/badgeVisibility.js";
import { getHiddenAuthorIds } from "../../shared/utils/blocks.js";
import { getSetting } from "../../shared/utils/settings.js";
import { buildPaginationMeta } from "@nodevo/contracts";

function formatDobValue(value: string, format: string | null): string {
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  switch (format) {
    case "birthday":
      return date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
    case "full":
      return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    default: {
      const now = new Date();
      let age = now.getFullYear() - date.getFullYear();
      if (
        now.getMonth() < date.getMonth() ||
        (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())
      ) {
        age--;
      }
      return `${age} years old`;
    }
  }
}

/** Extract @usernames from comment body text. */
function extractMentions(body: string): string[] {
  const regex = /@(\w+)/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = regex.exec(body)) !== null) {
    if (m[1]) found.add(m[1].toLowerCase());
  }
  return Array.from(found);
}

/** Enforce the "Show my follower/following list publicly" privacy toggles (§37).
 *  The list owner can always view their own lists; everyone else is blocked
 *  with 403 when the toggle is off. Toggles default to public (true) when unset,
 *  matching the account Privacy tab defaults. */
async function assertFollowListVisible(
  targetUserId: string,
  key: "showFollowersPublic" | "showFollowingPublic",
  viewerId?: string,
): Promise<void> {
  if (viewerId && viewerId === targetUserId) return; // owner sees own lists
  const row = await prisma.userPrivacySettings.findUnique({
    where:  { userId: targetUserId },
    select: { settings: true },
  });
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  if (settings[key] === false) {
    throw new XentiumError({ code: "NEC-USER-4014", httpStatus: 403, message: "This list is private" });
  }
}

/** Resolve the visible DOB label for the profile header.
 *  Reads dobDisplay from the User row: 'hidden' | 'age' | 'birthday'. */
async function getDobLabelForUser(userId: string, dobDisplay: string): Promise<string | null> {
  if (dobDisplay === "hidden") return null;
  const field = await prisma.userProfileField.findUnique({ where: { key: "date_of_birth" } });
  if (!field) return null;
  const value = await prisma.userProfileFieldValue.findUnique({
    where: { userId_fieldId: { userId, fieldId: field.id } },
  });
  if (!value || !value.value || value.privacy === "nobody") return null;
  // Pass the format directly — 'birthday' or default (age)
  return formatDobValue(value.value, dobDisplay === "birthday" ? "birthday" : null);
}

export const userService = {
  async getPublicProfile(username: string, viewerId?: string) {
    const user = await userRepository.findByUsername(username);
    if (!user) throw new XentiumError({ code: 'NEC-USER-1001', httpStatus: 404, message: 'User not found' });

    const groups = await prisma.userGroup.findMany({
      where: { userId: user.id },
      include: {
        group: {
          include: { progression: { select: { badgeColor: true, badgeLabel: true } } },
        },
      },
    });
    // Badge precedence is Group.displayOrder (ACP-configurable; lower = higher).

    const isOwnProfile = viewerId === user.id;
    let isFollowing = false;
    let viewerHasBlocked = false;
    if (viewerId && !isOwnProfile) {
      isFollowing = await userRepository.isFollowing(viewerId, user.id);
      viewerHasBlocked = await userRepository.isBlocking(viewerId, user.id);
    }

    const dobLabel = await getDobLabelForUser(user.id, user.dobDisplay);
    const dobDisplayFormat = user.dobDisplay === "hidden" ? null : user.dobDisplay;

    // Former usernames ("previously known as …"). Admin-controlled and NOT a
    // privacy setting — users cannot hide it; shown for a rolling window (days).
    const previousUsernames: { username: string; changedAt: Date }[] = [];
    if ((await getSetting("profile.show_previous_usernames", true)) === true) {
      const days = Number(await getSetting("profile.previous_username_days", 90)) || 0;
      const rows = await prisma.usernameHistory.findMany({
        where: {
          userId: user.id,
          ...(days > 0 ? { changedAt: { gte: new Date(Date.now() - days * 86_400_000) } } : {}),
        },
        orderBy: { changedAt: "desc" },
        select: { oldUsername: true, changedAt: true },
      });
      // Collapse repeat changes to the same handle; keep the most recent per name.
      const seen = new Set<string>();
      for (const r of rows) {
        const key = r.oldUsername.toLowerCase();
        if (key === user.username.toLowerCase() || seen.has(key)) continue;
        seen.add(key);
        previousUsernames.push({ username: r.oldUsername, changedAt: r.changedAt });
      }
    }

    // Display-name preference (§37 privacy). Full name comes from displayName; the
    // username always remains the @handle. Falls back to username when unset/empty.
    const privacy = ((await prisma.userPrivacySettings.findUnique({ where: { userId: user.id } }))?.settings ?? {}) as Record<string, unknown>;
    const namePreference = privacy.displayNamePreference === "fullName" && user.displayName ? "fullName" : "username";

    // Ban state for the public profile badge. Permanent bans use the 9999-12-31 sentinel.
    const isBanned = !!user.bannedUntil && user.bannedUntil.getTime() > Date.now();
    const isPermanentBan = isBanned && user.bannedUntil!.getUTCFullYear() >= 9999;

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? null,
      namePreference,
      previousUsernames,
      avatar: resolveAvatar(user.avatar),
      // The member's OWN cover. Null falls back to whatever the `profileCover` block
      // draws — an admin's band, or the palette gradient.
      coverImage: resolveAvatar(user.coverImage),
      bio: user.bio,
      joinedDate: user.createdAt,
      groups: filterHiddenBadges(groups, user.hiddenBadges)
        .slice()
        .sort((a, b) => (a.group.displayOrder ?? 100) - (b.group.displayOrder ?? 100))
        .map((g) => ({
          id:           g.group.id,
          name:         g.group.name,
          key:          g.group.key,
          icon:         g.group.icon ?? null,
          displayOrder: g.group.displayOrder,
          badgeColor:   g.group.progression?.badgeColor ?? null,
          badgeLabel:   g.group.progression?.badgeLabel ?? null,
        })),
      postCount:         user.postCount,
      articleCount:      user.articleCount,
      followerCount:     user.followerCount,
      followingCount:    user.followingCount,
      likeCountReceived: user.likeCountReceived,
      dobLabel,
      dobDisplayFormat,
      isOwn: isOwnProfile,
      viewerIsFollowing: isFollowing,
      viewerHasBlocked,
      isBanned,
      isPermanentBan,
    };
  },

  async followUser(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new XentiumError({ code: 'NEC-USER-4001', httpStatus: 400, message: 'Cannot follow yourself' });
    }
    const already = await userRepository.isFollowing(followerId, followingId);
    if (already) return;

    await prisma.$transaction(async (tx) => {
      await tx.userFollow.create({ data: { followerId, followingId } });
      await tx.user.update({ where: { id: followerId }, data: { followingCount: { increment: 1 } } });
      await tx.user.update({ where: { id: followingId }, data: { followerCount: { increment: 1 } } });
    });

    const follower = await userRepository.findById(followerId);
    if (follower) {
      await notificationService.dispatch({
        userId:        followingId,
        type:          "social.new_follower",
        title:         "New follower",
        body:          `${follower.username} started following you.`,
        link:          `/u/${follower.username}`,
        meta:          { followerId },
        senderUserId:  followerId,
        channels:      ["in_app", "email"],
      });
    }
  },

  async unfollowUser(followerId: string, followingId: string) {
    if (followerId === followingId) return;
    await prisma.$transaction(async (tx) => {
      await tx.userFollow.delete({ where: { followerId_followingId: { followerId, followingId } } });
      await tx.user.update({ where: { id: followerId }, data: { followingCount: { decrement: 1 } } });
      await tx.user.update({ where: { id: followingId }, data: { followerCount: { decrement: 1 } } });
    });
  },

  async createProfileComment(profileUserId: string, authorId: string, body: string) {
    if (profileUserId === authorId) {
      throw new XentiumError({ code: 'NEC-USER-4002', httpStatus: 400, message: 'Cannot comment on your own profile' });
    }
    const comment = await userRepository.createProfileComment({ profileUserId, authorId, body });

    const [author, profileOwner] = await Promise.all([
      userRepository.findById(authorId),
      userRepository.findById(profileUserId),
    ]);

    if (author && profileOwner) {
      // Notify the profile owner
      await notificationService.dispatch({
        userId:       profileUserId,
        type:         "profile.comment_posted",
        title:        "New comment on your profile",
        body:         `${author.username} posted on your profile.`,
        link:         `/u/${profileOwner.username}`,
        meta:         { commentId: comment.id, authorId },
        senderUserId: authorId,
        channels:     ["in_app", "email"],
      });

      // Notify mentioned users (skip author and profile owner — they already get a notif)
      const mentionedUsernames = extractMentions(body);
      if (mentionedUsernames.length > 0) {
        const mentionedUsers = await prisma.user.findMany({
          where: {
            username: { in: mentionedUsernames, mode: "insensitive" },
            isActive: true,
            id: { notIn: [authorId, profileUserId] },
          },
          select: { id: true },
        });
        await Promise.all(
          mentionedUsers.map((u) =>
            notificationService.dispatch({
              userId:       u.id,
              type:         "mention.profile_comment",
              title:        "You were mentioned",
              body:         `${author.username} mentioned you in a comment on ${profileOwner.username}'s profile.`,
              link:         `/u/${profileOwner.username}`,
              meta:         { commentId: comment.id, authorId },
              senderUserId: authorId,
              channels:     ["in_app", "email"],
            }),
          ),
        );
      }
    }

    return comment;
  },

  async getProfileComments(profileUserId: string, page: number, limit: number, viewerId?: string) {
    const hiddenAuthorIds = await getHiddenAuthorIds(viewerId);
    return userRepository.getProfileComments(profileUserId, page, limit, hiddenAuthorIds);
  },

  async updateProfileComment(commentId: string, body: string, userId: string) {
    const comment = await userRepository.getProfileCommentById(commentId);
    if (!comment) throw new XentiumError({ code: 'NEC-USER-4003', httpStatus: 404, message: 'Comment not found' });
    if (comment.authorId !== userId) {
      throw new XentiumError({ code: 'NEC-USER-4004', httpStatus: 403, message: "Cannot edit another user's comment" });
    }
    // Check edit window (optional, can be done in service)
    return userRepository.updateProfileComment(commentId, body, userId);
  },

  async deleteProfileComment(commentId: string, userId: string, isModerator = false) {
    const comment = await userRepository.getProfileCommentById(commentId);
    if (!comment) throw new XentiumError({ code: 'NEC-USER-4003', httpStatus: 404, message: 'Comment not found' });
    const isOwner = comment.authorId === userId;
    const isProfileOwner = comment.profileUserId === userId;
    if (!isOwner && !isProfileOwner && !isModerator) {
      throw new XentiumError({ code: 'NEC-USER-4005', httpStatus: 403, message: 'Not authorized to delete this comment' });
    }
    const deletedBy = isModerator ? userId : isOwner ? userId : comment.profileUserId;
    return userRepository.softDeleteProfileComment(commentId, deletedBy);
  },

  async getFollowers(userId: string, page: number, limit: number, viewerId?: string) {
    await assertFollowListVisible(userId, "showFollowersPublic", viewerId);
    return userRepository.getFollowers(userId, page, limit);
  },

  async getFollowing(userId: string, page: number, limit: number, viewerId?: string) {
    await assertFollowListVisible(userId, "showFollowingPublic", viewerId);
    return userRepository.getFollowing(userId, page, limit);
  },

  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new XentiumError({ code: 'NEC-USER-4006', httpStatus: 400, message: 'Cannot block yourself' });
    }
    const already = await userRepository.isBlocking(blockerId, blockedId);
    if (already) return;

    await prisma.$transaction(async (tx) => {
      await tx.userBlock.create({ data: { blockerId, blockedId } });
      // Remove follows in both directions
      await tx.userFollow.deleteMany({
        where: {
          OR: [
            { followerId: blockerId, followingId: blockedId },
            { followerId: blockedId, followingId: blockerId },
          ],
        },
      });
      // Recalculate follow counters for both users
      const [blockerFollowingCount, blockerFollowerCount, blockedFollowingCount, blockedFollowerCount] =
        await Promise.all([
          tx.userFollow.count({ where: { followerId: blockerId } }),
          tx.userFollow.count({ where: { followingId: blockerId } }),
          tx.userFollow.count({ where: { followerId: blockedId } }),
          tx.userFollow.count({ where: { followingId: blockedId } }),
        ]);
      await Promise.all([
        tx.user.update({ where: { id: blockerId }, data: { followingCount: blockerFollowingCount, followerCount: blockerFollowerCount } }),
        tx.user.update({ where: { id: blockedId }, data: { followingCount: blockedFollowingCount, followerCount: blockedFollowerCount } }),
      ]);
    });
  },

  async unblockUser(blockerId: string, blockedId: string) {
    const existing = await userRepository.isBlocking(blockerId, blockedId);
    if (!existing) return;
    await userRepository.unblockUser(blockerId, blockedId);
  },

  async getMyBlocks(userId: string, page: number, limit: number) {
    return userRepository.getBlocks(userId, page, limit);
  },

  async searchUsers(query: string, limit: number, excludeId?: string) {
    return userRepository.searchByUsernamePrefixes(query, limit, excludeId);
  },

  async getSuggested(viewerId: string, limit: number) {
    return userRepository.getSuggested(viewerId, limit);
  },

  async listMembers(opts: { page: number; limit: number; q?: string; filter?: string; sort?: string }) {
    const { rows, total, facets } = await userRepository.listMembers(opts);
    return { data: rows, meta: buildPaginationMeta({ page: opts.page, limit: opts.limit, total }), facets };
  },

  async listTeam() {
    return userRepository.listTeam();
  },

  async getHallOfFame(limit: number) {
    return userRepository.getHallOfFame(limit);
  },

  async likeProfileComment(commentId: string, userId: string): Promise<void> {
    const comment = await prisma.profileComment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true, profileUserId: true, deletedAt: true },
    });
    if (!comment || comment.deletedAt) {
      throw new XentiumError({ code: 'NEC-USER-4007', httpStatus: 404, message: 'Comment not found' });
    }

    let isNew = false;
    await prisma.$transaction(async (tx) => {
      try {
        await tx.profileCommentLike.create({ data: { commentId, userId } });
        isNew = true;
      } catch (err: any) {
        if (err?.code === 'P2002') return; // already liked, idempotent
        throw err;
      }
      await tx.profileComment.update({
        where: { id: commentId },
        data: { likeCount: { increment: 1 } },
      });
      await tx.user.update({
        where: { id: comment.authorId },
        data: { likeCountReceived: { increment: 1 } },
      });
    });

    if (isNew && comment.authorId !== userId) {
      const liker = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
      const profileOwner = await prisma.user.findUnique({ where: { id: comment.profileUserId }, select: { username: true } });
      if (liker && profileOwner) {
        await notificationService.dispatch({
          userId:       comment.authorId,
          type:         'profile.comment_liked',
          title:        'Someone liked your comment',
          body:         `${liker.username} liked your comment on ${profileOwner.username}'s profile.`,
          link:         `/u/${profileOwner.username}`,
          meta:         { commentId, likerId: userId },
          senderUserId: userId,
          channels:     ['in_app'],
        });
      }
    }
  },

  async unlikeProfileComment(commentId: string, userId: string): Promise<void> {
    const comment = await prisma.profileComment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true, deletedAt: true },
    });
    if (!comment) return;

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.profileCommentLike.deleteMany({ where: { commentId, userId } });
      if (deleted.count === 0) return;
      await tx.profileComment.update({
        where: { id: commentId },
        data: { likeCount: { decrement: 1 } },
      });
      await tx.user.update({
        where: { id: comment.authorId },
        data: { likeCountReceived: { decrement: 1 } },
      });
    });
  },

  async getProfileFieldDefinitions() {
    return prisma.userProfileField.findMany({ orderBy: { position: "asc" } });
  },

  async getUserPublicProfileFields(userId: string, isAuthenticated: boolean) {
    const [fields, values] = await Promise.all([
      prisma.userProfileField.findMany({
        where: { showOnProfile: true },
        orderBy: { position: "asc" },
      }),
      prisma.userProfileFieldValue.findMany({ where: { userId } }),
    ]);

    const valueMap = new Map(values.map((v) => [v.fieldId, v]));

    return fields
      .map((f) => {
        const entry = valueMap.get(f.id);
        if (!entry || !entry.value.trim()) return null;
        if (entry.privacy === "nobody") return null;
        if (entry.privacy === "members" && !isAuthenticated) return null;

        const displayValue =
          f.type === "date" ? formatDobValue(entry.value, f.dobDisplayFormat) : entry.value;

        return { key: f.key, label: f.label, type: f.type, value: displayValue };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  },
};

import { staffGroupKeys } from "../../shared/utils/staff.js";
import { prisma } from "../../infrastructure/db.js";
import { withResolvedAvatar, withResolvedAvatarList, resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { getOnlineUserIds } from "../../shared/utils/presence.js";
import { sanitizeRichText } from "../../shared/sanitize/richText.js";
import { primaryGroupOrder } from "../../shared/utils/userRef.js";

/* ── Members directory shaping ──────────────────────────────────────────── */
const MEMBER_SELECT = {
  id: true, username: true, displayName: true, bio: true, avatar: true, createdAt: true,
  bannedUntil: true,
  postCount: true, threadCount: true, followerCount: true, likeCountReceived: true,
  groups: {
    include: {
      group: {
        select: {
          name: true, key: true, displayOrder: true,
          progression: { select: { badgeColor: true, badgeLabel: true } },
        },
      },
    },
  },
} as const;

/** Badge precedence is driven by Group.displayOrder (ACP-configurable; lower = higher). */
function groupRank(g: any): number {
  return g?.displayOrder ?? 100;
}

/** The primary group drives the role badge — lowest displayOrder wins
    (Administrator over a progression badge like "Supreme"). */
function pickPrimaryGroup(u: any) {
  const groups = (u.groups ?? []).map((ug: any) => ug.group);
  if (groups.length === 0) return null;
  return [...groups].sort((a: any, b: any) => groupRank(a) - groupRank(b))[0];
}

function shapeMember(u: any) {
  const g = pickPrimaryGroup(u);
  // Permanent bans use the 9999-12-31 sentinel (§43).
  const banned = !!u.bannedUntil && new Date(u.bannedUntil).getTime() > Date.now();
  const permanentBan = banned && new Date(u.bannedUntil).getUTCFullYear() >= 9999;
  return {
    id: u.id,
    username: u.username,
    banned,
    permanentBan,
    displayName: u.displayName ?? null,
    bio: u.bio ?? null,
    avatar: resolveAvatar(u.avatar),
    joinedAt: u.createdAt,
    postCount: u.postCount,
    threadCount: u.threadCount,
    followerCount: u.followerCount,
    likeCountReceived: u.likeCountReceived,
    role: g?.progression?.badgeLabel ?? g?.name ?? null,
    roleKey: g?.key ?? null,
    badgeColor: g?.progression?.badgeColor ?? null,
    online: false as boolean,
  };
}

/** Lightweight shape for follower/following lists — enough for <Username> to
    render the group badge colour + glow (roleKey drives the staff-colour fallback). */
function shapeConnection(u: any) {
  const g = pickPrimaryGroup(u);
  return {
    id: u.id,
    username: u.username,
    avatar: u.avatar,
    bio: u.bio ?? null,
    badgeColor: g?.progression?.badgeColor ?? null,
    roleKey: g?.key ?? null,
  };
}

const CONNECTION_USER_SELECT = {
  id: true, username: true, avatar: true, bio: true,
  groups: {
    include: {
      group: { select: { key: true, displayOrder: true, progression: { select: { badgeColor: true } } } },
    },
  },
} as const;


export const userRepository = {
  // Get user by ID (internal)
  async findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  // Get user by username (username) – we'll treat username as unique username
  async findByUsername(username: string) {
    return prisma.user.findUnique({ where: { username } });
  },

  // Get user with groups
  async getUserWithGroups(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      include: {
        groups: {
          include: { group: true },
        },
      },
    });
  },

  // Get user's articles (for profile) – Phase 5, temporarily disabled
  // async getUserArticles(userId: string, limit = 5) {
  //   return prisma.article.findMany({
  //     where: { authorId: userId, deletedAt: null, status: "published" },
  //     orderBy: { publishedAt: "desc" },
  //     take: limit,
  //     include: {
  //       category: true,
  //       author: { select: { username: true, avatar: true } },
  //     },
  //   });
  // },

  // Follow
  async follow(followerId: string, followingId: string) {
    return prisma.userFollow.create({
      data: { followerId, followingId },
    });
  },

  async unfollow(followerId: string, followingId: string) {
    return prisma.userFollow.delete({
      where: { followerId_followingId: { followerId, followingId } },
    });
  },

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const follow = await prisma.userFollow.findUnique({
      where: { followerId_followingId: { followerId, followingId } },
    });
    return !!follow;
  },

  // Profile comments
  async createProfileComment(data: { profileUserId: string; authorId: string; body: string; parentId?: string }) {
    return prisma.profileComment.create({ data: { ...data, body: sanitizeRichText(data.body) } });
  },

  /**
   * A page of the wall: top-level comments, newest first, each with ALL its replies,
   * oldest first (a conversation reads down). Paging and `total` count top-level ones.
   * A deleted comment is simply gone — no tombstone, no name of who removed it — and
   * a deleted top-level comment takes its replies with it.
   */
  async getProfileComments(profileUserId: string, page: number, limit: number, hiddenAuthorIds: string[] = []) {
    const skip = (page - 1) * limit;
    const authorFilter = hiddenAuthorIds.length ? { authorId: { notIn: hiddenAuthorIds } } : {};
    const include = {
      author: {
        select: {
          id: true, username: true, avatar: true,
          groups: {
            orderBy: primaryGroupOrder,
            include: {
              group: { select: { progression: { select: { badgeColor: true } } } },
            },
          },
        },
      },
    } as const;
    const [comments, total] = await Promise.all([
      prisma.profileComment.findMany({
        where:   { profileUserId, parentId: null, deletedAt: null, ...authorFilter },
        include: {
          ...include,
          replies: { where: { deletedAt: null, ...authorFilter }, include, orderBy: { createdAt: "asc" } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.profileComment.count({ where: { profileUserId, parentId: null, deletedAt: null, ...authorFilter } }),
    ]);
    type Row = (typeof comments)[number] | (typeof comments)[number]["replies"][number];
    const shape = <T extends Row>(c: T) => ({
      ...c,
      author: {
        ...withResolvedAvatar(c.author),
        badgeColor: c.author.groups[0]?.group.progression?.badgeColor ?? null,
      },
    });
    return {
      comments: comments.map((c) => ({ ...shape(c), replies: c.replies.map(shape) })),
      total,
    };
  },

  async updateProfileComment(id: string, body: string, userId: string) {
    return prisma.profileComment.update({
      where: { id, authorId: userId },
      data: { body: sanitizeRichText(body), editedAt: new Date() },
    });
  },

  async softDeleteProfileComment(id: string, deletedById: string, reason?: string) {
    return prisma.profileComment.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById, deletedReason: reason },
    });
  },

  async getProfileCommentById(id: string) {
    return prisma.profileComment.findUnique({ where: { id } });
  },

  // Followers / Following
  async getFollowers(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      prisma.userFollow.findMany({
        where: { followingId: userId },
        include: { follower: { select: CONNECTION_USER_SELECT } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.userFollow.count({ where: { followingId: userId } }),
    ]);
    return { items: withResolvedAvatarList(rows.map((r) => r.follower)).map(shapeConnection), total };
  },

  async getFollowing(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      prisma.userFollow.findMany({
        where: { followerId: userId },
        include: { following: { select: CONNECTION_USER_SELECT } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.userFollow.count({ where: { followerId: userId } }),
    ]);
    return { items: withResolvedAvatarList(rows.map((r) => r.following)).map(shapeConnection), total };
  },

  // Blocks
  async blockUser(blockerId: string, blockedId: string) {
    return prisma.userBlock.create({ data: { blockerId, blockedId } });
  },

  async unblockUser(blockerId: string, blockedId: string) {
    return prisma.userBlock.delete({
      where: { blockerId_blockedId: { blockerId, blockedId } },
    });
  },

  async isBlocking(blockerId: string, blockedId: string): Promise<boolean> {
    const row = await prisma.userBlock.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId } },
    });
    return !!row;
  },

  async getBlocks(blockerId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      prisma.userBlock.findMany({
        where: { blockerId },
        include: { blocked: { select: { id: true, username: true, avatar: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.userBlock.count({ where: { blockerId } }),
    ]);
    return { items: withResolvedAvatarList(rows.map((r) => r.blocked)), total };
  },

  /** People to suggest following: active, not self, not already followed, not blocked
      (either direction), ranked by followers then likes received. */
  async getSuggested(viewerId: string, limit: number) {
    const [following, blocked, blockedBy] = await Promise.all([
      prisma.userFollow.findMany({ where: { followerId: viewerId }, select: { followingId: true } }),
      prisma.userBlock.findMany({ where: { blockerId: viewerId }, select: { blockedId: true } }),
      prisma.userBlock.findMany({ where: { blockedId: viewerId }, select: { blockerId: true } }),
    ]);
    const exclude = [...new Set<string>([
      viewerId,
      ...following.map((f) => f.followingId),
      ...blocked.map((b) => b.blockedId),
      ...blockedBy.map((b) => b.blockerId),
    ])];

    const rows = await prisma.user.findMany({
      where: {
        isActive: true,
        id: { notIn: exclude },
        OR: [{ bannedUntil: null }, { bannedUntil: { lt: new Date() } }],
      },
      select: {
        id: true, username: true, avatar: true,
        groups: {
          orderBy: primaryGroupOrder,
          include: { group: { select: { name: true, key: true, progression: { select: { badgeColor: true, badgeLabel: true } } } } },
        },
      },
      orderBy: [{ followerCount: "desc" }, { likeCountReceived: "desc" }],
      take: limit,
    });

    return rows.map((u) => {
      const g = u.groups[0]?.group;
      return {
        id: u.id,
        username: u.username,
        avatar: resolveAvatar(u.avatar),
        role: g?.progression?.badgeLabel ?? g?.name ?? null,
        badgeColor: g?.progression?.badgeColor ?? null,
      };
    });
  },

  // ── Members directory (§ Members page) ──────────────────────────────────
  async listMembers(opts: { page: number; limit: number; q?: string; filter?: string; sort?: string }) {
    const { page, limit, q, filter = "all", sort = "active" } = opts;
    const onlineIds = await getOnlineUserIds();
    const onlineArr = [...onlineIds];

    // Base: active members, optional name/handle search.
    const base: any = {
      isActive: true,
      ...(q
        ? { OR: [
            { username:    { startsWith: q, mode: "insensitive" } },
            { displayName: { startsWith: q, mode: "insensitive" } },
          ] }
        : {}),
    };

    // "Staff" = the groups holding moderation.protected (ACP → Permissions).
    const STAFF_KEY_LIST = [...(await staffGroupKeys())];

    // Filter rail selection.
    let filterWhere: any = {};
    if (filter === "online") {
      filterWhere = { id: { in: onlineArr } };       // empty array → 0 rows (correct)
    } else if (filter === "staff") {
      filterWhere = { groups: { some: { group: { key: { in: [...STAFF_KEY_LIST] } } } } };
    } else if (filter !== "all") {
      filterWhere = { groups: { some: { group: { key: filter } } } };
    }
    const where = { AND: [base, filterWhere] };

    // Sort.
    let orderBy: any = { postCount: "desc" };           // Most active
    if (sort === "followers")    orderBy = { followerCount: "desc" };
    else if (sort === "newest")  orderBy = { createdAt: "desc" };
    else if (sort === "az")      orderBy = { username: "asc" };

    const [rows, total, facetTotal, facetOnline, facetStaff, groupRows] = await Promise.all([
      prisma.user.findMany({ where, select: MEMBER_SELECT, orderBy, skip: (page - 1) * limit, take: limit }),
      prisma.user.count({ where }),
      prisma.user.count({ where: base }),
      prisma.user.count({ where: { AND: [base, { id: { in: onlineArr } }] } }),
      prisma.user.count({ where: { AND: [base, { groups: { some: { group: { key: { in: [...STAFF_KEY_LIST] } } } } }] } }),
      prisma.group.findMany({
        where: { key: { notIn: [...STAFF_KEY_LIST] } },
        select: { key: true, name: true, displayOrder: true, _count: { select: { users: true } } },
        orderBy: { displayOrder: "asc" },
      }),
    ]);

    const facets = {
      total: facetTotal,
      online: facetOnline,
      staff: facetStaff,
      groups: groupRows
        .filter((g) => g._count.users > 0)
        .map((g) => ({ key: g.key, name: g.name, count: g._count.users })),
    };

    const members = rows.map(shapeMember).map((m) => ({ ...m, online: onlineIds.has(m.id) }));
    return { rows: members, total, facets };
  },

  /** Team page — one section per group flagged `showInTeam` (ACP-configurable),
      ordered by displayOrder. Each member is bucketed into the highest-precedence
      team group they belong to. */
  async listTeam() {
    // Sections = the groups an admin chose to surface, in badge-precedence order.
    const teamGroups = await prisma.group.findMany({
      where: { showInTeam: true },
      select: { key: true, name: true, displayOrder: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
    if (teamGroups.length === 0) return [];

    const teamKeys = teamGroups.map((g) => g.key);
    const rows = await prisma.user.findMany({
      where: { isActive: true, groups: { some: { group: { key: { in: teamKeys } } } } },
      select: MEMBER_SELECT,
      take: 500,
    });
    const onlineIds = await getOnlineUserIds();

    // The bucket = the team group with the lowest displayOrder the user belongs to.
    const bucketOf = (u: { groups?: { group: { key: string } }[] }): string | null => {
      const keys = new Set((u.groups ?? []).map((ug) => ug.group.key));
      for (const g of teamGroups) if (keys.has(g.key)) return g.key;
      return null;
    };

    const shaped = rows.map((u) => ({
      bucket: bucketOf(u),
      member: { ...shapeMember(u), online: onlineIds.has(u.id) },
    }));

    return teamGroups
      .map((g) => ({
        key: g.key,
        label: g.name,
        members: shaped
          .filter((x) => x.bucket === g.key)
          .map((x) => x.member)
          .sort((a, b) => b.postCount - a.postCount || a.username.localeCompare(b.username)),
      }))
      .filter((section) => section.members.length > 0);
  },

  /** Hall of Fame — ranked by the ACP-configured metric (default likes). */
  async getHallOfFame(limit: number) {
    const FIELD: Record<string, "postCount" | "threadCount" | "likeCountReceived" | "followerCount"> = {
      posts: "postCount", threads: "threadCount", likes: "likeCountReceived", followers: "followerCount",
    };
    const setting = await prisma.setting.findUnique({ where: { key: "members.hall_of_fame_metric" } });
    const metric = typeof setting?.value === "string" && FIELD[setting.value] ? (setting.value as string) : "likes";
    const field = FIELD[metric]!;

    const rows = await prisma.user.findMany({
      where: { isActive: true },
      select: MEMBER_SELECT,
      orderBy: { [field]: "desc" },
      take: limit,
    });
    const onlineIds = await getOnlineUserIds();
    const members = rows.map(shapeMember).map((m) => ({ ...m, online: onlineIds.has(m.id) }));
    const totalPosts = await prisma.user.aggregate({ where: { isActive: true }, _sum: { postCount: true } });
    const newThisWeek = await prisma.user.count({
      where: { isActive: true, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    });
    return {
      metric,
      members,
      stats: {
        total: await prisma.user.count({ where: { isActive: true } }),
        online: onlineIds.size,
        newThisWeek,
        totalPosts: totalPosts._sum.postCount ?? 0,
      },
    };
  },

  async searchByUsernamePrefixes(query: string, limit: number, excludeId?: string) {
    const rows = await prisma.user.findMany({
      where: {
        username: { startsWith: query, mode: "insensitive" },
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true, username: true, avatar: true,
        /**
         * The primary group's NAME, for the composer's mention list — two similar
         * usernames are told apart by "Administrator" beside one of them.
         *
         * ⚠ `primaryGroupOrder`, like every other read of `groups[0]`: without it
         * which group a multi-group member shows is Postgres row-order roulette.
         */
        groups: {
          orderBy: primaryGroupOrder,
          take: 1,
          select: { group: { select: { name: true } } },
        },
      },
      orderBy: { username: "asc" },
      take: limit,
    });
    return withResolvedAvatarList(rows).map(({ groups, ...u }) => ({
      ...u,
      role: groups[0]?.group.name ?? null,
    }));
  },
};

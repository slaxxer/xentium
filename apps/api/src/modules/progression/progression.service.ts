import { prisma } from "../../infrastructure/db.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import type {
  UpdateGroupProgressionInput,
  GlobalProgressionSettingsInput,
} from "./progression.validation.js";

const GLOBAL_KEYS = [
  "progression.enabled",
  "progression.notify_on_promote",
  "progression.show_progress_bar",
  "progression.threshold_logic",
] as const;

async function loadGlobalSettings() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [...GLOBAL_KEYS] } },
  });
  const map = new Map(rows.map(r => [r.key, r.value]));
  return {
    enabled:         (map.get("progression.enabled")         ?? true)  as boolean,
    notifyOnPromote: (map.get("progression.notify_on_promote") ?? true)  as boolean,
    showProgressBar: (map.get("progression.show_progress_bar") ?? true)  as boolean,
    thresholdLogic:  (map.get("progression.threshold_logic")  ?? "and") as "and" | "or",
  };
}

export const progressionService = {
  // ── Per-group config ───────────────────────────────────────────────────────

  /** Get or create (with defaults) the progression config for a group. */
  async getGroupProgression(groupId: string) {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw NodevoError.notFound("Group not found");

    const existing = await prisma.groupProgression.findUnique({ where: { groupId } });
    if (existing) return existing;

    // Auto-create with defaults so the ACP always has something to show
    return prisma.groupProgression.create({ data: { groupId } });
  },

  /** Upsert the progression config for a group. */
  async updateGroupProgression(groupId: string, data: UpdateGroupProgressionInput) {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw NodevoError.notFound("Group not found");

    return prisma.groupProgression.upsert({
      where: { groupId },
      update: data,
      create: { groupId, ...data },
    });
  },

  // ── Global ladder ──────────────────────────────────────────────────────────

  /** Return all progression groups in ladder order + user counts + global settings. */
  async getLadder() {
    const [ladder, settings] = await Promise.all([
      prisma.groupProgression.findMany({
        where: { isProgressionGroup: true },
        orderBy: { ladderPosition: "asc" },
        include: {
          group: {
            select: {
              id: true,
              key: true,
              name: true,
              _count: { select: { users: true } },
            },
          },
        },
      }),
      loadGlobalSettings(),
    ]);

    return {
      ladder: ladder.map(p => ({
        ...p,
        userCount: p.group._count.users,
      })),
      settings,
    };
  },

  /** All groups (not just progression ones) — for the dropdown in Phase 7 ACP. */
  async getAllGroupsWithProgression() {
    return prisma.group.findMany({
      orderBy: { name: "asc" },
      include: { progression: true },
    });
  },

  // ── Global settings ────────────────────────────────────────────────────────

  async updateGlobalSettings(data: GlobalProgressionSettingsInput) {
    const entries: Array<[string, unknown]> = [];
    if (data.enabled         !== undefined) entries.push(["progression.enabled",          data.enabled]);
    if (data.notifyOnPromote !== undefined) entries.push(["progression.notify_on_promote", data.notifyOnPromote]);
    if (data.showProgressBar !== undefined) entries.push(["progression.show_progress_bar", data.showProgressBar]);
    if (data.thresholdLogic  !== undefined) entries.push(["progression.threshold_logic",  data.thresholdLogic]);

    await Promise.all(
      entries.map(([key, value]) =>
        prisma.setting.upsert({
          where:  { key },
          update: { value: value as any },
          create: { key,  value: value as any },
        }),
      ),
    );

    return loadGlobalSettings();
  },

  // ── Ladder reorder ─────────────────────────────────────────────────────────

  async reorderLadder(items: Array<{ groupId: string; ladderPosition: number }>) {
    await prisma.$transaction(
      items.map(({ groupId, ladderPosition }) =>
        prisma.groupProgression.update({
          where: { groupId },
          data:  { ladderPosition },
        }),
      ),
    );
  },

  // ── User limits ────────────────────────────────────────────────────────────

  /**
   * Resolve the effective content limits for a user based on their group's
   * progression config. Used by GET /api/users/me/limits (§38).
   */
  async getUserLimits(userId: string) {
    const userGroups = await prisma.userGroup.findMany({
      where: { userId },
      include: {
        group: { include: { progression: true } },
      },
    });

    // Pick the group that is highest on the progression ladder (if any)
    const withProgression = userGroups
      .filter(ug => ug.group.progression?.isProgressionGroup)
      .sort((a, b) => {
        const posA = a.group.progression?.ladderPosition ?? 0;
        const posB = b.group.progression?.ladderPosition ?? 0;
        return posB - posA; // highest ladder position = most senior
      });

    const prog = withProgression[0]?.group.progression ?? null;

    return {
      maxPostLength:            prog?.maxPostLength            ?? null,
      maxDailyPosts:            prog?.maxDailyPosts            ?? null,
      maxAttachments:           prog?.maxAttachments            ?? null,
      maxProfileImageBytes:     prog?.maxProfileImageBytes      ?? null,
      allowedProfileImageTypes: prog?.allowedProfileImageTypes  ?? [],
      ladderPosition:           prog?.ladderPosition            ?? null,
      badgeLabel:               prog?.badgeLabel                ?? null,
      badgeColor:               prog?.badgeColor                ?? null,
    };
  },

  /**
   * Progress toward the next progression rung — mirrors the checkPromotion job's
   * threshold logic (§38) so the UI shows the same numbers that drive promotion.
   * Returns current badge, the next rung, per-metric have/need, and an overall %.
   */
  async getUserProgression(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        postCount: true, threadCount: true, articleCount: true,
        likeCountReceived: true, createdAt: true,
        groups: { include: { group: { include: { progression: true } } } },
      },
    });
    if (!user) return { current: null, next: null, atTop: true, percent: 100, metrics: [], primary: null };

    const onLadder = user.groups
      .filter(ug => ug.group.progression?.isProgressionGroup)
      .sort((a, b) => (b.group.progression?.ladderPosition ?? 0) - (a.group.progression?.ladderPosition ?? 0));
    const currentProg = onLadder[0]?.group.progression ?? null;
    const currentPos  = currentProg?.ladderPosition ?? 0;
    const current = currentProg
      ? { badgeLabel: currentProg.badgeLabel, badgeColor: currentProg.badgeColor, ladderPosition: currentProg.ladderPosition }
      : null;

    const nextRung = await prisma.groupProgression.findFirst({
      where: { isProgressionGroup: true, ladderPosition: { gt: currentPos } },
      orderBy: { ladderPosition: "asc" },
      include: { group: true },
    });
    if (!nextRung) return { current, next: null, atTop: true, percent: 100, metrics: [], primary: null };

    const logicSetting = await prisma.setting.findUnique({ where: { key: "progression.threshold_logic" } });
    const useOr = (logicSetting?.value as string) === "or";

    const daysMember = Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000);
    const totalPosts = user.postCount + user.articleCount; // both = content authored (§38)

    const metrics: { key: string; label: string; have: number; need: number }[] = [];
    if (nextRung.minPosts         != null) metrics.push({ key: "posts",   label: "posts",     have: totalPosts,             need: nextRung.minPosts });
    if (nextRung.minThreads       != null) metrics.push({ key: "threads", label: "threads",   have: user.threadCount,       need: nextRung.minThreads });
    if (nextRung.minDaysMember    != null) metrics.push({ key: "days",    label: "days",      have: daysMember,             need: nextRung.minDaysMember });
    if (nextRung.minLikesReceived != null) metrics.push({ key: "likes",   label: "likes",     have: user.likeCountReceived, need: nextRung.minLikesReceived });

    const ratios = metrics.map(m => (m.need > 0 ? Math.min(1, m.have / m.need) : 1));
    // AND logic: gated by the least-complete metric; OR: by the most-complete.
    const percent = ratios.length ? Math.round((useOr ? Math.max(...ratios) : Math.min(...ratios)) * 100) : 100;

    // primary = the metric driving the caption (furthest from done under AND).
    const primary = metrics.length
      ? metrics.reduce((worst, m) =>
          (m.need ? m.have / m.need : 1) < (worst.need ? worst.have / worst.need : 1) ? m : worst)
      : null;

    return {
      current,
      next: { badgeLabel: nextRung.badgeLabel ?? nextRung.group.name, badgeColor: nextRung.badgeColor, ladderPosition: nextRung.ladderPosition },
      atTop: false,
      logic: useOr ? "or" : "and",
      percent,
      metrics,
      primary: primary
        ? { label: primary.label, have: primary.have, need: primary.need, remaining: Math.max(0, primary.need - primary.have) }
        : null,
    };
  },
};

import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { progressionCriteriaRegistry } from "../../core/progression-registry/progression-criteria-registry.js";
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

/** The limits a rung raises, as key/value pairs the frontend words. */
function describeUnlocks(
  r: {
    maxArticleLength: number | null; maxDailyArticles: number | null;
    maxCommentLength: number | null; maxDailyComments: number | null;
    maxAttachments: number | null;
  } | null,
): { key: string; value: number }[] {
  if (!r) return [];
  return [
    { key: "articleLength",  value: r.maxArticleLength },
    { key: "dailyArticles",  value: r.maxDailyArticles },
    { key: "commentLength",  value: r.maxCommentLength },
    { key: "dailyComments",  value: r.maxDailyComments },
    { key: "attachments",    value: r.maxAttachments },
  ].filter((x): x is { key: string; value: number } => x.value != null && x.value > 0);
}

export const progressionService = {
  // ── Per-group config ───────────────────────────────────────────────────────

  /** Get or create (with defaults) the progression config for a group. */
  async getGroupProgression(groupId: string) {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw XentiumError.notFound("Group not found");

    const existing = await prisma.groupProgression.findUnique({ where: { groupId } });
    if (existing) return existing;

    // Auto-create with defaults so the ACP always has something to show
    return prisma.groupProgression.create({ data: { groupId } });
  },

  /** Upsert the progression config for a group. */
  async updateGroupProgression(groupId: string, data: UpdateGroupProgressionInput) {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw XentiumError.notFound("Group not found");

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
    for (const [key] of entries) bustSettingsCache(key);

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
      maxArticleLength:         prog?.maxArticleLength          ?? null,
      maxDailyArticles:         prog?.maxDailyArticles          ?? null,
      maxCommentLength:         prog?.maxCommentLength          ?? null,
      maxDailyComments:         prog?.maxDailyComments          ?? null,
      maxAttachments:           prog?.maxAttachments            ?? null,
      maxProfileImageBytes:     prog?.maxProfileImageBytes      ?? null,
      allowedProfileImageTypes: prog?.allowedProfileImageTypes  ?? [],
      // ⚠ `?? true` — a member in no progression group is unrestricted, and a site
      // with no ladder must not have covers switched off by accident.
      canUploadCover:           prog?.canUploadCover            ?? true,
      ladderPosition:           prog?.ladderPosition            ?? null,
      badgeLabel:               prog?.badgeLabel                ?? null,
      badgeColor:               prog?.badgeColor                ?? null,
      badgeTextShadow:          prog?.badgeTextShadow           ?? false,
      badgeShadowColor:         prog?.badgeShadowColor          ?? null,
      badgeShadowX:             prog?.badgeShadowX              ?? 1,
      badgeShadowY:             prog?.badgeShadowY              ?? 1,
      badgeShadowBlur:          prog?.badgeShadowBlur           ?? 20,
    };
  },

  /**
   * Progress toward the next progression rung — mirrors the checkPromotion job's
   * threshold logic (§38) so the UI shows the same numbers that drive promotion.
   * Returns current badge, the next rung, per-metric have/need, and an overall %.
   */
  /**
   * Everything a PROFILE's rank rail shows, for any user, composed from what is
   * already computed elsewhere.
   *
   * Three questions, one round trip, because they are one card on the page: where
   * this member is on the ladder and how far to the next rung (`getUserProgression`),
   * what the WHOLE ladder looks like with the rungs they have passed marked, and what
   * the next rung would actually give them.
   *
   * ⚠ PUBLIC. It says what a member has achieved and what the site's ladder is —
   * both already visible in their badge and in the ACP's own ladder — and nothing
   * about who they are. It carries no counts the profile does not already publish.
   *
   * ⚠ Returns `enabled: false` and nothing else when progression is switched off, so
   * the rail can disappear entirely rather than render an empty ladder.
   */
  async getProfileProgression(userId: string) {
    const settings = await loadGlobalSettings();

    /**
     * ⚠ The cover gate is resolved BEFORE the `enabled` check, and deliberately.
     *
     * `getUserLimits` — which is what the upload route actually enforces — does not
     * consult the global progression toggle at all. If this returned early with the
     * rail's `{ enabled: false }` and nothing else, the profile would offer an upload
     * that the server then refused, on any site with the ladder switched off and a
     * group still carrying `canUploadCover: false`.
     *
     * The UI must ask the same question the server answers. Whether a DISABLED
     * progression system ought to enforce per-group limits at all is a real question,
     * but it is the same question for article and comment limits and is not this
     * feature's to decide.
     */
    const coverGate = await this.resolveCoverGate(userId);

    if (!settings.enabled) return { enabled: false as const, ...coverGate };

    const [progression, rungs] = await Promise.all([
      this.getUserProgression(userId),
      // ⚠ Still fetched, but only to find the NEXT rung for `unlocks`. The whole
      // ladder used to travel in the payload for a block that no longer exists.
      prisma.groupProgression.findMany({
        where:   { isProgressionGroup: true },
        orderBy: { ladderPosition: "asc" },
      }),
    ]);

    const currentPos = progression.current?.ladderPosition ?? 0;

    return {
      enabled: true as const,
      showProgressBar: settings.showProgressBar,
      ...progression,
      /**
       * What the NEXT rung grants. Machine-readable pairs rather than sentences:
       * the API is locale-agnostic (§60), so the numbers travel and the wording is
       * the frontend's. Absent limits are omitted — `null` means unlimited, which
       * is not something to advertise as an unlock.
       */
      unlocks: describeUnlocks(rungs.find((r) => (r.ladderPosition ?? 0) > currentPos) ?? null),

      /**
       * Whether this member may set a cover, and the rung that grants it.
       *
       * ⚠ Both, not just the boolean. "You cannot do this" is a dead end; the design
       * says "Unlocked at Contributor", which needs the NAME of the lowest rung that
       * allows it — not the next rung up, which may not be the one that unlocks it.
       *
       * `null` for `coverUnlocksAt` when no rung on the ladder allows covers at all,
       * so the UI can say "not available" instead of naming a rank that will never
       * arrive.
       */
      ...coverGate,
    };
  },

  /**
   * Whether this member may set a cover, and the rung that grants it.
   *
   * ⚠ Mirrors `getUserLimits` exactly — the member's OWN rung, `?? true` when they
   * are on no rung. Anything cleverer ("any rung at or below allows it") would tell
   * a member they may upload and then have the server refuse them.
   *
   * `coverUnlocksAt` is the LOWEST rung that allows covers, not the next rung up:
   * the design says "Unlocked at Contributor", which needs the name of the rung that
   * actually grants it. Null when no rung does, so the UI can say "not available"
   * rather than naming a rank that will never arrive.
   */
  async resolveCoverGate(userId: string) {
    const [limits, rungs] = await Promise.all([
      this.getUserLimits(userId),
      prisma.groupProgression.findMany({
        where:   { isProgressionGroup: true, canUploadCover: true },
        orderBy: { ladderPosition: "asc" },
        take:    1,
        include: { group: { select: { name: true } } },
      }),
    ]);
    const rung = rungs[0];
    return {
      canUploadCover: limits.canUploadCover,
      coverUnlocksAt: rung ? (rung.badgeLabel ?? rung.group.name) : null,
    };
  },

  /**
   * The rung this member climbed and has not seen yet, for the one-time "Level up"
   * dialog. Null when there is none, when progression is off, or when the admin
   * switched promotion notices off (the dialog IS that notice).
   *
   * The NEWEST unseen climb: two rungs gained at once make one dialog, about where
   * the member ended up, not two in a row.
   */
  async getPendingLevelUp(userId: string) {
    const settings = await loadGlobalSettings();
    if (!settings.enabled || !settings.notifyOnPromote) return null;

    const row = await prisma.levelUp.findFirst({
      where: { userId, seenAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;

    const [to, from] = await Promise.all([
      prisma.groupProgression.findUnique({ where: { groupId: row.toGroupId }, include: { group: { select: { name: true } } } }),
      row.fromGroupId
        ? prisma.groupProgression.findUnique({ where: { groupId: row.fromGroupId }, include: { group: { select: { name: true } } } })
        : null,
    ]);
    // The rung was deleted since: nothing true to celebrate, so it is simply spent.
    if (!to) {
      await this.markLevelUpsSeen(userId);
      return null;
    }

    const progression = await this.getUserProgression(userId);
    return {
      id: row.id,
      at: row.createdAt,
      rank: { label: to.badgeLabel ?? to.group.name, color: to.badgeColor },
      from: from ? { label: from.badgeLabel ?? from.group.name, color: from.badgeColor } : null,
      // What reaching THIS rung gave them (the profile's `unlocks` describes the next one).
      unlocks: describeUnlocks(to),
      next: progression.atTop ? null : { rank: progression.next?.badgeLabel ?? null, primary: progression.primary ?? null },
    };
  },

  /** Every unseen climb, marked seen — the dialog is shown once. */
  async markLevelUpsSeen(userId: string) {
    const res = await prisma.levelUp.updateMany({ where: { userId, seenAt: null }, data: { seenAt: new Date() } });
    return { seen: res.count };
  },

  async getUserProgression(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        articleCount: true, commentCount: true,
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

    const metrics: { key: string; label: string; have: number; need: number }[] = [];
    if (nextRung.minArticles      != null) metrics.push({ key: "articles", label: "articles", have: user.articleCount,      need: nextRung.minArticles });
    if (nextRung.minComments      != null) metrics.push({ key: "comments", label: "comments", have: user.commentCount,      need: nextRung.minComments });
    if (nextRung.minDaysMember    != null) metrics.push({ key: "days",     label: "days",     have: daysMember,             need: nextRung.minDaysMember });
    if (nextRung.minLikesReceived != null) metrics.push({ key: "likes",    label: "likes",    have: user.likeCountReceived, need: nextRung.minLikesReceived });

    // Plugin-contributed metrics (e.g. the forum's posts/threads) so the bar
    // reflects the same thresholds checkPromotion actually gates on.
    metrics.push(...await progressionCriteriaRegistry.describe(userId, nextRung.groupId));

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

/**
 * system.award-badges — grant every badge whose thresholds a member now meets.
 *
 * A sweep rather than a hook on every counted event, for the same reason
 * `checkPromotion` is one: the events that could earn a badge are spread across core
 * and every plugin that contributes a metric, and a badge arriving a few minutes late
 * costs nothing next to a hook on every article, like, follow and forum post.
 *
 * ⚠ It only ever ADDS. An auto award is never taken back here: earning it was a fact
 * about a moment, and revoking because a like was deleted would punish a member for
 * someone else's action. An admin can still revoke by hand.
 *
 * ⚠ Badges with `autoAward` off are ignored entirely — a give-away badge must never
 * be handed out by a job.
 */
import { z } from "zod";
import { prisma } from "../../infrastructure/db.js";
import { badgeCriteriaRegistry } from "../../core/badge-registry/badge-criteria-registry.js";
import { registerScheduledAction, type ActionResult, type ActionRunCtx } from "./action-registry.js";
import { notificationService } from "../../modules/notifications/notification.service.js";

const paramsSchema = z.object({
  /**
   * ⚠ A bound on MEMBERS examined per run, not on badges. A sweep that walked every
   * member of a large community in one pass would hold the connection and the event
   * loop for as long as that took; the next run continues from where this one left
   * off, because it only looks at members who are still missing something.
   */
  batch: z
    .number().int().min(10).max(5000).default(500)
    .meta({
      title:       "Members per run",
      description: "How many members to examine each time. The next run picks up the rest.",
    }),
});
type Params = z.infer<typeof paramsSchema>;

export async function runAwardBadges(params: Params, ctx: ActionRunCtx): Promise<ActionResult> {
  const badges = await prisma.badge.findMany({
    where:  { autoAward: true },
    select: { id: true, name: true, criteria: true },
  });
  if (badges.length === 0) return { changed: 0, summary: "No badges are set to be earned." };

  // ⚠ `isActive` only. `User` has NO `deletedAt` — the soft-delete convention this
  // codebase follows elsewhere does not apply to accounts, and asking for one is a
  // Prisma error at run time rather than a compile error. A deactivated account
  // quietly collecting badges is noise; that is what this filter is for.
  const users = await prisma.user.findMany({
    where:  { isActive: true },
    // `username` comes along so the notification can link to the member's own
    // profile, which is where the badge they just earned is on show.
    select: { id: true, username: true },
    take:   params.batch,
    orderBy: { createdAt: "asc" },
  });

  let granted = 0;
  const perBadge = new Map<string, number>();

  for (const badge of badges) {
    const criteria = badge.criteria as Record<string, number> | null;
    if (!criteria || Object.keys(criteria).length === 0) continue;

    // Who already holds it — one query per badge rather than one per member.
    const holders = new Set(
      (await prisma.userBadge.findMany({ where: { badgeId: badge.id }, select: { userId: true } }))
        .map((r) => r.userId),
    );

    for (const u of users) {
      if (holders.has(u.id)) continue;
      if (!(await badgeCriteriaRegistry.meets(u.id, criteria))) continue;

      if (!ctx.dryRun) {
        // ⚠ `auto: true` marks it as the sweep's doing, and the upsert means a race
        // with an admin granting the same badge by hand cannot fail the run.
        await prisma.userBadge.upsert({
          where:  { userId_badgeId: { userId: u.id, badgeId: badge.id } },
          update: {},
          create: { userId: u.id, badgeId: badge.id, auto: true },
        });

        /**
         * Tell them. A badge nobody is told about is a badge nobody knows they
         * earned — the whole point of a reward is the moment it arrives.
         *
         * ⚠ Wrapped, and after the write. Notifying is the softer half of this: a
         * mail outage or a bad preference row must never stop the sweep granting, and
         * must never leave the badge ungranted on a retry.
         * ⚠ Per-user notification preferences are honoured by `dispatch` itself —
         * that is the mechanism, not a site-wide switch of this job's own.
         * ⚠ English, like every other notification this codebase sends. §60 says
         * notifications are server-localised and none of them are; there is no server
         * i18n at all yet. Worth fixing for all of them at once, not here.
         */
        try {
          await notificationService.dispatch({
            userId: u.id,
            type:   "badge.earned",
            title:  `You've earned the "${badge.name}" badge!`,
            i18n:   { key: "common:notify.badgeEarned", params: { badge: badge.name } },
            body:   "It's on your profile now, for everyone who visits.",
            link:   `/u/${u.username}`,
            channels: ["in_app"],
          });
        } catch {
          /* the badge is granted either way */
        }
      }
      granted++;
      perBadge.set(badge.name, (perBadge.get(badge.name) ?? 0) + 1);
    }
  }

  if (granted === 0) return { changed: 0, summary: "Nobody has newly earned a badge." };

  const detail = [...perBadge].map(([name, n]) => `${n}× ${name}`).join(", ");
  const verb = ctx.dryRun ? "would grant" : "granted";
  return { changed: ctx.dryRun ? 0 : granted, summary: `${verb} ${detail}.` };
}

registerScheduledAction({
  key:   "system.award-badges",
  label: "Award earned badges",
  description:
    "Grants any badge whose thresholds a member now meets. Only badges with the reward system switched on are " +
    "considered, and nothing is ever taken away — a badge already earned stays earned. Thresholds belonging to a " +
    "disabled plugin are skipped until it is enabled again.",
  domain:         "System",
  params:         paramsSchema,
  minIntervalSec: 15 * 60,
  destructive:    false,
  run:            runAwardBadges,
});

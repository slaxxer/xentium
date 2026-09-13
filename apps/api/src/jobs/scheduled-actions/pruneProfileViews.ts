/**
 * system.prune-profile-views — age out the profile visitor lists.
 *
 * `xcf_profile_views` gains a row the first time each member looks at each profile,
 * and nothing removes it. On a busy site that is (members × profiles they visit),
 * which grows without bound while the card that reads it only ever shows the newest
 * handful.
 *
 * ⚠ Pruning is not just housekeeping here: the row records that one named person
 * looked at another's profile, and keeping that forever is a longer memory than the
 * feature needs. A site can still choose to keep it — 0 keeps everything — but the
 * default is a window, not eternity.
 *
 * ⚠ The all-time total on `xcf_users.profile_view_count` is NOT touched. It is a
 * counter, not a log; if this job reduced it, a profile's view count would fall over
 * time and a member would watch their own number shrink.
 */
import { z } from "zod";
import { prisma } from "../../infrastructure/db.js";
import { registerScheduledAction, type ActionResult, type ActionRunCtx } from "./action-registry.js";

const paramsSchema = z.object({
  days: z
    .number().int().min(0).max(3650).default(90)
    .meta({
      title:       "Forget visits older than (days)",
      description: "A visit drops off the visitor card once it is this old. 0 keeps every visit forever.",
    }),
});
type Params = z.infer<typeof paramsSchema>;

export async function runPruneProfileViews(
  params: Params,
  ctx: ActionRunCtx,
): Promise<ActionResult> {
  if (params.days === 0) {
    return { changed: 0, summary: "Window is 0 — visits are kept forever." };
  }

  const where = { viewedAt: { lt: new Date(Date.now() - params.days * 86_400_000) } };
  const n = ctx.dryRun
    ? await prisma.profileView.count({ where })
    : (await prisma.profileView.deleteMany({ where })).count;

  if (n === 0) return { changed: 0, summary: "No profile visits old enough to prune." };

  const verb = ctx.dryRun ? "would forget" : "forgot";
  return { changed: ctx.dryRun ? 0 : n, summary: `${verb} ${n} profile visit(s).` };
}

registerScheduledAction({
  key:   "system.prune-profile-views",
  label: "Prune profile visitors",
  description:
    "Ages out the 'recent visitors' list on member profiles. A visit older than the window is forgotten, " +
    "so the card stays a record of who has been by lately rather than a permanent log of who looked at whom. " +
    "Set to 0 to keep every visit. Profile view TOTALS are counters and are never reduced by this.",
  domain:         "System",
  params:         paramsSchema,
  minIntervalSec: 6 * 60 * 60,
  destructive:    true,
  run:            runPruneProfileViews,
});

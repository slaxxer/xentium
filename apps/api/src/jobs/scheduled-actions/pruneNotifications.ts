/**
 * system.prune-notifications — age out the notification feed.
 *
 * xcf_notifications gains a row per event per recipient and has no cleanup path.
 * It is not a log — it is user-facing content — which is why this is a catalogue
 * action an admin composes rather than a fixed window in the log-retention job:
 * whether notifications are a transient feed or an archive people scroll back
 * through is a decision about the community, not about disk.
 *
 * Read and unread age out on separate clocks on purpose. A read notification has
 * done its job the moment it was read; an unread one still owes the user
 * something, so it deserves a longer stay. Setting either to 0 keeps that half
 * forever.
 */
import { z } from "zod";
import { prisma } from "../../infrastructure/db.js";
import { registerScheduledAction, type ActionResult, type ActionRunCtx } from "./action-registry.js";

const paramsSchema = z.object({
  readDays: z
    .number().int().min(0).max(3650).default(30)
    .meta({
      title:       "Delete read after (days)",
      description: "Notifications the user has already read. 0 keeps them forever.",
    }),
  unreadDays: z
    .number().int().min(0).max(3650).default(90)
    .meta({
      title:       "Delete unread after (days)",
      description: "Notifications the user never opened. Give these a longer window — they still owe the user something. 0 keeps them forever.",
    }),
});
type Params = z.infer<typeof paramsSchema>;

const cutoff = (days: number) => new Date(Date.now() - days * 86_400_000);

export async function runPruneNotifications(
  params: Params,
  ctx: ActionRunCtx,
): Promise<ActionResult> {
  const parts: string[] = [];
  let changed = 0;

  const sweep = async (label: string, days: number, read: boolean) => {
    if (days === 0) return; // 0 = keep forever, skip the table entirely
    const where = {
      readAt:    read ? { not: null } : null,
      createdAt: { lt: cutoff(days) },
    } as const;
    const n = ctx.dryRun
      ? await prisma.notification.count({ where })
      : (await prisma.notification.deleteMany({ where })).count;
    if (n) { parts.push(`${n} ${label}`); changed += ctx.dryRun ? 0 : n; }
  };

  await sweep("read", params.readDays, true);
  await sweep("unread", params.unreadDays, false);

  if (params.readDays === 0 && params.unreadDays === 0) {
    return { changed: 0, summary: "Both windows are 0 — nothing is being pruned." };
  }
  if (parts.length === 0) return { changed: 0, summary: "No notifications old enough to prune." };

  const verb = ctx.dryRun ? "would delete" : "deleted";
  return { changed, summary: `${verb} ${parts.join(" and ")} notification(s).` };
}

registerScheduledAction({
  key:   "system.prune-notifications",
  label: "Prune notifications",
  description:
    "Deletes old notifications, with separate windows for ones the user has read and ones they never opened. " +
    "Set a window to 0 to keep that half forever. Notification preferences and unread counts are not affected " +
    "beyond the rows removed.",
  domain:         "System",
  params:         paramsSchema,
  minIntervalSec: 6 * 60 * 60,
  destructive:    true,
  run:            runPruneNotifications,
});

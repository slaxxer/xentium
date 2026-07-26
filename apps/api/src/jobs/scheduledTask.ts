/**
 * Runner for admin-created scheduled tasks.
 *
 * One BullMQ queue serves every task; the scheduler id carries the task id and
 * the job payload is just `{ taskId }`. The row is resolved at RUN time, so
 * editing a task's params or dry-run flag never has to touch Redis.
 */
import { Worker } from "bullmq";
import { prisma } from "../infrastructure/db.js";
import { bullConnection, bullPrefix, queues } from "../infrastructure/queue.js";
import { logger } from "../infrastructure/logging/logger.js";
import { getAction } from "./scheduled-actions/action-registry.js";
import "./scheduled-actions/index.js"; // registers the core actions

const QUEUE_NAME = "scheduled-task";

/** BullMQ scheduler id for a task. Also the prefix the reconcile matches on. */
export const SCHEDULER_PREFIX = "task:";
export const schedulerIdFor = (taskId: string) => `${SCHEDULER_PREFIX}${taskId}`;
export const taskIdFromSchedulerId = (id: string) =>
  id.startsWith(SCHEDULER_PREFIX) ? id.slice(SCHEDULER_PREFIX.length) : null;

export interface ScheduledTaskPayload {
  taskId: string;
  /** One-off override for a manual "dry run now"; absent for scheduled runs,
   *  which use the task's own flag. Carried in the payload rather than toggled
   *  on the row, so a manual run cannot race a scheduled one. */
  dryRun?: boolean;
}

/** Truncate a summary/error so one pathological run can't bloat the history. */
const clip = (s: string, n = 2000) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Execute one task. Records a run row either way, and never throws for an
 * "expected" outcome (missing task, unknown action, bad params) — those are
 * recorded as `error`/`skipped` rather than dead-lettered, because retrying
 * them would just fail identically.
 */
export async function processScheduledTask(payload: ScheduledTaskPayload): Promise<void> {
  const { taskId } = payload;
  const task = await prisma.scheduledTask.findUnique({ where: { id: taskId } });

  // The row is gone but a scheduler survived (deleted while the worker was
  // down). Drop the scheduler so this self-heals instead of firing forever.
  if (!task) {
    await queues.scheduledTask.removeJobScheduler(schedulerIdFor(taskId)).catch(() => {});
    logger.warn({ taskId }, "scheduled task: no row — scheduler removed");
    return;
  }
  if (!task.enabled) return;

  const dryRun  = payload.dryRun ?? task.dryRun;
  const started = Date.now();
  const run = await prisma.scheduledTaskRun.create({
    data: { taskId, status: "running", dryRun },
  });

  const finish = async (status: string, summary: string | null, error: string | null) => {
    await prisma.$transaction([
      prisma.scheduledTaskRun.update({
        where: { id: run.id },
        data: {
          status,
          summary:    summary ? clip(summary) : null,
          error:      error ? clip(error) : null,
          finishedAt: new Date(),
          durationMs: Date.now() - started,
        },
      }),
      prisma.scheduledTask.update({
        where: { id: taskId },
        data:  { lastRunAt: new Date(), lastStatus: status },
      }),
    ]);
  };

  const action = getAction(task.actionKey);
  if (!action) {
    await finish("error", null, `Unknown action "${task.actionKey}".`);
    return;
  }

  // Re-validate params on every run: a task can outlive a schema change, and
  // that must fail loudly on one run rather than silently do the wrong thing.
  const parsed = action.params.safeParse(task.params);
  if (!parsed.success) {
    await finish("error", null, `Invalid params for "${task.actionKey}": ${parsed.error.message}`);
    return;
  }

  try {
    const result = await action.run(parsed.data, { dryRun, taskId });
    await finish("ok", result.summary, null);
  } catch (err) {
    await finish("error", null, (err as Error)?.message ?? String(err));
    throw err; // let BullMQ's failure handler dead-letter + notify (§55)
  }
}

export function startScheduledTaskWorker(): Worker {
  return new Worker<ScheduledTaskPayload>(
    QUEUE_NAME,
    async (job) => processScheduledTask(job.data),
    {
      connection: bullConnection,
      prefix:     bullPrefix,
      // One task's slow run must not block the others, but a single task must
      // not overlap itself — BullMQ delivers one job per scheduler occurrence,
      // and a still-running job holds its own lock, so concurrency here is a
      // cross-task setting only.
      concurrency: 3,
    },
  );
}

/**
 * Drop BullMQ schedulers with no backing enabled row.
 *
 * Schedulers live in Redis, tasks live in Postgres — delete a row while the
 * worker is down and the scheduler keeps firing forever. This is the piece that
 * makes the two stores converge, and it MUST run after plugin init for the same
 * reason the promotion job does: a half-initialized process draws wrong
 * conclusions about what should exist.
 */
export async function reconcileScheduledTasks(): Promise<{ removed: number; applied: number }> {
  const { applyTaskSchedule } = await import("../modules/scheduled-tasks/scheduled-task.service.js");

  const rows = await prisma.scheduledTask.findMany();
  const enabledById = new Map(rows.filter((r) => r.enabled).map((r) => [r.id, r]));

  const schedulers = await queues.scheduledTask.getJobSchedulers(0, 1000, true);
  let removed = 0;
  for (const s of schedulers) {
    const taskId = taskIdFromSchedulerId(String(s.key ?? ""));
    if (!taskId) continue;              // not ours
    if (enabledById.has(taskId)) continue;
    await queues.scheduledTask.removeJobScheduler(String(s.key)).catch(() => {});
    removed++;
  }

  // Re-assert every enabled task, so a task created while the worker was down
  // (or a Redis flush) still ends up scheduled.
  let applied = 0;
  for (const task of enabledById.values()) {
    try {
      await applyTaskSchedule(task);
      applied++;
    } catch (err) {
      logger.error({ taskId: task.id, err }, "scheduled task: could not apply schedule");
    }
  }

  if (removed || applied) logger.info({ removed, applied }, "scheduled tasks reconciled");
  return { removed, applied };
}

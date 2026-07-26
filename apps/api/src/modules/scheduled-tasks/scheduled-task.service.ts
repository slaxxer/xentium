import { z, type ZodType } from "zod";
import type { ScheduledTask } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";
import { queues } from "../../infrastructure/queue.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";
import {
  previewRuns,
  resolveCronPattern,
  type JobScheduleConfig,
} from "../../jobs/scheduledJobs.js";
import { schedulerIdFor } from "../../jobs/scheduledTask.js";
import { getAction, listActions } from "../../jobs/scheduled-actions/index.js";
import type { CreateTaskInput, UpdateTaskInput } from "./scheduled-task.validation.js";

/**
 * Global floor for admin-created tasks, on top of each action's own
 * `minIntervalSec`. Guards against a task set to fire every minute doing
 * full-table work.
 */
export const TASK_MIN_INTERVAL_SEC = 5 * 60;

/** Fallback when mode=cron with an empty pattern — daily at 04:00. */
const FALLBACK_CRON = "0 4 * * *";

function resolveAction(actionKey: string) {
  const action = getAction(actionKey);
  if (!action) {
    throw new NodevoError({
      code: NEC.API_VALIDATION, httpStatus: 422,
      message: `Unknown action "${actionKey}".`,
    });
  }
  return action;
}

/** Validate params against the action's own schema (NEC-API-4001 on failure). */
function validateParams(actionKey: string, params: unknown) {
  const action = resolveAction(actionKey);
  const parsed = action.params.safeParse(params ?? {});
  if (!parsed.success) {
    throw new NodevoError({
      code: NEC.API_VALIDATION, httpStatus: 422,
      message: `Invalid parameters for "${action.label}": ${parsed.error.issues.map(i => i.message).join("; ")}`,
    });
  }
  return parsed.data;
}

/** The effective minimum interval: the stricter of global and per-action. */
function minIntervalFor(actionKey: string): number {
  return Math.max(TASK_MIN_INTERVAL_SEC, resolveAction(actionKey).minIntervalSec);
}

/**
 * Push a task's schedule into BullMQ. Idempotent; validates the resolved cron
 * (throws NEC-QUEUE-5001) BEFORE upserting, so a rejected schedule never
 * reaches Redis. Also called by the boot reconcile.
 */
export async function applyTaskSchedule(task: ScheduledTask): Promise<void> {
  const schedulerId = schedulerIdFor(task.id);
  if (!task.enabled) {
    await queues.scheduledTask.removeJobScheduler(schedulerId).catch(() => {});
    return;
  }
  const cfg     = task.schedule as unknown as JobScheduleConfig;
  const pattern = resolveCronPattern(cfg, FALLBACK_CRON);
  previewRuns(pattern, cfg.tz, minIntervalFor(task.actionKey));
  await queues.scheduledTask.upsertJobScheduler(
    schedulerId,
    { pattern, tz: cfg.tz || undefined },
    { name: "scheduled-task", data: { taskId: task.id } },
  );
}

function shapeTask(task: ScheduledTask) {
  const action = getAction(task.actionKey);
  const cfg    = task.schedule as unknown as JobScheduleConfig;
  const pattern = resolveCronPattern(cfg, FALLBACK_CRON);

  let nextRuns: string[] = [];
  if (task.enabled) {
    // A stored schedule can become invalid if an action's floor was raised —
    // surface that as "no next runs" rather than failing the whole list.
    try { nextRuns = previewRuns(pattern, cfg.tz, minIntervalFor(task.actionKey)); } catch { /* keep empty */ }
  }

  return {
    id:          task.id,
    name:        task.name,
    actionKey:   task.actionKey,
    actionLabel: action?.label ?? task.actionKey,
    destructive: action?.destructive ?? false,
    params:      task.params,
    schedule:    cfg,
    cron:        pattern,
    enabled:     task.enabled,
    dryRun:      task.dryRun,
    lastRunAt:   task.lastRunAt,
    lastStatus:  task.lastStatus,
    createdAt:   task.createdAt,
    nextRuns,
  };
}

/**
 * Publish an action's params contract to the ACP as JSON Schema so the create
 * dialog can render a form from it. Derived from the SAME Zod schema the server
 * validates with — a second, hand-written field list would drift the moment an
 * action gained a parameter.
 *
 * Returns null if the schema cannot be represented (transforms, refinements with
 * no JSON Schema analogue). The dialog then says so instead of rendering a form
 * that would post the wrong shape; the action stays usable with its defaults.
 */
function paramsJsonSchema(schema: ZodType): Record<string, unknown> | null {
  try {
    return z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const scheduledTaskService = {
  /** The action catalogue the ACP create-dialog offers. */
  listActions() {
    return listActions().map((a) => ({
      key:            a.key,
      label:          a.label,
      description:    a.description,
      domain:         a.domain,
      destructive:    a.destructive ?? false,
      minIntervalSec: Math.max(TASK_MIN_INTERVAL_SEC, a.minIntervalSec),
      paramsSchema:   paramsJsonSchema(a.params),
    }));
  },

  async list() {
    const tasks = await prisma.scheduledTask.findMany({ orderBy: { createdAt: "asc" } });
    return tasks.map(shapeTask);
  },

  async get(id: string) {
    const task = await prisma.scheduledTask.findUnique({ where: { id } });
    if (!task) throw NodevoError.notFound("Scheduled task not found");
    return shapeTask(task);
  },

  async create(input: CreateTaskInput, createdById: string) {
    const params = validateParams(input.actionKey, input.params);

    const task = await prisma.scheduledTask.create({
      data: {
        name:      input.name,
        actionKey: input.actionKey,
        params:    params as object,
        schedule:  input.schedule as object,
        enabled:   input.enabled,
        dryRun:    input.dryRun,
        createdById,
      },
    });

    // Schedule after the row exists so the runner can always resolve it. If the
    // cron is rejected the row is rolled back — a task that cannot be scheduled
    // should not linger looking enabled.
    try {
      await applyTaskSchedule(task);
    } catch (err) {
      await prisma.scheduledTask.delete({ where: { id: task.id } }).catch(() => {});
      throw err;
    }
    return shapeTask(task);
  },

  async update(id: string, input: UpdateTaskInput) {
    const existing = await prisma.scheduledTask.findUnique({ where: { id } });
    if (!existing) throw NodevoError.notFound("Scheduled task not found");

    const actionKey = input.actionKey ?? existing.actionKey;
    const params    = input.params !== undefined || input.actionKey !== undefined
      ? validateParams(actionKey, input.params ?? existing.params)
      : existing.params;

    const task = await prisma.scheduledTask.update({
      where: { id },
      data: {
        ...(input.name     !== undefined && { name: input.name }),
        ...(input.enabled  !== undefined && { enabled: input.enabled }),
        ...(input.dryRun   !== undefined && { dryRun: input.dryRun }),
        ...(input.schedule !== undefined && { schedule: input.schedule as object }),
        actionKey,
        params: params as object,
      },
    });

    try {
      await applyTaskSchedule(task);
    } catch (err) {
      // Roll the schedule change back so Redis and Postgres cannot disagree.
      await prisma.scheduledTask.update({ where: { id }, data: { schedule: existing.schedule as object } });
      throw err;
    }
    return shapeTask(task);
  },

  async remove(id: string) {
    const existing = await prisma.scheduledTask.findUnique({ where: { id } });
    if (!existing) throw NodevoError.notFound("Scheduled task not found");
    // Scheduler first: a surviving scheduler with no row is the failure mode
    // that fires forever, whereas a row with no scheduler is simply inert.
    await queues.scheduledTask.removeJobScheduler(schedulerIdFor(id)).catch(() => {});
    await prisma.scheduledTask.delete({ where: { id } });
  },

  /** Queue one immediate run. `dryRun` overrides the task's own flag for this
   *  run only — carried in the payload, so it cannot race a scheduled run. */
  async runNow(id: string, dryRun?: boolean) {
    const task = await prisma.scheduledTask.findUnique({ where: { id } });
    if (!task) throw NodevoError.notFound("Scheduled task not found");
    await queues.scheduledTask.add("scheduled-task", { taskId: id, ...(dryRun !== undefined && { dryRun }) });
    return { ok: true };
  },

  async listRuns(id: string, limit = 20) {
    return prisma.scheduledTaskRun.findMany({
      where:   { taskId: id },
      orderBy: { startedAt: "desc" },
      take:    limit,
    });
  },
};

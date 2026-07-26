import { z } from "zod";

/** Mirrors JobScheduleConfig in jobs/scheduledJobs.ts so both systems accept the
 *  same schedule shape and the ACP can reuse one editor. */
export const taskScheduleSchema = z.object({
  mode:        z.enum(["interval", "daily", "cron"]),
  intervalMin: z.number().int().min(1).max(60 * 24 * 30).optional(),
  dailyTime:   z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM").optional(),
  cron:        z.string().min(1).max(200).optional(),
  tz:          z.string().max(64).optional(),
});

export const createTaskSchema = z.object({
  name:      z.string().min(1).max(120),
  actionKey: z.string().min(1).max(120),
  params:    z.record(z.string(), z.unknown()).default({}),
  schedule:  taskScheduleSchema,
  enabled:   z.boolean().default(true),
  dryRun:    z.boolean().default(false),
});

export const updateTaskSchema = createTaskSchema.partial();

export const taskIdParamSchema = z.object({ id: z.string().min(1).max(64) });

export const runNowSchema = z.object({
  /** Force a dry run for this invocation only, without changing the task. */
  dryRun: z.boolean().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskScheduleInput = z.infer<typeof taskScheduleSchema>;

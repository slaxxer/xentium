import type { RequestHandler } from "express";
import { scheduledTaskService } from "./scheduled-task.service.js";
import {
  createTaskSchema,
  updateTaskSchema,
  taskIdParamSchema,
  runNowSchema,
} from "./scheduled-task.validation.js";

/**
 * Scheduled tasks are persistent, privileged and run unattended, so every
 * mutation is audited — that comes free from `acpActivityLogger`, which is
 * mounted on /api/admin and records every mutating request with actor, path,
 * status and IP. These routes must therefore stay under /api/admin.
 */
export const scheduledTaskController = {
  listActions: (async (_req, res) => {
    res.json(scheduledTaskService.listActions());
  }) as RequestHandler,

  list: (async (_req, res) => {
    res.json(await scheduledTaskService.list());
  }) as RequestHandler,

  get: (async (req, res) => {
    const { id } = taskIdParamSchema.parse(req.params);
    res.json(await scheduledTaskService.get(id));
  }) as RequestHandler,

  create: (async (req, res) => {
    const input = createTaskSchema.parse(req.body);
    res.status(201).json(await scheduledTaskService.create(input, req.userId!));
  }) as RequestHandler,

  update: (async (req, res) => {
    const { id } = taskIdParamSchema.parse(req.params);
    const input  = updateTaskSchema.parse(req.body);
    res.json(await scheduledTaskService.update(id, input));
  }) as RequestHandler,

  remove: (async (req, res) => {
    const { id } = taskIdParamSchema.parse(req.params);
    await scheduledTaskService.remove(id);
    res.json({ ok: true });
  }) as RequestHandler,

  runNow: (async (req, res) => {
    const { id }     = taskIdParamSchema.parse(req.params);
    const { dryRun } = runNowSchema.parse(req.body ?? {});
    res.json(await scheduledTaskService.runNow(id, dryRun));
  }) as RequestHandler,

  runs: (async (req, res) => {
    const { id } = taskIdParamSchema.parse(req.params);
    res.json(await scheduledTaskService.listRuns(id));
  }) as RequestHandler,
};

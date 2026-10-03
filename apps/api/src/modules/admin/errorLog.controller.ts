import type { RequestHandler } from "express";
import { z } from "zod";
import { ERROR_SEVERITIES, errorLogService } from "./errorLog.service.js";

const groupKey = z.object({ key: z.string().regex(/^[0-9a-f]{1,32}$/) });

const listSchema = z.object({
  severity: z.enum(ERROR_SEVERITIES).optional(),
  domain:   z.string().regex(/^[A-Za-z0-9_]{1,32}$/).optional(),
  q:        z.string().max(200).optional(),
  key:      z.string().regex(/^[0-9a-f]{1,32}$/).optional(),
  status:   z.enum(["open", "resolved", "all"]).default("open"),
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const statsSchema = z.object({
  range:    z.enum(["24h", "7d"]).default("24h"),
  // Date#getTimezoneOffset of the admin's browser; ±14h covers every zone.
  tzOffset: z.coerce.number().int().min(-840).max(840).default(0),
});

const occurrencesSchema = z.object({
  cursor: z.string().max(64).optional(),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

export const errorLogController = {
  listGroups: (async (req, res) => {
    res.json(await errorLogService.listGroups(listSchema.parse(req.query)));
  }) as RequestHandler,

  stats: (async (req, res) => {
    const { range, tzOffset } = statsSchema.parse(req.query);
    res.json(await errorLogService.stats(range, tzOffset));
  }) as RequestHandler,

  occurrences: (async (req, res) => {
    const { key } = groupKey.parse(req.params);
    const { cursor, limit } = occurrencesSchema.parse(req.query);
    res.json(await errorLogService.occurrences(key, cursor, limit));
  }) as RequestHandler,

  setResolved: (async (req, res) => {
    const { key } = groupKey.parse(req.params);
    const { resolved } = z.object({ resolved: z.boolean() }).parse(req.body);
    await errorLogService.setResolved(key, resolved, req.userId);
    res.json({ ok: true });
  }) as RequestHandler,

  deleteGroup: (async (req, res) => {
    const { key } = groupKey.parse(req.params);
    res.json(await errorLogService.deleteGroup(key));
  }) as RequestHandler,

  deleteEntry: (async (req, res) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    await errorLogService.deleteEntry(id);
    res.json({ ok: true });
  }) as RequestHandler,
};

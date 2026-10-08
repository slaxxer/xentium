import type { RequestHandler } from "express";
import { z } from "zod";
import { ERROR_SEVERITIES, errorLogService } from "./errorLog.service.js";

const groupKey = z.object({ key: z.string().regex(/^[0-9a-f]{1,32}$/) });

const listSchema = z.object({
  severity: z.enum(ERROR_SEVERITIES).optional(),
  domain:   z.string().regex(/^[A-Za-z0-9_]{1,32}$/).optional(),
  q:        z.string().max(200).optional(),
  key:      z.string().regex(/^[0-9a-f]{1,32}$/).optional(),
  /** A username: only groups this member ran into. */
  user:     z.string().max(64).optional(),
  status:   z.enum(["open", "resolved", "all"]).default("open"),
  page:     z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const lookupSchema = z.object({
  code:   z.string().trim().toUpperCase().regex(/^[A-Z0-9]+(-[A-Z0-9]+){1,3}$/),
  member: z.string().trim().max(64).optional(),
  range:  z.enum(["24h", "7d"]).default("7d"),
  scope:  z.enum(["member", "all"]).default("member"),
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
    const { user, ...f } = listSchema.parse(req.query);
    // An unknown member matches nothing, rather than silently dropping the filter.
    const userId = user ? (await errorLogService.findMember(user))?.id ?? "-" : undefined;
    res.json({ ...(await errorLogService.listGroups({ ...f, ...(userId ? { userId } : {}) })), ...(user ? { user } : {}) });
  }) as RequestHandler,

  /** ACP → System → Error reference: one code's occurrences, optionally one member's. */
  lookup: (async (req, res) => {
    const { code, member, range, scope } = lookupSchema.parse(req.query);
    res.json(await errorLogService.codeOccurrences({ code, member, days: range === "24h" ? 1 : 7, scope, limit: 50 }));
  }) as RequestHandler,

  recentCodes: (async (_req, res) => {
    res.json(await errorLogService.recentCodes(5));
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

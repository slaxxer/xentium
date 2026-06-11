import type { RequestHandler } from "express";
import { z } from "zod";
import { moderationService } from "./moderation.service.js";

const idParam   = z.object({ id: z.string() });
const pageQuery = z.object({
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});

const searchUsersSchema = z.object({
  search: z.string().min(1).max(80),
  limit:  z.coerce.number().int().min(1).max(20).default(5),
});

const fileReportSchema = z.object({
  targetType: z.enum(["article", "article_comment", "profile_comment", "user", "plugin-content"]),
  targetId:   z.string().min(1),
  reason:     z.string().min(3).max(2000),
});

const updateReportSchema = z.object({
  status:     z.enum(["reviewed", "resolved", "dismissed"]).optional(),
  notes:      z.string().max(5000).optional(),
  assignedTo: z.string().nullable().optional(),
});

const issueWarningSchema = z.object({
  userId:    z.string().min(1),
  reason:    z.string().min(3).max(2000),
  expiresAt: z.string().datetime().nullable().optional(),
});

const issueBanSchema = z.object({
  userId:    z.string().min(1),
  type:      z.enum(["temporary", "permanent"]),
  reason:    z.string().min(3).max(2000),
  expiresAt: z.string().datetime().nullable().optional(),
});

const deleteCommentSchema = z.object({ reason: z.string().min(3).max(2000) });

export const moderationController = {
  // ── Canvas read ──────────────────────────────────────────────────────────────

  getSummary: (async (_req, res) => {
    res.json(await moderationService.getSummary());
  }) as RequestHandler,

  searchUsers: (async (req, res) => {
    const q = searchUsersSchema.parse(req.query);
    res.json(await moderationService.searchUsers(q));
  }) as RequestHandler,

  getUserProfile: (async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await moderationService.getUserModProfile(id));
  }) as RequestHandler,

  getUserWarnings: (async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await moderationService.getUserWarnings(id));
  }) as RequestHandler,

  getUserBans: (async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await moderationService.getUserBans(id));
  }) as RequestHandler,

  revokeAllSessions: (async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await moderationService.revokeAllSessions(id, (req as any).userId));
  }) as RequestHandler,

  listReports: (async (req, res) => {
    const q = pageQuery.parse(req.query);
    res.json(await moderationService.listReportsCanvas(q));
  }) as RequestHandler,

  listWarnings: (async (req, res) => {
    const q = pageQuery.parse(req.query);
    res.json(await moderationService.listWarningsCanvas(q));
  }) as RequestHandler,

  listBans: (async (req, res) => {
    const q = pageQuery.parse(req.query);
    res.json(await moderationService.listBansCanvas(q));
  }) as RequestHandler,

  listCases: (async (req, res) => {
    const q = pageQuery.parse(req.query);
    res.json(await moderationService.listCasesCanvas(q));
  }) as RequestHandler,

  listLog: (async (req, res) => {
    const q = pageQuery.parse(req.query);
    res.json(await moderationService.listLogCanvas(q));
  }) as RequestHandler,

  // ── Write actions ────────────────────────────────────────────────────────────

  fileReport: (async (req, res) => {
    const body = fileReportSchema.parse(req.body);
    res.status(201).json(await moderationService.fileReport({ ...body, reporterId: (req as any).userId }));
  }) as RequestHandler,

  updateReport: (async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body   = updateReportSchema.parse(req.body);
    res.json(await moderationService.updateReport(id, (req as any).userId, body));
  }) as RequestHandler,

  issueWarning: (async (req, res) => {
    const body = issueWarningSchema.parse(req.body);
    res.status(201).json(await moderationService.issueWarning({
      ...body,
      issuedById: (req as any).userId,
      expiresAt:  body.expiresAt ? new Date(body.expiresAt) : null,
    }));
  }) as RequestHandler,

  pardonWarning: (async (req, res) => {
    const { id } = idParam.parse(req.params);
    await moderationService.pardonWarning(id, (req as any).userId);
    res.status(204).end();
  }) as RequestHandler,

  issueBan: (async (req, res) => {
    const body = issueBanSchema.parse(req.body);
    await moderationService.issueBan({
      ...body,
      issuedById: (req as any).userId,
      expiresAt:  body.expiresAt ? new Date(body.expiresAt) : null,
    });
    res.status(204).end();
  }) as RequestHandler,

  liftBan: (async (req, res) => {
    const { id } = idParam.parse(req.params);
    await moderationService.liftBanById(id, (req as any).userId);
    res.status(204).end();
  }) as RequestHandler,

  updateCase: (async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { status } = z.object({ status: z.enum(["reviewed", "dismissed"]) }).parse(req.body);
    res.json(await moderationService.updateCase(id, (req as any).userId, status));
  }) as RequestHandler,

  banCaseUsers: (async (req, res) => {
    const { id } = idParam.parse(req.params);
    const results = await moderationService.banCaseUsers(id, (req as any).userId);
    res.json(results);
  }) as RequestHandler,

  deleteArticleComment: (async (req, res) => {
    const { id }    = idParam.parse(req.params);
    const { reason } = deleteCommentSchema.parse(req.body);
    await moderationService.moderatorDeleteArticleComment(id, (req as any).userId, reason);
    res.status(204).end();
  }) as RequestHandler,

  deleteProfileComment: (async (req, res) => {
    const { id }    = idParam.parse(req.params);
    const { reason } = deleteCommentSchema.parse(req.body);
    await moderationService.moderatorDeleteProfileComment(id, (req as any).userId, reason);
    res.status(204).end();
  }) as RequestHandler,
};

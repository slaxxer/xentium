import type { RequestHandler } from "express";
import { adminService } from "./admin.service.js";
import { z } from "zod";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import {
  SCHEDULED_JOBS, getJobDef, getJobConfig, saveJobConfig,
  applyJobSchedule, resolveCron, previewRuns,
} from "../../jobs/scheduledJobs.js";

const jobConfigSchema = z.object({
  enabled:     z.boolean(),
  mode:        z.enum(["interval", "daily", "cron"]),
  intervalMin: z.number().int().positive().max(10080).optional(),
  dailyTime:   z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  cron:        z.string().trim().min(1).max(120).optional(),
  tz:          z.string().max(64).optional(),
});

/** Assemble the admin view of one job: config + computed next runs + last run. */
async function jobView(def: (typeof SCHEDULED_JOBS)[number]) {
  const config = await getJobConfig(def);
  let nextRuns: string[] = [];
  let valid = true;
  let error: string | null = null;
  if (config.enabled) {
    try {
      nextRuns = previewRuns(resolveCron(config, def), config.tz, def.minIntervalSec);
    } catch (e) {
      valid = false;
      error = (e as Error)?.message ?? "Invalid schedule.";
    }
  }
  let lastRun: { at: number | null; status: "completed" | "failed" | null } = { at: null, status: null };
  try {
    const [done, failed] = await Promise.all([
      def.queue.getJobs(["completed"], 0, 0),
      def.queue.getJobs(["failed"], 0, 0),
    ]);
    const d = done[0]?.finishedOn ?? null;
    const f = failed[0]?.finishedOn ?? null;
    if (d || f) lastRun = (d ?? 0) >= (f ?? 0) ? { at: d, status: "completed" } : { at: f, status: "failed" };
  } catch { /* queue inspection is best-effort */ }

  return {
    key: def.key, label: def.label, description: def.description,
    defaultCron: def.defaultCron, minIntervalSec: def.minIntervalSec,
    config, pattern: config.enabled ? resolveCron(config, def) : null,
    nextRuns, valid, error, lastRun,
  };
}

const idParamSchema = z.object({ id: z.string() });
const keyParamSchema = z.object({ key: z.string() });

const listUsersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  groupId: z.string().optional(),
});
const setGroupsSchema = z.object({ groupIds: z.array(z.string()) });
const setActiveSchema = z.object({ isActive: z.boolean() });

const createFieldSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/).min(2).max(40),
  label: z.string().min(1).max(80),
  type: z.enum(["text", "date", "email", "url"]),
  placeholder: z.string().optional(),
  showOnRegistration: z.boolean().default(false),
  requiredOnRegistration: z.boolean().default(false),
  showOnProfile: z.boolean().default(true),
});
const updateFieldSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  placeholder: z.string().optional(),
  showOnRegistration: z.boolean().optional(),
  requiredOnRegistration: z.boolean().optional(),
  showOnProfile: z.boolean().optional(),
  dobDisplayFormat: z.enum(["age", "birthday", "full"]).optional(),
});
const reorderSchema = z.object({
  items: z.array(z.object({ id: z.string(), position: z.number().int() })),
});
const settingSchema = z.object({ value: z.unknown() });
const listArticlesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
});
const paginatedSchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  type:   z.string().optional(),
});
const modLogSchema = z.object({
  page:         z.coerce.number().int().positive().default(1),
  limit:        z.coerce.number().int().min(1).max(100).default(20),
  action:       z.string().optional(),
  actionPrefix: z.string().optional(),
  actorType:    z.string().optional(),
});
const errorLogSchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(50),
  severity: z.string().optional(),
  domain:   z.string().optional(),
});

export const adminController = {
  // Dashboard
  dashboard: (async (_req, res) => {
    res.json(await adminService.getDashboardStats());
  }) as RequestHandler,

  dashboardAnalytics: (async (req, res) => {
    const range = Number(req.query.range) || 30;
    res.json(await adminService.getDashboardAnalytics(range));
  }) as RequestHandler,

  // Users
  listUsers: (async (req, res) => {
    const q = listUsersSchema.parse(req.query);
    res.json(await adminService.listUsers(q));
  }) as RequestHandler,

  getUserDetail: (async (req, res) => {
    res.json(await adminService.getUserDetail(idParamSchema.parse(req.params).id));
  }) as RequestHandler,

  listUserLoginEvents: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { page, limit } = paginatedSchema.parse(req.query);
    res.json(await adminService.listUserLoginEvents(id, page, limit));
  }) as RequestHandler,

  setUserGroups: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { groupIds } = setGroupsSchema.parse(req.body);
    await adminService.setUserGroups(id, groupIds);
    res.status(204).end();
  }) as RequestHandler,

  setUserActive: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { isActive } = setActiveSchema.parse(req.body);
    res.json(await adminService.setUserActive(id, isActive, (req as any).userId));
  }) as RequestHandler,

  banUser: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = z.object({
      type:      z.enum(["temporary", "permanent"]),
      reason:    z.string().min(1),
      expiresAt: z.string().datetime().optional().nullable(),
    }).parse(req.body);
    await adminService.banUser({
      userId:      id,
      issuedById:  (req as any).userId,
      type:        body.type,
      reason:      body.reason,
      expiresAt:   body.expiresAt ? new Date(body.expiresAt) : null,
    });
    res.status(204).end();
  }) as RequestHandler,

  liftBan: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await adminService.liftBan(id, (req as any).userId);
    res.status(204).end();
  }) as RequestHandler,

  forceLogoutUser: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await adminService.forceLogoutUser(id, (req as any).userId));
  }) as RequestHandler,

  sendPasswordReset: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await adminService.sendPasswordResetForUser(id, (req as any).userId));
  }) as RequestHandler,

  // Profile fields
  listProfileFields: (async (_req, res) => {
    res.json(await adminService.listProfileFields());
  }) as RequestHandler,

  createProfileField: (async (req, res) => {
    const body = createFieldSchema.parse(req.body);
    res.status(201).json(await adminService.createProfileField(body));
  }) as RequestHandler,

  updateProfileField: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateFieldSchema.parse(req.body);
    res.json(await adminService.updateProfileField(id, body));
  }) as RequestHandler,

  deleteProfileField: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await adminService.deleteProfileField(id);
    res.status(204).end();
  }) as RequestHandler,

  reorderProfileFields: (async (req, res) => {
    const { items } = reorderSchema.parse(req.body);
    await adminService.reorderProfileFields(items);
    res.status(204).end();
  }) as RequestHandler,

  // Settings
  getSettings: (async (_req, res) => {
    res.json(await adminService.getSettings());
  }) as RequestHandler,

  getOneSetting: (async (req, res) => {
    const { key } = keyParamSchema.parse(req.params);
    const all  = await adminService.getSettings();
    const row  = (all as Array<{key:string;value:unknown}>).find((s) => s.key === key);
    res.json({ key, value: row?.value ?? null });
  }) as RequestHandler,

  setSetting: (async (req, res) => {
    const { key } = keyParamSchema.parse(req.params);
    const { value } = settingSchema.parse(req.body);
    res.json(await adminService.setSetting(key, value));
  }) as RequestHandler,

  // Articles
  listArticles: (async (req, res) => {
    const q = listArticlesSchema.parse(req.query);
    res.json(await adminService.listArticles(q));
  }) as RequestHandler,

  deleteArticle: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await adminService.softDeleteArticle(id);
    res.status(204).end();
  }) as RequestHandler,

  // Moderation — list
  listReports: (async (req, res) => {
    const q = paginatedSchema.parse(req.query);
    res.json(await adminService.listReports(q));
  }) as RequestHandler,

  updateReport: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = z.object({
      status:     z.enum(["reviewed", "resolved", "dismissed"]).optional(),
      notes:      z.string().max(5000).optional(),
      assignedTo: z.string().nullable().optional(),
    }).parse(req.body);
    res.json(await adminService.updateReport(id, (req as any).userId, body));
  }) as RequestHandler,

  listWarnings: (async (req, res) => {
    const q = paginatedSchema.parse(req.query);
    res.json(await adminService.listWarnings(q));
  }) as RequestHandler,

  issueWarning: (async (req, res) => {
    const body = z.object({
      userId:    z.string().min(1),
      reason:    z.string().min(3).max(2000),
      expiresAt: z.string().datetime().nullable().optional(),
    }).parse(req.body);
    const warning = await adminService.issueWarning({
      ...body,
      issuedById: (req as any).userId,
      expiresAt:  body.expiresAt ? new Date(body.expiresAt) : null,
    });
    res.status(201).json(warning);
  }) as RequestHandler,

  pardonWarning: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await adminService.pardonWarning(id, (req as any).userId);
    res.status(204).end();
  }) as RequestHandler,

  listBans: (async (req, res) => {
    const q = paginatedSchema.parse(req.query);
    res.json(await adminService.listBans(q));
  }) as RequestHandler,

  listCases: (async (req, res) => {
    const q = paginatedSchema.parse(req.query);
    res.json(await adminService.listCases(q));
  }) as RequestHandler,

  updateCase: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { status } = z.object({ status: z.enum(["reviewed", "dismissed"]) }).parse(req.body);
    res.json(await adminService.updateCase(id, (req as any).userId, status));
  }) as RequestHandler,

  updateCaseNotes: (async (req, res) => {
    const { id }    = idParamSchema.parse(req.params);
    const { notes } = z.object({ notes: z.string().max(2000) }).parse(req.body);
    await adminService.updateCaseNotes(id, notes);
    res.status(204).end();
  }) as RequestHandler,

  banCaseUsers: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { moderationService } = await import("../moderation/moderation.service.js");
    res.json(await moderationService.banCaseUsers(id, (req as any).userId));
  }) as RequestHandler,

  revokeException: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await adminService.revokeException(id, (req as any).userId));
  }) as RequestHandler,

  listModLog: (async (req, res) => {
    const q = modLogSchema.parse(req.query);
    res.json(await adminService.listModLog(q));
  }) as RequestHandler,

  deleteArticleComment: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { reason } = z.object({ reason: z.string().min(3).max(2000) }).parse(req.body);
    await adminService.moderatorDeleteComment("article", id, (req as any).userId, reason);
    res.status(204).end();
  }) as RequestHandler,

  deleteProfileComment: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { reason } = z.object({ reason: z.string().min(3).max(2000) }).parse(req.body);
    await adminService.moderatorDeleteComment("profile", id, (req as any).userId, reason);
    res.status(204).end();
  }) as RequestHandler,

  // Plugins
  listInstalledPlugins: (async (_req, res) => {
    res.json(await adminService.listInstalledPlugins());
  }) as RequestHandler,

  // License
  getActiveLicense: (async (_req, res) => {
    const license = await adminService.getActiveLicense();
    res.json(license ?? null);
  }) as RequestHandler,

  activateLicense: (async (req, res) => {
    const { licenseKey } = z.object({ licenseKey: z.string().min(1) }).parse(req.body);
    const { activateLicense } = await import("../../core/license-engine/license-engine.js");
    await activateLicense(licenseKey);
    res.json({ ok: true });
  }) as RequestHandler,

  refreshLicense: (async (_req, res) => {
    const { refreshLicense } = await import("../../core/license-engine/license-engine.js");
    await refreshLicense();
    res.json({ ok: true });
  }) as RequestHandler,

  deactivateLicense: (async (_req, res) => {
    const { deactivateLicense } = await import("../../core/license-engine/license-engine.js");
    await deactivateLicense();
    res.json({ ok: true });
  }) as RequestHandler,

  // ── Marketplace (ADR 0001) ──────────────────────────────────────────────────

  listMarketplacePlugins: (async (req, res) => {
    const { paginatedRequestSchema } = await import("@nodevo/contracts");
    const opts = paginatedRequestSchema.parse(req.query);
    const { marketplaceSource } = await import("../../core/license-engine/marketplace-source.js");
    res.json(await marketplaceSource.listPlugins(opts));
  }) as RequestHandler,

  getMarketplaceConnection: (async (_req, res) => {
    const { marketplaceSource } = await import("../../core/license-engine/marketplace-source.js");
    res.json(await marketplaceSource.getConnection());
  }) as RequestHandler,

  connectMarketplace: (async (req, res) => {
    const { authCode } = z.object({ authCode: z.string().min(1) }).parse(req.body);
    const { marketplaceSource } = await import("../../core/license-engine/marketplace-source.js");
    res.json(await marketplaceSource.connect(authCode));
  }) as RequestHandler,

  disconnectMarketplace: (async (_req, res) => {
    const { marketplaceSource } = await import("../../core/license-engine/marketplace-source.js");
    await marketplaceSource.disconnect();
    res.json({ ok: true });
  }) as RequestHandler,

  // The authenticated download gate — verifies account + per-domain ownership and
  // returns a fresh domain-bound entitlement for this site.
  authorizeMarketplaceDownload: (async (req, res) => {
    const { pluginId, version } = z.object({
      pluginId: z.string().min(1),
      version:  z.string().min(1).default("latest"),
    }).parse(req.body);

    const { marketplaceSource } = await import("../../core/license-engine/marketplace-source.js");
    const { getSiteDomain, resolveEnvironment } = await import("../../core/license-engine/license-engine.js");
    const { prisma } = await import("../../infrastructure/db.js");

    const siteRow = await prisma.setting.findUnique({ where: { key: "site.id" } });
    const siteId  = (siteRow?.value as string | null) ?? "dev-site";

    const authorized = await marketplaceSource.authorizeDownload({
      pluginId,
      version,
      siteId,
      domain:      getSiteDomain(),
      environment: resolveEnvironment(),
    });
    res.json(authorized);
  }) as RequestHandler,

  // Error log
  listErrorLog: (async (req, res) => {
    const q = errorLogSchema.parse(req.query);
    res.json(await adminService.listErrorLog(q));
  }) as RequestHandler,

  clearErrorLog: (async (req, res) => {
    const { severity } = z.object({ severity: z.string().optional() }).parse(req.query);
    await adminService.clearErrorLog(severity);
    res.json({ ok: true });
  }) as RequestHandler,

  // Migration history
  listMigrationHistory: (async (_req, res) => {
    res.json(await adminService.listMigrationHistory());
  }) as RequestHandler,

  // Style history
  listStyleHistory: (async (_req, res) => {
    res.json(await adminService.listStyleHistory());
  }) as RequestHandler,

  // Nav items
  listNavItems: (async (_req, res) => {
    await adminService.seedDefaultNavItems();
    res.json(await adminService.listNavItems());
  }) as RequestHandler,

  createNavItem: (async (req, res) => {
    const body = z.object({
      label: z.string().min(1).max(80),
      url: z.string().min(1).max(500),
      openInNewTab: z.boolean().default(false),
      visibility: z.enum(["public","members","groups"]).default("public"),
    }).parse(req.body);
    res.status(201).json(await adminService.createNavItem(body));
  }) as RequestHandler,

  updateNavItem: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = z.object({
      label: z.string().min(1).max(80).optional(),
      url: z.string().min(1).max(500).optional(),
      isActive: z.boolean().optional(),
      openInNewTab: z.boolean().optional(),
      visibility: z.enum(["public","members","groups"]).optional(),
    }).parse(req.body);
    res.json(await adminService.updateNavItem(id, body));
  }) as RequestHandler,

  reorderNavItems: (async (req, res) => {
    const { items } = z.object({
      items: z.array(z.object({ id: z.string(), position: z.number().int() })),
    }).parse(req.body);
    await adminService.reorderNavItems(items);
    res.status(204).end();
  }) as RequestHandler,

  deleteNavItem: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await adminService.deleteNavItem(id);
    res.status(204).end();
  }) as RequestHandler,

  // Health
  health: (async (_req, res) => {
    res.json(await adminService.getHealth());
  }) as RequestHandler,

  // Scheduled tasks (cron jobs)
  listJobs: (async (_req, res) => {
    res.json(await Promise.all(SCHEDULED_JOBS.map(jobView)));
  }) as RequestHandler,

  updateJob: (async (req, res) => {
    const { key } = keyParamSchema.parse(req.params);
    const def = getJobDef(key);
    if (!def) throw NodevoError.notFound("Unknown job");
    const config = jobConfigSchema.parse(req.body);
    // applyJobSchedule validates the resolved pattern (throws NEC-QUEUE-5001 on a
    // bad cron / too-frequent schedule) BEFORE we persist — so a rejected config
    // is never saved and the live scheduler is only touched on success.
    await applyJobSchedule(def, config);
    await saveJobConfig(def, config);
    res.json(await jobView(def));
  }) as RequestHandler,

  runJob: (async (req, res) => {
    const { key } = keyParamSchema.parse(req.params);
    const def = getJobDef(key);
    if (!def) throw NodevoError.notFound("Unknown job");
    await def.queue.add(def.jobName, {});
    res.json({ ok: true });
  }) as RequestHandler,
};

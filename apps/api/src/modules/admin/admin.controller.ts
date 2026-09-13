import type { RequestHandler } from "express";
import { adminService } from "./admin.service.js";
import { z } from "zod";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { getSetting } from "../../shared/utils/settings.js";
import { paginatedRequestSchema } from "@xentium/contracts";
import { marketplaceService } from "./marketplace.service.js";
import { refreshLicense, deactivateLicense } from "../../core/license-engine/license-engine.js";
import { moderationService } from "../moderation/moderation.service.js";
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

/** Browse query: the shared pagination contract plus the catalogue's `q` and
 *  which half of it to show. `kind` defaults to plugins so every existing caller
 *  keeps the grid it has always had. */
const marketplaceListQuerySchema = paginatedRequestSchema.extend({
  q:    z.string().min(1).max(128).optional(),
  kind: z.enum(["plugin", "theme"]).default("plugin"),
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
    res.json(await adminService.setUserActive(id, isActive, req.userId!));
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
      issuedById:  req.userId!,
      type:        body.type,
      reason:      body.reason,
      expiresAt:   body.expiresAt ? new Date(body.expiresAt) : null,
    });
    res.status(204).end();
  }) as RequestHandler,

  liftBan: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await adminService.liftBan(id, req.userId!);
    res.status(204).end();
  }) as RequestHandler,

  forceLogoutUser: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await adminService.forceLogoutUser(id, req.userId!));
  }) as RequestHandler,

  sendPasswordReset: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await adminService.sendPasswordResetForUser(id, req.userId!));
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
    // Same defaults-merge semantics as getSettings, without loading every row.
    const fallback = (adminService.SETTING_DEFAULTS as Record<string, unknown>)[key] ?? null;
    res.json({ key, value: await getSetting(key, fallback) });
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
    res.json(await adminService.updateReport(id, req.userId!, body));
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
      issuedById: req.userId!,
      expiresAt:  body.expiresAt ? new Date(body.expiresAt) : null,
    });
    res.status(201).json(warning);
  }) as RequestHandler,

  pardonWarning: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await adminService.pardonWarning(id, req.userId!);
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
    res.json(await adminService.updateCase(id, req.userId!, status));
  }) as RequestHandler,

  updateCaseNotes: (async (req, res) => {
    const { id }    = idParamSchema.parse(req.params);
    const { notes } = z.object({ notes: z.string().max(2000) }).parse(req.body);
    await adminService.updateCaseNotes(id, notes);
    res.status(204).end();
  }) as RequestHandler,

  banCaseUsers: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await moderationService.banCaseUsers(id, req.userId!));
  }) as RequestHandler,

  revokeException: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await adminService.revokeException(id, req.userId!));
  }) as RequestHandler,

  listModLog: (async (req, res) => {
    const q = modLogSchema.parse(req.query);
    res.json(await adminService.listModLog(q));
  }) as RequestHandler,

  deleteArticleComment: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { reason } = z.object({ reason: z.string().min(3).max(2000) }).parse(req.body);
    await adminService.moderatorDeleteComment("article", id, req.userId!, reason);
    res.status(204).end();
  }) as RequestHandler,

  deleteProfileComment: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { reason } = z.object({ reason: z.string().min(3).max(2000) }).parse(req.body);
    await adminService.moderatorDeleteComment("profile", id, req.userId!, reason);
    res.status(204).end();
  }) as RequestHandler,

  // Plugins
  listInstalledPlugins: (async (_req, res) => {
    res.json(await adminService.listInstalledPlugins());
  }) as RequestHandler,

  // License
  getActiveEntitlement: (async (_req, res) => {
    const license = await adminService.getActiveEntitlement();
    res.json(license ?? null);
  }) as RequestHandler,

  refreshLicense: (async (_req, res) => {
    await refreshLicense();
    res.json({ ok: true });
  }) as RequestHandler,

  deactivateLicense: (async (_req, res) => {
    await deactivateLicense();
    res.json({ ok: true });
  }) as RequestHandler,

  // ── Marketplace (ADR 0001) — logic lives in marketplace.service.ts ─────────

  listMarketplacePlugins: (async (req, res) => {
    // Pagination plus a search term. The catalogue searches server-side; the
    // ACP used to filter the fetched page in memory, which made a plugin past
    // the first page unfindable by its own name.
    const opts = marketplaceListQuerySchema.parse(req.query);
    res.json(await marketplaceService.listPlugins(opts));
  }) as RequestHandler,

  getMarketplaceConnection: (async (_req, res) => {
    res.json(await marketplaceService.getConnection());
  }) as RequestHandler,

  /**
   * Begin the one-click link. Returns the code to show the admin and the URL to
   * open — never the poll secret, which stays server-side.
   */
  startMarketplaceLink: (async (_req, res) => {
    res.status(201).json(await marketplaceService.startLink());
  }) as RequestHandler,

  /** Where the ACP waits. `pending` is a 200 with a status, not an error: it is
   *  the normal answer for as long as the admin is still reading the approval
   *  screen. */
  pollMarketplaceLink: (async (req, res) => {
    const { linkId } = z.object({ linkId: z.string().min(1).max(64) }).parse(req.params);
    res.json(await marketplaceService.pollLink(linkId));
  }) as RequestHandler,

  // The ownership loop's instance end: ask the marketplace what this account
  // holds. Not cached — an admin opening this page has usually just bought
  // something, and a stale answer is the one thing it must not give.
  getMarketplaceOwned: (async (_req, res) => {
    res.json(await marketplaceService.listOwned());
  }) as RequestHandler,

  getMarketplaceUpdates: (async (req, res) => {
    res.json(await marketplaceService.getUpdates(req.userId));
  }) as RequestHandler,

  getStatusSummary: (async (req, res) => {
    res.json(await marketplaceService.getStatusSummary(req.userId));
  }) as RequestHandler,

  connectMarketplace: (async (req, res) => {
    const { authCode } = z.object({ authCode: z.string().min(1) }).parse(req.body);
    res.json(await marketplaceService.connect(authCode));
  }) as RequestHandler,

  disconnectMarketplace: (async (_req, res) => {
    await marketplaceService.disconnect();
    res.json({ ok: true });
  }) as RequestHandler,

  authorizeMarketplaceDownload: (async (req, res) => {
    const { pluginId, version, kind } = z.object({
      pluginId: z.string().min(1),
      version:  z.string().min(1).default("latest"),
      kind:     z.enum(["plugin", "theme"]).default("plugin"),
    }).parse(req.body);
    res.json(await marketplaceService.authorizeDownload(pluginId, version, kind));
  }) as RequestHandler,

  // STREAMS progress, same newline-delimited JSON contract as the update route:
  // zero or more {phase,percent,message} events while the server authorizes →
  // downloads (by bytes) → verifies → installs, then a final {done:true, ok, …}.
  // Both are consumed by runStreamedJob() on the client.
  installFromMarketplace: (async (req, res) => {
    // `kind` picks the intake, not the route: both halves of the catalogue go
    // through one authenticated download gate, one rate limiter and one progress
    // contract. A second endpoint would be a second place to forget the limiter.
    const { pluginId, version, kind } = z.object({
      pluginId: z.string().min(1),
      version:  z.string().min(1),
      kind:     z.enum(["plugin", "theme"]).default("plugin"),
    }).parse(req.body);

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no"); // don't let a proxy buffer the stream
    res.flushHeaders?.();
    const emit = (evt: object) => { res.write(JSON.stringify(evt) + "\n"); };

    try {
      const result = kind === "theme"
        ? await marketplaceService.installThemeFromMarketplace(pluginId, version, req.userId!, (p) => emit(p))
        : await marketplaceService.installFromMarketplace(pluginId, version, req.userId!, (p) => emit(p));
      emit({ done: true, ok: true, ...result });
    } catch (err: any) {
      // Headers are already sent, so errorMiddleware can no longer shape this —
      // surface the coded failure as a terminal stream event instead.
      emit({ done: true, ok: false, code: err?.code, message: err?.message ?? "Install failed." });
    } finally {
      res.end();
    }
  }) as RequestHandler,

  // §16.2 update-in-place — STREAMS progress. The response is newline-delimited
  // JSON: zero or more {phase,percent,message} events as the server authorizes →
  // downloads (by bytes) → verifies → swaps → migrates → re-enables, then a final
  // {done:true, ok, ...}. The ACP Updates page renders these in a progress dialog.
  updateFromMarketplace: (async (req, res) => {
    const { pluginId, version } = z.object({
      pluginId: z.string().min(1),
      version:  z.string().min(1),
    }).parse(req.body);

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no"); // don't let a proxy buffer the stream
    res.flushHeaders?.();
    const emit = (evt: object) => { res.write(JSON.stringify(evt) + "\n"); };

    try {
      const result = await marketplaceService.updateFromMarketplace(pluginId, version, req.userId!, (p) => emit(p));
      emit({ done: true, ok: true, ...result });
    } catch (err: any) {
      // Headers are already sent — surface the failure as a terminal stream event
      // (with the coded message where we have one) rather than an HTTP error.
      emit({ done: true, ok: false, code: err?.code, message: err?.message ?? "Update failed." });
    } finally {
      res.end();
    }
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
    if (!def) throw XentiumError.notFound("Unknown job");
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
    if (!def) throw XentiumError.notFound("Unknown job");
    await def.queue.add(def.jobName, {});
    res.json({ ok: true });
  }) as RequestHandler,
};

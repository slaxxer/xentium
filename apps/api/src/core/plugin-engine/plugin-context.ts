import type { Router } from "express";
import type { PluginContext, PluginHost, PermissionDeclaration, NavItemDeclaration, AcpPageDeclaration, SearchSource, HomeFeedSource, ReportTargetHandler, EmbedHandler, ContentKindHandler, StatSource, ProgressionCriteria, NotifyOptions, PluginRouter, XecCodeDeclaration, LayoutTemplateDeclaration, BadgeCriteria
} from "@xentium/plugin-sdk";
import { CorePermissions, registerTemplate } from "@xentium/contracts";
import { progressionCriteriaRegistry } from "../progression-registry/progression-criteria-registry.js";
import { badgeCriteriaRegistry } from "../badge-registry/badge-criteria-registry.js";
import { prisma } from "../../infrastructure/db.js";
import { pluginRouter } from "./plugin-router.js";
import { acpPageRegistry } from "./acp-page-registry.js";
import { securityScanRegistry } from "../security/security-scan-registry.js";
import { authGuardRegistry, type AuthGuard } from "../auth-guard-registry/auth-guard-registry.js";
import { searchRegistry } from "../search-registry/search-registry.js";
import { seoRegistry } from "../../modules/seo/seo.registry.js";
import { defaults as seoDefaults, describe as seoDescribe, headFor as seoHeadFor } from "../../modules/seo/seo.service.js";
import type { PageSource, SeoProvider } from "@xentium/contracts";
import { reportTargetRegistry } from "../report-target-registry/report-target-registry.js";
import { embedRegistry } from "../embed-registry/embed-registry.js";
import { contentRegistry } from "../content-registry/content-registry.js";
import { homeFeedRegistry } from "../home-feed-registry/home-feed-registry.js";
import { statRegistry } from "../stat-registry/stat-registry.js";
import { necRegistry } from "../xec-registry/xec-registry.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { queues } from "../../infrastructure/queue.js";
import { env } from "../../config/env.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { optionalAuth } from "../../shared/middleware/optionalAuth.js";
import { getEffectiveProgressionGroupId } from "../../shared/middleware/contentLimits.js";
import { requirePermission, hasPermission } from "../../shared/middleware/requirePermission.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { encryptSecret, decryptSecret } from "../../shared/utils/secretBox.js";
import { countryOf, geoipAvailable } from "../../infrastructure/geoip.js";
import { permissionCache } from "../../modules/permissions/permission.cache.js";
import { sanitizeRichText } from "../../shared/sanitize/richText.js";
import { renderEmailTemplate, siteVars } from "../../infrastructure/email/email-templates.js";
import { recipientLocale, serverText, toServerLocale } from "../../shared/i18n/serverText.js";
import { resolveCronPattern, previewRuns } from "../../jobs/scheduledJobs.js";
import { addFilter, addListener, emitAny, emitGroupsChanged } from "../events/events.js";

/**
 * A plugin putting a member into a group (a paid membership, an earned role). The
 * permission cache is cleared at once, or the new rights would arrive minutes late.
 * ⚠ Never a group with `admin.access`: plugins already have the database, but the
 * host's own helper must not be the easy way to make someone an administrator.
 */
export async function addToGroup(userId: string, groupId: string): Promise<void> {
  const admin = await prisma.groupPermission.findFirst({
    where: { groupId, permission: { key: CorePermissions.ADMIN_ACCESS } }, select: { groupId: true },
  });
  if (admin) {
    throw new XentiumError({ code: XEC.API_FORBIDDEN, httpStatus: 403, message: "A plugin cannot add members to a group with admin access" });
  }
  const had = await prisma.userGroup.findUnique({ where: { userId_groupId: { userId, groupId } }, select: { userId: true } });
  await prisma.userGroup.upsert({
    where: { userId_groupId: { userId, groupId } }, update: {}, create: { userId, groupId },
  });
  await permissionCache.invalidate(userId);
  if (!had) emitGroupsChanged(userId, [], [groupId]);
}

export async function removeFromGroup(userId: string, groupId: string): Promise<void> {
  const { count } = await prisma.userGroup.deleteMany({ where: { userId, groupId } });
  await permissionCache.invalidate(userId);
  if (count) emitGroupsChanged(userId, [groupId], []);
}

/** Host services injected into every plugin's onEnable/onDisable context. */
const host: PluginHost = {
  prisma,
  queues,
  env,
  logger,
  errors:     { XentiumError, XEC },
  middleware: {
    requireAuth,
    optionalAuth,
    // Wrap so plugins can pass any permission-key string (core type is a strict union).
    requirePermission: (key: string) => requirePermission(key as never),
  },
  progression: { getEffectiveGroupId: getEffectiveProgressionGroupId },
  // Embeds inside content, and who may see that content (fails closed).
  content: {
    canView:      (kind, id, viewerId) => contentRegistry.canView(kind, id, viewerId),
    syncEmbeds:   (embedHost, body) => embedRegistry.sync(embedHost, body),
    removeEmbeds: (embedHost) => embedRegistry.remove(embedHost),
  },
  // Ask instead of refuse: e.g. "may this member still reply to a closed thread?".
  permissions: { has: (userId: string, key: string) => hasPermission(userId, key as never) },
  utils:      { resolveAvatar, sanitizeRichText, cron: { resolveCron: resolveCronPattern, previewRuns }, encryptSecret, decryptSecret },
  groups:     { add: addToGroup, remove: removeFromGroup },
  notificationService: {
    // Lazy import avoids a top-level circular dependency with the engine.
    dispatch: async (opts: any) => {
      const { notificationService } = await import("../../modules/notifications/notification.service.js");
      await notificationService.dispatch(opts);
    },
  },
  geo: { countryOf: (ip: string) => countryOf(ip), available: geoipAvailable },
  // Mail for people a notification can't reach (no account), in the notification
  // email's design. Values are escaped by the template; the link must be safe.
  email: {
    send: async ({ to, title, body, link, buttonLabel, locale }) => {
      const lang = toServerLocale(locale) ?? "en";
      const { subject, html } = await renderEmailTemplate("notification", {
        ...(await siteVars()),
        title, body,
        link_url:    link,
        link_label:  buttonLabel ?? serverText(lang, "email", "buttons.view"),
      }, lang);
      await queues.emailNotification.add("email-notification", { to, subject, html });
    },
    localeOf: (userId: string) => recipientLocale({ userId }),
  },
  // Search engines: what a page is (any registered source), the tags core would
  // write, the tags actually written, and every source (for sitemaps).
  seo: {
    describe: (path: string) => seoDescribe(path),
    defaults: (path: string, info) => seoDefaults(path, info),
    head: (path: string) => seoHeadFor(path),
    sources: () => seoRegistry.sources(),
  },
  security: {
    createCase: async (opts: any) => {
      const { createModerationCase } = await import("../../modules/moderation/moderationCase.service.js");
      await createModerationCase(opts);
    },
    autoBanMultiaccounts: async (userIds: string[], reason: string, textKey?: string) => {
      const { moderationService } = await import("../../modules/moderation/moderation.service.js");
      return moderationService.autoBanMultiaccounts(userIds, reason, textKey);
    },
  },
};

export class PluginContextImpl implements PluginContext {
  readonly host: PluginHost = host;

  constructor(public readonly pluginId: string) {}

  registerRoutes(router: Router | PluginRouter): void {
    pluginRouter.register(this.pluginId, router as Router);
    logger.info({ pluginId: this.pluginId }, "Plugin routes registered");
  }

  async registerPermissions(perms: PermissionDeclaration[]): Promise<void> {
    for (const perm of perms) {
      const existing = await prisma.permission.findUnique({ where: { key: perm.key }, select: { id: true } });
      const permission = await prisma.permission.upsert({
        where:  { key: perm.key },
        update: { label: perm.label },
        create: { key: perm.key, label: perm.label },
      });

      // Default groups ONCE — when the permission is first created. This runs on every
      // enable, i.e. every boot: re-applying it re-granted a permission an admin had
      // taken away in ACP → Permissions at the next restart. After the first time the
      // ACP is the only thing that decides who holds it.
      if (existing) continue;
      for (const groupKey of perm.defaults ?? []) {
        const group = await prisma.group.findUnique({ where: { key: groupKey } });
        if (!group) continue;
        await prisma.groupPermission.upsert({
          where:  { groupId_permissionId: { groupId: group.id, permissionId: permission.id } },
          update: {},
          create: { groupId: group.id, permissionId: permission.id },
        });
        // Members' cached permissions predate the grant: without this the admin who
        // just enabled the plugin is refused its own pages for up to five minutes.
        await permissionCache.invalidateForGroup(group.id).catch(() => {});
      }
    }
    logger.info({ pluginId: this.pluginId, count: perms.length }, "Plugin permissions registered");
  }

  async registerNavItem(item: NavItemDeclaration): Promise<void> {
    // Check if this plugin's nav item already exists
    const existing = await prisma.navItem.findFirst({
      where: { pluginId: this.pluginId, label: item.label },
    });

    if (!existing) {
      // Plugin links always append BELOW everything already in the nav —
      // core links (Home, Articles, Members) stay first and earlier-installed
      // plugins keep their spot (newest last). The declared `item.position`
      // is deliberately not an absolute index; admins reorder in the ACP.
      const maxPos = await prisma.navItem.aggregate({ _max: { position: true } });
      await prisma.navItem.create({
        data: {
          label:       item.label,
          url:         item.url,
          position:    (maxPos._max.position ?? 0) + 1,
          visibility:  item.visibility ?? "public",
          isActive:    true,
          isSystem:    false,
          pluginId:    this.pluginId,
          openInNewTab: false,
        },
      });
    }
    logger.info({ pluginId: this.pluginId, label: item.label }, "Plugin nav item registered");
  }

  registerAcpPage(page: AcpPageDeclaration): void {
    acpPageRegistry.register(this.pluginId, page);
  }

  registerNotificationTypes(types: string[]): void {
    // Stored for future preference UI — no-op for now
    logger.debug({ pluginId: this.pluginId, types }, "Plugin notification types registered");
  }

  registerSearchSource(source: SearchSource): void {
    searchRegistry.register(this.pluginId, source);
    logger.info({ pluginId: this.pluginId, source: source.id }, "Plugin search source registered");
  }

  registerPageSource(source: PageSource): void {
    seoRegistry.registerSource(source, this.pluginId);
  }

  registerSeoProvider(provider: SeoProvider): void {
    seoRegistry.setProvider(provider, this.pluginId);
    logger.info({ pluginId: this.pluginId }, "SEO provider registered");
  }

  registerEmbed(handler: EmbedHandler): void {
    embedRegistry.register(this.pluginId, handler);
  }

  registerContentKind(handler: ContentKindHandler): void {
    contentRegistry.register(this.pluginId, handler);
  }

  registerReportTarget(handler: ReportTargetHandler): void {
    reportTargetRegistry.register(this.pluginId, handler);
    logger.info({ pluginId: this.pluginId, kind: handler.kind }, "Plugin report target registered");
  }

  registerHomeFeedSource(source: HomeFeedSource): void {
    homeFeedRegistry.register(this.pluginId, source);
    logger.info({ pluginId: this.pluginId, source: source.id }, "Plugin home feed source registered");
  }

  registerStatSource(source: StatSource): void {
    statRegistry.register(this.pluginId, source);
    logger.info({ pluginId: this.pluginId, source: source.id }, "Plugin stat source registered");
  }

  registerBadgeCriteria(metric: BadgeCriteria): void {
    badgeCriteriaRegistry.register(this.pluginId, metric);
    logger.info({ pluginId: this.pluginId, metric: metric.key }, "Plugin badge criteria registered");
  }

  registerProgressionCriteria(criteria: ProgressionCriteria): void {
    progressionCriteriaRegistry.register(this.pluginId, criteria);
    logger.info({ pluginId: this.pluginId, criteria: criteria.id }, "Plugin progression criteria registered");
  }

  registerNecCodes(codes: XecCodeDeclaration[]): void {
    necRegistry.register(this.pluginId, codes);
    logger.info({ pluginId: this.pluginId, count: codes.length }, "Plugin XEC codes registered");
  }

  /**
   * A plugin-owned page, opened to the layout editor (ADR-0005 Amendment 3).
   *
   * Ownership is stamped here rather than trusted from the declaration, so a plugin
   * cannot register a template under another plugin's id and survive its disable. A
   * declaration that names a DIFFERENT owner is refused outright — that is either a
   * copy-paste error or an attempt at exactly that, and neither should enable.
   *
   * `registerTemplate` throws on anything it will not accept (a core key, another
   * plugin's key, a malformed default document). The throw propagates through
   * `callPluginHook`, which records it as a load error and leaves the plugin
   * disabled — the right outcome, since the alternative is a plugin whose pages are
   * registered and whose templates are not.
   */
  registerLayoutTemplate(template: LayoutTemplateDeclaration): void {
    if (template.pluginId && template.pluginId !== this.pluginId) {
      throw new Error(
        `Plugin "${this.pluginId}" cannot register template "${template.key}" for "${template.pluginId}".`,
      );
    }
    registerTemplate({
      key:             template.key,
      label:           template.label,
      regions:         template.regions,
      defaultDocument: template.defaultDocument as never,
      requiredBlocks:  template.requiredBlocks,
      previewRoute:    template.previewRoute,
      pluginId:        this.pluginId,
    });
    logger.info({ pluginId: this.pluginId, template: template.key }, "Plugin layout template registered");
  }

  registerSecurityScan(fn: () => Promise<void>): void {
    securityScanRegistry.register(this.pluginId, fn);
    logger.info({ pluginId: this.pluginId }, "Plugin security scan registered");
  }

  registerAuthGuard(guard: AuthGuard): void {
    authGuardRegistry.register(this.pluginId, guard);
    logger.info({ pluginId: this.pluginId, guard: guard.id }, "Plugin auth guard registered");
  }

  claimSecurityPatterns(patterns: string[]): void {
    securityScanRegistry.claimPatterns(this.pluginId, patterns);
    logger.info({ pluginId: this.pluginId, patterns }, "Plugin claimed core security patterns");
  }

  on(event: string, listener: (payload: never, meta: never) => void | Promise<void>): void {
    addListener(this.pluginId, event, listener);
  }

  filter(name: string, handler: (input: never) => unknown): void {
    addFilter(this.pluginId, name as "profile.extra", handler as never);
  }

  /** A plugin announces only under its own id, so it can never pose as core or another plugin. */
  emit(event: string, payload: unknown): void {
    if (!event.startsWith(`${this.pluginId}.`)) {
      throw new Error(`Plugin "${this.pluginId}" can only emit events named "${this.pluginId}.…", not "${event}".`);
    }
    emitAny(event, payload);
  }

  async notify(opts: NotifyOptions): Promise<void> {
    const { notificationService } = await import("../../modules/notifications/notification.service.js");
    await notificationService.dispatch({
      userId:   opts.userId,
      type:     opts.type,
      title:    opts.title,
      body:     opts.body,
      link:     opts.link,
      channels: opts.channels,
      i18n:     opts.i18n,
    });
  }
}

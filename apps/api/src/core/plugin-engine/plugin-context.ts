import type { Router } from "express";
import type { PluginContext, PluginHost, PermissionDeclaration, NavItemDeclaration, AcpPageDeclaration, SearchSource, HomeFeedSource, StatSource, ProgressionCriteria, NotifyOptions, PluginRouter, NecCodeDeclaration, LayoutTemplateDeclaration, BadgeCriteria
} from "@nodevo/plugin-sdk";
import { registerTemplate } from "@nodevo/contracts";
import { progressionCriteriaRegistry } from "../progression-registry/progression-criteria-registry.js";
import { badgeCriteriaRegistry } from "../badge-registry/badge-criteria-registry.js";
import { prisma } from "../../infrastructure/db.js";
import { pluginRouter } from "./plugin-router.js";
import { acpPageRegistry } from "./acp-page-registry.js";
import { securityScanRegistry } from "../security/security-scan-registry.js";
import { authGuardRegistry, type AuthGuard } from "../auth-guard-registry/auth-guard-registry.js";
import { searchRegistry } from "../search-registry/search-registry.js";
import { homeFeedRegistry } from "../home-feed-registry/home-feed-registry.js";
import { statRegistry } from "../stat-registry/stat-registry.js";
import { necRegistry } from "../nec-registry/nec-registry.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { queues } from "../../infrastructure/queue.js";
import { env } from "../../config/env.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { optionalAuth } from "../../shared/middleware/optionalAuth.js";
import { getEffectiveProgressionGroupId } from "../../shared/middleware/contentLimits.js";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { sanitizeRichText } from "../../shared/sanitize/richText.js";
import { resolveCronPattern, previewRuns } from "../../jobs/scheduledJobs.js";

/** Host services injected into every plugin's onEnable/onDisable context. */
const host: PluginHost = {
  prisma,
  queues,
  env,
  logger,
  errors:     { NodevoError, NEC },
  middleware: {
    requireAuth,
    optionalAuth,
    // Wrap so plugins can pass any permission-key string (core type is a strict union).
    requirePermission: (key: string) => requirePermission(key as never),
  },
  progression: { getEffectiveGroupId: getEffectiveProgressionGroupId },
  utils:      { resolveAvatar, sanitizeRichText, cron: { resolveCron: resolveCronPattern, previewRuns } },
  notificationService: {
    // Lazy import avoids a top-level circular dependency with the engine.
    dispatch: async (opts: any) => {
      const { notificationService } = await import("../../modules/notifications/notification.service.js");
      await notificationService.dispatch(opts);
    },
  },
  security: {
    createCase: async (opts: any) => {
      const { createModerationCase } = await import("../../modules/moderation/moderationCase.service.js");
      await createModerationCase(opts);
    },
    autoBanMultiaccounts: async (userIds: string[], reason: string) => {
      const { moderationService } = await import("../../modules/moderation/moderation.service.js");
      return moderationService.autoBanMultiaccounts(userIds, reason);
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
      await prisma.permission.upsert({
        where:  { key: perm.key },
        update: { label: perm.label },
        create: { key: perm.key, label: perm.label },
      });

      // Apply defaults to groups (only on first install — don't re-apply if already set)
      for (const groupKey of perm.defaults ?? []) {
        const group = await prisma.group.findUnique({ where: { key: groupKey } });
        if (!group) continue;
        const permission = await prisma.permission.findUnique({ where: { key: perm.key } });
        if (!permission) continue;
        await prisma.groupPermission.upsert({
          where:  { groupId_permissionId: { groupId: group.id, permissionId: permission.id } },
          update: {},
          create: { groupId: group.id, permissionId: permission.id },
        });
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

  registerNecCodes(codes: NecCodeDeclaration[]): void {
    necRegistry.register(this.pluginId, codes);
    logger.info({ pluginId: this.pluginId, count: codes.length }, "Plugin NEC codes registered");
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

  async notify(opts: NotifyOptions): Promise<void> {
    const { notificationService } = await import("../../modules/notifications/notification.service.js");
    await notificationService.dispatch({
      userId:   opts.userId,
      type:     opts.type,
      title:    opts.title,
      body:     opts.body,
      link:     opts.link,
      channels: opts.channels,
    });
  }
}

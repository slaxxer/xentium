import type { Router } from "express";
import type { PluginContext, PluginHost, PermissionDeclaration, NavItemDeclaration, AcpPageDeclaration, SearchSource, HomeFeedSource, NotifyOptions, PluginRouter, NecCodeDeclaration } from "@nodevo/plugin-sdk";
import { prisma } from "../../infrastructure/db.js";
import { pluginRouter } from "./plugin-router.js";
import { acpPageRegistry } from "./acp-page-registry.js";
import { searchRegistry } from "../search-registry/search-registry.js";
import { homeFeedRegistry } from "../home-feed-registry/home-feed-registry.js";
import { necRegistry } from "../nec-registry/nec-registry.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { queues } from "../../infrastructure/queue.js";
import { env } from "../../config/env.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { optionalAuth } from "../../shared/middleware/optionalAuth.js";
import { enforcePostLength } from "../../shared/middleware/contentLimits.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";

/** Host services injected into every plugin's onEnable/onDisable context. */
const host: PluginHost = {
  prisma,
  queues,
  env,
  logger,
  errors:     { NodevoError, NEC },
  middleware: { requireAuth, optionalAuth, enforcePostLength },
  utils:      { resolveAvatar },
  notificationService: {
    // Lazy import avoids a top-level circular dependency with the engine.
    dispatch: async (opts: any) => {
      const { notificationService } = await import("../../modules/notifications/notification.service.js");
      await notificationService.dispatch(opts);
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
      const maxPos = await prisma.navItem.aggregate({ _max: { position: true } });
      await prisma.navItem.create({
        data: {
          label:       item.label,
          url:         item.url,
          position:    item.position ?? (maxPos._max.position ?? 0) + 1,
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

  registerNecCodes(codes: NecCodeDeclaration[]): void {
    necRegistry.register(this.pluginId, codes);
    logger.info({ pluginId: this.pluginId, count: codes.length }, "Plugin NEC codes registered");
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

import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { CorePermissions } from "@xentium/contracts";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { describeSettings, publicSettings, writeSettings } from "../../core/plugin-platform/settings.js";

/**
 * Add-on settings (ADR-0011). Admins read the schema and values the generated ACP
 * page is drawn from, and save; anyone reads the keys a plugin marked public, for
 * its own pages. A plugin that is disabled has no registered settings, so both 404.
 */
const params = z.object({ pluginId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i) });
const body = z.record(z.string(), z.unknown());

export const addonsPublicRouter: Router = Router();
addonsPublicRouter.get("/:pluginId/settings", (async (req, res) => {
  const { pluginId } = params.parse(req.params);
  res.json(await publicSettings(pluginId));
}) as RequestHandler);

export const addonsAdminRouter: Router = Router();
const guard = requirePermission(CorePermissions.ADMIN_ACCESS);
addonsAdminRouter.get("/:pluginId/settings", guard, (async (req, res) => {
  const { pluginId } = params.parse(req.params);
  res.json(await describeSettings(pluginId));
}) as RequestHandler);
addonsAdminRouter.put("/:pluginId/settings", guard, (async (req, res) => {
  const { pluginId } = params.parse(req.params);
  res.json({ values: await writeSettings(pluginId, body.parse(req.body)) });
}) as RequestHandler);

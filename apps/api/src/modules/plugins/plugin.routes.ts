import { Router, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { makeRateLimiter } from "../../shared/middleware/rateLimit.js";
import { CorePermissions } from "@nodevo/contracts";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { NEC } from "../../shared/errors/nec.js";
import { getFreshSetting } from "../../shared/utils/settings.js";
import { pluginService } from "./plugin.service.js";

export const pluginManagementRouter: Router = Router();

const isDev         = process.env.NODE_ENV !== "production";
const adminGuard    = requirePermission(CorePermissions.ADMIN_PLUGINS);
const uploadLimiter  = makeRateLimiter("plugin-upload", 60 * 60_000, isDev ? 1000 : 20); // §26: 20/hr
const upload       = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Manual .nvplugin uploads are OFF by default: the marketplace is the sanctioned
// install channel. An admin can enable them (ACP → Extensions → Installed). Read
// fresh so toggling takes effect immediately. Marketplace installs are never gated.
const uploadGuard: RequestHandler = (_req, _res, next) => {
  getFreshSetting<boolean>("plugins.allow_upload", false)
    .then((allowed) => {
      if (allowed === true) return next();
      next(new XentiumError({
        code:       NEC.PLUGIN_UPLOAD_DISABLED,
        httpStatus: 403,
        message:    "Manual plugin uploads are disabled. Install plugins from the marketplace, or enable uploads in ACP → Extensions → Installed.",
      }));
    })
    .catch(next);
};

// List installed plugins
pluginManagementRouter.get("/", requireAuth, adminGuard, async (_req, res, next) => {
  try {
    res.json(await pluginService.list());
  } catch (err) { next(err); }
});

// Validate a package (dry run — no install)
pluginManagementRouter.post("/validate", requireAuth, adminGuard, uploadGuard, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const result = await pluginService.validateOnly(req.file.buffer);
    res.json(result);
  } catch (err: any) {
    if (err?.message) return res.status(400).json({ message: err.message });
    next(err);
  }
});

// Upload and install
pluginManagementRouter.post("/upload", requireAuth, adminGuard, uploadGuard, uploadLimiter, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const manifest = await pluginService.install(req.file.buffer, req.userId!);

    // Refresh the authoritative paid-id set, then correct the stored licenseRequired
    // if this id is a paid marketplace product uploaded with a "free" manifest — so
    // the Installed badge is honest and the enable gate (which is by-id anyway) agrees.
    const { marketplaceSource } = await import("../../core/license-engine/marketplace-source.js");
    await marketplaceSource.refreshPaidPluginIds().catch(() => {});
    const { pluginRequiresLicense } = await import("../../core/license-engine/license-engine.js");
    if (await pluginRequiresLicense(manifest.id)) {
      const { prisma } = await import("../../infrastructure/db.js");
      await prisma.installedPlugin.update({ where: { id: manifest.id }, data: { licenseRequired: true } }).catch(() => {});
    }

    // Refresh the update cache so an uploaded older build surfaces its available
    // update right away (best-effort; the admin sees it on their next ACP entry).
    const { processUpdateCheck } = await import("../../jobs/updateCheck.js");
    void processUpdateCheck().catch(() => {});
    res.status(201).json({ id: manifest.id, name: manifest.name, version: manifest.version });
  } catch (err: any) {
    if (err?.message) return res.status(400).json({ message: err.message });
    next(err);
  }
});

// Enable
pluginManagementRouter.post("/:id/enable", requireAuth, adminGuard, async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await pluginService.enable(id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Disable
pluginManagementRouter.post("/:id/disable", requireAuth, adminGuard, async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await pluginService.disable(id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Uninstall
pluginManagementRouter.delete("/:id", requireAuth, adminGuard, async (req, res, next) => {
  try {
    const { id }         = z.object({ id: z.string() }).parse(req.params);
    const { removeData } = z.object({ removeData: z.coerce.boolean().default(false) }).parse(req.query);
    await pluginService.uninstall(id, removeData);
    res.status(204).end();
  } catch (err) { next(err); }
});

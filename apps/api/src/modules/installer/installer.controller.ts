import type { RequestHandler } from "express";
import { ZodError } from "zod";
import { installerService } from "./installer.service.js";
import { databaseConfigSchema, siteConfigSchema, adminAccountSchema } from "./installer.validation.js";
import { installAddonSelectionSchema, installAddonInstallSchema } from "@xentium/contracts";
import { getRequestMeta } from "../../shared/http/requestMeta.js";
import { setRefreshCookie } from "../../shared/http/cookies.js";
/**
 * The installer answers with a FLAT `{ error: "message" }`, not the canonical
 * NEC envelope — it is the one surface that predates it and the wizard reads
 * the string directly (see the friendly-message map in InstallerWizard).
 *
 * `httpStatus` is read alongside `status` so a XentiumError thrown by the
 * marketplace path (the add-ons step reaches license-engine) keeps its real
 * status instead of collapsing to 500.
 */
const wrap =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((e) => {
      const status = e instanceof ZodError ? 400 : (e as any).status ?? (e as any).httpStatus ?? 500;
      res.status(status).json({ error: (e as Error).message ?? "install_error" });
    });

export const installerController = {
  status: wrap(async (_req, res) => res.json(await installerService.status())),
  environment: wrap(async (_req, res) => res.json(await installerService.environment())),
  testDatabase: wrap(async (_req, res) => res.json(await installerService.testDatabase())),
  database: wrap(async (req, res) => {
    databaseConfigSchema.parse(req.body ?? {});
    res.json(await installerService.configureDatabase());
  }),
  site: wrap(async (req, res) =>
    res.json(await installerService.configureSite(siteConfigSchema.parse(req.body))),
  ),
  admin: wrap(async (req, res) => {
    const meta = getRequestMeta(req, res);
    const result = await installerService.createAdmin(adminAccountSchema.parse(req.body), meta);
    setRefreshCookie(res, result.refreshToken);
    res.json({ currentStep: result.currentStep, accessToken: result.accessToken });
  }),
  // ── Add-ons ───────────────────────────────────────────────────────────────
  addons: wrap(async (_req, res) => res.json(await installerService.addons())),
  selectAddons: wrap(async (req, res) =>
    res.json(await installerService.selectAddons(installAddonSelectionSchema.parse(req.body))),
  ),
  // The one installer route behind requireAuth: it downloads a licensed artifact
  // and attributes the install to a user, and by this point the administrator
  // exists — the ADMIN step handed the wizard an access token for exactly this.
  installAddon: wrap(async (req, res) => {
    const { pluginId, version } = installAddonInstallSchema.parse(req.body);
    res.json(await installerService.installAddon(pluginId, version, req.userId!));
  }),

  // ── Marketplace link ──────────────────────────────────────────────────────
  startMarketplaceLink: wrap(async (_req, res) =>
    res.status(201).json(await installerService.startMarketplaceLink()),
  ),
  pollMarketplaceLink: wrap(async (req, res) =>
    res.json(await installerService.pollMarketplaceLink(String(req.params.linkId))),
  ),
  unlinkMarketplace: wrap(async (_req, res) => res.json(await installerService.unlinkMarketplace())),

  finalize: wrap(async (_req, res) => res.json(await installerService.finalize())),
} satisfies Record<string, RequestHandler>;

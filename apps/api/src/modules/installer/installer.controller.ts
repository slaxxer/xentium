import type { RequestHandler } from "express";
import { installerService } from "./installer.service.js";
import { databaseConfigSchema, siteConfigSchema, adminAccountSchema } from "./installer.validation.js";
import { getRequestMeta } from "../../shared/http/requestMeta.js";
import { setRefreshCookie } from "../../shared/http/cookies.js";
const wrap =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((e) => {
      const status = (e as any).status ?? 500;
      res.status(status).json({ error: (e as Error).message ?? "install_error" });
    });

export const installerController = {
  status: wrap(async (_req, res) => res.json(await installerService.status())),
  environment: wrap(async (_req, res) => res.json(await installerService.environment())),
  testDatabase: wrap(async (_req, res) => res.json(await installerService.testDatabase())),
  database: wrap(async (req, res) => {
    const { databaseUrl } = databaseConfigSchema.parse(req.body);
    res.json(await installerService.configureDatabase(databaseUrl));
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
  finalize: wrap(async (_req, res) => res.json(await installerService.finalize())),
} satisfies Record<string, RequestHandler>;

import { Router, type Express } from "express";
import { pluginRegistry } from "./registry.js";

export class PluginRouter {
  private routers = new Map<string, Router>();

  /** Mount the plugin runtime middleware onto the Express app (call once at startup). */
  mount(app: Express): void {
    app.use("/api/p", (req, res, next) => {
      // Expect routes of the form /api/p/:pluginId/...
      const pluginId = req.path.split("/")[1];
      if (!pluginId) return next();

      const router = this.routers.get(pluginId);
      if (!router) return next();

      // Strip the /:pluginId prefix before handing to the plugin's router
      req.url = req.url.replace(`/${pluginId}`, "") || "/";
      router(req, res, next);
    });
  }

  /** Register a plugin's router. The guard middleware is injected automatically. */
  register(pluginId: string, router: Router): void {
    const guarded = Router();

    // Injected guard — returns 404 if plugin is not currently enabled
    guarded.use((_req, res, next) => {
      if (!pluginRegistry.isEnabled(pluginId)) {
        return res.status(404).json({ code: "NEC-PLUGIN-2020", message: "Plugin not available" });
      }
      next();
    });

    guarded.use(router);
    this.routers.set(pluginId, guarded);
  }

  deregister(pluginId: string): void {
    this.routers.delete(pluginId);
  }
}

export const pluginRouter = new PluginRouter();

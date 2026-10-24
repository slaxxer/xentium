import { Router, type Express } from "express";
import { pluginRegistry } from "./registry.js";

export class PluginRouter {
  /** The composed, guarded router per plugin, rebuilt when a slot changes. */
  private routers = new Map<string, Router>();
  /**
   * A plugin's routers by slot: `"routes"` (its own, `ctx.registerRoutes`) and any
   * the host serves on its behalf (an application's generated endpoints). The
   * plugin's own come first, so it can answer a path itself before the host does.
   */
  private slots = new Map<string, Map<string, Router>>();

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

  /**
   * Register a plugin's router in a slot (default: its own routes; registering the
   * same slot again replaces it). The guard middleware is injected automatically.
   */
  register(pluginId: string, router: Router, slot = "routes"): void {
    const mine = this.slots.get(pluginId) ?? new Map<string, Router>();
    mine.set(slot, router);
    this.slots.set(pluginId, mine);
    this.rebuild(pluginId);
  }

  private rebuild(pluginId: string): void {
    const mine = this.slots.get(pluginId);
    if (!mine?.size) { this.routers.delete(pluginId); return; }
    const guarded = Router();

    // Injected guard — returns 404 if plugin is not currently enabled
    guarded.use((_req, res, next) => {
      if (!pluginRegistry.isEnabled(pluginId)) {
        return res.status(404).json({ code: "XEC-PLUGIN-2020", message: "Plugin not available" });
      }
      next();
    });

    const ordered = [...mine.entries()].sort(([a], [b]) => (a === "routes" ? -1 : b === "routes" ? 1 : 0));
    for (const [, router] of ordered) guarded.use(router);
    this.routers.set(pluginId, guarded);
  }

  deregister(pluginId: string): void {
    this.slots.delete(pluginId);
    this.routers.delete(pluginId);
  }
}

export const pluginRouter = new PluginRouter();

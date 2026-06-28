import { logger } from "../../infrastructure/logging/logger.js";

/** Periodic security scans contributed by plugins. The core security-analysis
 *  job (every 30 min, §15) runs its built-in patterns and then invokes every
 *  registered plugin scan — so a plugin (e.g. advanced-moderation's impossible
 *  travel) reuses the core cadence instead of scheduling its own job. Each scan
 *  is isolated: a throw is logged and never aborts the others or the core job. */
type SecurityScanFn = () => Promise<void>;

class SecurityScanRegistry {
  private scans = new Map<string, SecurityScanFn[]>();

  register(pluginId: string, fn: SecurityScanFn): void {
    const list = this.scans.get(pluginId) ?? [];
    list.push(fn);
    this.scans.set(pluginId, list);
  }
  deregister(pluginId: string): void { this.scans.delete(pluginId); }

  async runAll(): Promise<void> {
    for (const [pluginId, fns] of this.scans) {
      for (const fn of fns) {
        try {
          await fn();
        } catch (err) {
          logger.warn({ pluginId, err }, "Plugin security scan failed");
        }
      }
    }
  }
}

export const securityScanRegistry = new SecurityScanRegistry();

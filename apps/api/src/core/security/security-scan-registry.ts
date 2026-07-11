import { logger } from "../../infrastructure/logging/logger.js";

/** Periodic security scans + pattern claims. The core security-analysis job
 *  (every 30 min, §15) first runs the built-in baseline patterns (patterns.ts),
 *  skipping any pattern a plugin has CLAIMED via ctx.claimSecurityPatterns —
 *  the plugin ships an enhanced replacement and registers it as a scan. Claims
 *  are released on plugin disable, so the free baseline auto-restores. Each scan
 *  is isolated: a throw is logged and never aborts the others or the core job. */
type SecurityScanFn = () => Promise<void>;

class SecurityScanRegistry {
  private scans  = new Map<string, SecurityScanFn[]>();
  private claims = new Map<string, Set<string>>();

  register(pluginId: string, fn: SecurityScanFn): void {
    const list = this.scans.get(pluginId) ?? [];
    list.push(fn);
    this.scans.set(pluginId, list);
  }

  /** A plugin declares it replaces these core baseline patterns (§15 types). */
  claimPatterns(pluginId: string, patterns: string[]): void {
    const set = this.claims.get(pluginId) ?? new Set<string>();
    for (const p of patterns) set.add(p);
    this.claims.set(pluginId, set);
  }

  /** True when any enabled plugin has claimed this baseline pattern. */
  isClaimed(pattern: string): boolean {
    for (const set of this.claims.values()) if (set.has(pattern)) return true;
    return false;
  }

  deregister(pluginId: string): void {
    this.scans.delete(pluginId);
    this.claims.delete(pluginId);
  }

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

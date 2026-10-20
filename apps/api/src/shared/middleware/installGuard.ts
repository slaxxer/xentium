import type { RequestHandler } from "express";
import { prisma } from "../../infrastructure/db.js";
import { isDev } from "../../config/env.js";

let installedCache: boolean | null = null;

/** Called by the finalize step to flip the cache without a restart. */
export function markInstalled(): void {
  installedCache = true;
}

export function __resetInstalledCache(): void {
  installedCache = null;
}

async function isInstalled(): Promise<boolean> {
  // In development, skip the in-memory cache so a DB reset takes effect immediately.
  if (!isDev && installedCache !== null) return installedCache;
  try {
    const row = await prisma.install.findUnique({ where: { singleton: true }, select: { completedAt: true } });
    installedCache = !!row?.completedAt;
  } catch {
    // DB unavailable (schema not migrated yet, or busy during migrate deploy).
    // Don't cache false — leave installedCache unchanged so the next request retries.
    // Treat as "not installed" for this request only so installer routes still pass through.
    return false;
  }
  return installedCache;
}

const ALWAYS_OPEN = [
  /^\/api\/health/,
  /^\/api\/install(\/|$)/,
];
// status is a read-only probe used by InstallGate — must stay accessible even after install
const STATUS_ALWAYS_OPEN = /^\/api\/install\/status(\/|$)/;

export const installGuard: RequestHandler = async (req, res, next) => {
  // Status probe is never blocked — the frontend relies on it to determine install state
  if (STATUS_ALWAYS_OPEN.test(req.path)) return next();

  const installed = await isInstalled();
  const isInstallerRoute = /^\/api\/install(\/|$)/.test(req.path);

  if (installed) {
    // Self-removal: installer is gone once the instance is live.
    if (isInstallerRoute) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(410).json({ error: "install_disabled" });
    }
    return next();
  }

  // Not installed: only health + installer routes are reachable.
  if (ALWAYS_OPEN.some((re) => re.test(req.path))) return next();
  return res.status(503).json({ error: "not_installed" });
};

import { createApp } from './app/app.js';
import { prisma } from './infrastructure/db.js';
import { registerCorePermissions } from './bootstrap/registerCorePermissions.js';
import { bootstrapOfficialPlugins } from './bootstrap/bootstrapOfficialPlugins.js';
import { initializeEnabledPlugins } from './core/plugin-engine/plugin-engine.js';
import { adminService } from './modules/admin/admin.service.js';
import { env } from './config/env.js';

/**
 * Whether this instance has completed the install wizard. Mirrors the probe
 * in installGuard.ts: a missing/unmigrated table reads as "not installed".
 */
async function isInstalled(): Promise<boolean> {
  try {
    const row = await prisma.install.findFirst({ select: { completedAt: true } });
    return !!row?.completedAt;
  } catch {
    return false;
  }
}

/**
 * Full application boot. Only imported once env is complete (server.ts gate) —
 * all module-load-time validation (env schema, prisma, auth secrets) runs on
 * first evaluation of this module graph.
 */
export async function boot() {
  if (await isInstalled()) {
    await registerCorePermissions();
    await adminService.ensureMembersNavItem().catch(() => { /* install not finished yet */ });
    await bootstrapOfficialPlugins();
    await initializeEnabledPlugins();
  } else {
    // Fresh instance: the DB may not even be migrated yet, so the bootstrap
    // calls above would crash. seedCore re-runs them during the installer's
    // configureDatabase step.
    console.log('Not installed yet — skipping bootstrap, waiting for the install wizard');
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log(`API running on :${env.PORT} (${env.NODE_ENV})`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

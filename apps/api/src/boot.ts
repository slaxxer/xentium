import { createApp } from './app/app.js';
import { prisma } from './infrastructure/db.js';
import { registerCorePermissions } from './bootstrap/registerCorePermissions.js';
import { logger } from "./infrastructure/logging/logger.js";
import { migrateGuestHeroToLayout } from "./modules/layouts/guestHeroMigration.js";
import { migrateRegionConsolidation } from "./modules/layouts/regionConsolidationMigration.js";
import { seedDefaultNavItems } from './bootstrap/seedDefaultNavItems.js';
import { bootstrapOfficialPlugins } from './bootstrap/bootstrapOfficialPlugins.js';
import { initializeEnabledPlugins } from './core/plugin-engine/plugin-engine.js';
import { initAppearanceSse, closeAppearanceSse } from './modules/appearance/appearance.sse.js';
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
    // Legacy installs may predate newer core nav links — idempotent re-seed.
    await seedDefaultNavItems().catch(() => { /* table not migrated yet */ });
    // One-time: carry a customised Guest Home hero into the home layout document, now
    // that those settings are block props. Flag-guarded, so a restart is a no-op; a
    // failure must not stop the server booting, so it is caught and logged.
    await migrateGuestHeroToLayout().catch((err: unknown) => {
      logger.error({ err }, "Guest Home hero carry-over failed — hero text may need re-entering in the Layout Editor");
    });
    // One-time: carry stored layouts onto the four-landmark region set. Without it a
    // site that had saved a layout keeps its navbar and footer blocks in the document
    // and stops RENDERING them — an unknown region is skipped by design, so the loss
    // is silent. Same guarantees as the carry-over above.
    await migrateRegionConsolidation().catch((err: unknown) => {
      logger.error({ err }, "Layout region carry-over failed — the header or footer may render empty until it is re-run");
    });
    await bootstrapOfficialPlugins();
    await initializeEnabledPlugins();
  } else {
    // Fresh instance: the DB may not even be migrated yet, so the bootstrap
    // calls above would crash. seedCore re-runs them during the installer's
    // configureDatabase step.
    console.log('Not installed yet — skipping bootstrap, waiting for the install wizard');
  }

  const app = createApp();

  // Live style sync: subscribe to the cross-process appearance channel so theme
  // changes made on any instance push to this instance's SSE clients.
  initAppearanceSse();

  const server = app.listen(env.PORT, () => {
    console.log(`API running on :${env.PORT} (${env.NODE_ENV})`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    // End open SSE streams first — otherwise their long-lived connections keep
    // server.close() from ever completing.
    await closeAppearanceSse();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

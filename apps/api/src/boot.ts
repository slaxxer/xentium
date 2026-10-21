import { createApp } from './app/app.js';
import { prisma } from './infrastructure/db.js';
import { registerCorePermissions } from './bootstrap/registerCorePermissions.js';
import { registerCoreBadgeMetrics } from './core/badge-registry/badge-criteria-registry.js';
import { logger } from "./infrastructure/logging/logger.js";
import { migrateGuestHeroToLayout } from "./modules/layouts/guestHeroMigration.js";
import { migrateRegionConsolidation } from "./modules/layouts/regionConsolidationMigration.js";
import { migrateHeaderBandBlocks } from "./modules/layouts/headerBandMigration.js";
import { migratePageBandsIntoBody } from "./modules/layouts/pageBandMigration.js";
import { migrateFooterBandBlocks } from "./modules/layouts/footerBandMigration.js";
import { migrateEdgeSeasonsToPlugin } from "./modules/layouts/edgeSeasonMigration.js";
import { migrateToPerThemeAppearance } from "./modules/themes/perThemeMigration.js";
import { migrateComposedChrome } from "./modules/layouts/composedChromeMigration.js";
import { ensureBundledThemes } from "./modules/themes/bundledThemes.js";
import { ensureDefaultEmojis } from "./modules/emojis/defaultEmojis.js";
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
    const row = await prisma.install.findUnique({ where: { singleton: true }, select: { completedAt: true } });
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
    // ⚠ BEFORE plugins boot: a plugin registers its own badge metrics in `onEnable`,
    // and core's four must already be there or the first sweep measures nothing.
    registerCoreBadgeMetrics();
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
    // One-time: a masthead built out of a full-width `section` becomes the `header`
    // block, so a site that already has one gets the header's own settings rather
    // than only new installs. Renders identically either way — same gradient, same
    // height — so a failure here is cosmetic, not structural.
    await migrateHeaderBandBlocks().catch((err: unknown) => {
      logger.error({ err }, "Masthead carry-over failed — the header still renders, as a section");
    });
    // One-time: a page's own `header`/`footer` bands fold into its body. They are
    // gone from the region set, and an undeclared region is KEPT and skipped — so a
    // site that had put something in one would stop rendering it, silently.
    await migratePageBandsIntoBody().catch((err: unknown) => {
      logger.error({ err }, "Page band carry-over failed — blocks above or below a page body may not render until it is re-run");
    });
    // One-time: a stored footer's loose pieces move INSIDE the `footer` block, which
    // is what paints the band now that `SiteFooter` no longer wraps them in one. A
    // failure leaves the pieces rendering unpainted, so it is cosmetic — but it is
    // also the only thing that gives an existing site the footer's own settings.
    await migrateFooterBandBlocks().catch((err: unknown) => {
      logger.error({ err }, "Footer carry-over failed — the footer renders without its band until it is re-run");
    });
    // One-time: the composed header (masthead holding the logo and the account
    // buttons) and the split footer (links + text). Cosmetic if it fails: the old
    // shapes still render.
    await migrateComposedChrome().catch((err: unknown) => {
      logger.error({ err }, "Composed header/footer carry-over failed — the header and footer keep their old shape");
    });
    // One-time: the single appearance layer becomes the ACTIVE theme's own, now that
    // every theme is edited on its own. After the layout carry-overs above, so it
    // moves documents already in their current shape.
    await migrateToPerThemeAppearance().catch((err: unknown) => {
      logger.error({ err }, "Per-theme appearance carry-over failed — the site keeps its look, but edits may sit under Core until it is re-run");
    });
    // One-time: an edge's "only in season" dates move to the `fx` edge namespace;
    // core draws its edge art all year. Cosmetic if it fails: seasonal art shows
    // year-round until the template is saved.
    await migrateEdgeSeasonsToPlugin().catch((err: unknown) => {
      logger.error({ err }, "Edge season carry-over failed — seasonal edge art shows all year until it is re-run");
    });
    // Themes every install ships with (Xentium Dark), added once and never switched to.
    await ensureBundledThemes().catch((err: unknown) => {
      logger.error({ err }, "Bundled theme setup failed — Xentium Dark is not offered until it is re-run");
    });
    // The default smileys, added once; after that the admin owns them.
    await ensureDefaultEmojis().catch((err: unknown) => {
      logger.error({ err }, "Default emoji setup failed — the picker starts empty until it is re-run");
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

import { Worker } from "bullmq";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";
import { publishTheme } from "../modules/themes/themeStudio.js";
import { logger } from "../infrastructure/logging/logger.js";
import { prisma } from "../infrastructure/db.js";
import { CORE_THEME } from "../modules/themes/themeKey.js";

/**
 * Publishes every theme's staged changes — its layouts AND its styles, together, the
 * way Theme Studio's Publish does. Each theme is edited on its own, so each may have
 * a draft waiting. Runs on the
 * admin-configured schedule (ACP → System → Scheduled Tasks, disabled by default)
 * and on demand via that page's "Run now". A no-op when nothing is pending.
 */
export function startAppearancePublishWorker() {
  return new Worker(
    "appearance-publish",
    async () => {
      const themes = await prisma.theme.findMany({ select: { id: true } });
      const published: string[] = [];
      for (const key of [CORE_THEME, ...themes.map((t) => t.id)]) {
        const done = await publishTheme(undefined, key, "Published theme changes (scheduled)");
        if (done.styles || done.layouts.length) published.push(key || "core");
      }
      logger.info({ published }, published.length ? "theme drafts published" : "theme publish: nothing pending");
    },
    { connection: bullConnection, prefix: bullPrefix },
  );
}

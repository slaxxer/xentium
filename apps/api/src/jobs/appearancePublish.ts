import { Worker } from "bullmq";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";
import { appearanceService } from "../modules/appearance/appearance.service.js";
import { logger } from "../infrastructure/logging/logger.js";

/**
 * Publishes any staged (draft) Style Editor changes to the live site. Runs on the
 * admin-configured schedule (ACP → System → Scheduled Tasks, disabled by default)
 * and on demand via that page's "Run now". A no-op when nothing is pending.
 */
export function startAppearancePublishWorker() {
  return new Worker(
    "appearance-publish",
    async () => {
      const published = await appearanceService.publishDraft(undefined, "Published appearance changes (scheduled)");
      logger.info({ published }, published ? "appearance draft published" : "appearance publish: nothing pending");
    },
    { connection: bullConnection, prefix: bullPrefix },
  );
}

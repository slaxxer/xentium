import { Worker } from "bullmq";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";
import { refreshLicense } from "../core/license-engine/license-engine.js";
import { logger } from "../infrastructure/logging/logger.js";

export function startLicenseRefreshWorker() {
  return new Worker(
    "license-refresh",
    async () => {
      logger.info("Running license refresh job");
      await refreshLicense();
    },
    { connection: bullConnection, prefix: bullPrefix },
  );
}

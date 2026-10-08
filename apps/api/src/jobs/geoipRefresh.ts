import { Worker } from "bullmq";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";
import { refreshGeoip } from "../infrastructure/geoip.js";

const QUEUE_NAME = "geoip-refresh";

/** Fetch the month's DB-IP country database (see infrastructure/geoip.ts). */
export async function processGeoipRefresh(): Promise<void> {
  await refreshGeoip();
}

export function startGeoipRefreshWorker() {
  return new Worker(QUEUE_NAME, processGeoipRefresh, {
    connection: bullConnection,
    prefix:     bullPrefix,
  });
}

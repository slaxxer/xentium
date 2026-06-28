/**
 * Security analysis job — §15 cadence shell.
 *
 * Runs every 30 minutes. Core owns the cadence + the cases/exception storage and
 * the review UI; the detection patterns themselves are contributed by plugins
 * (e.g. advanced-moderation) via `registerSecurityScan`. With no plugin enabled,
 * no cases are created — this job is an empty runner.
 */
import { Worker } from "bullmq";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";
import { securityScanRegistry } from "../core/security/security-scan-registry.js";

const QUEUE_NAME = "security-analysis";

export async function processSecurityAnalysis(): Promise<void> {
  await securityScanRegistry.runAll();
}

export function startSecurityAnalysisWorker() {
  return new Worker(QUEUE_NAME, processSecurityAnalysis, {
    connection: bullConnection,
    prefix:     bullPrefix,
  });
}

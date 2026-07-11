/**
 * Security analysis job — §15 cadence.
 *
 * Runs every 30 minutes. Core owns the cadence, the cases/exception storage,
 * the review UI, AND the four baseline detection patterns (patterns.ts).
 * Plugins contribute additional scans via `registerSecurityScan` and may
 * replace individual baseline patterns via `claimSecurityPatterns` (e.g.
 * advanced-moderation's enhanced variants) — claims release on disable.
 */
import { Worker } from "bullmq";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";
import { securityScanRegistry } from "../core/security/security-scan-registry.js";
import { runCorePatterns } from "../core/security/patterns.js";

const QUEUE_NAME = "security-analysis";

export async function processSecurityAnalysis(): Promise<void> {
  await runCorePatterns();
  await securityScanRegistry.runAll();
}

export function startSecurityAnalysisWorker() {
  return new Worker(QUEUE_NAME, processSecurityAnalysis, {
    connection: bullConnection,
    prefix:     bullPrefix,
  });
}

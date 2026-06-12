import { missingRequiredEnv, loadEnvFileIntoProcess } from './config/envProbe.js';

/**
 * Worker boot gate — mirrors server.ts. The worker has no setup UI of its
 * own: while the install wizard hasn't written .env yet it just waits,
 * polling the env probe, so `pnpm dev:apps` doesn't crash-loop on a fresh
 * clone. Once env is complete the actual worker (workerBoot.js) is imported
 * and evaluates with full env — same hot-swap idea, no restart needed.
 */
const POLL_MS = 2000;

async function main() {
  if (missingRequiredEnv().length > 0) {
    console.log('[worker] waiting for installer setup to write .env…');
    while (missingRequiredEnv().length > 0) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    // The probe reads the file; the values still need to land in process.env
    // before the worker's module graph (env.ts, redis, queues) evaluates.
    loadEnvFileIntoProcess();
    console.log('[worker] setup complete — booting');
  }
  await import('./workerBoot.js');
}

main().catch((err) => {
  console.error('[worker] startup failed:', err);
  process.exit(1);
});

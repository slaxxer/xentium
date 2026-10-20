import type { FullConfig } from "@playwright/test";

import { E2E_API_PORT } from "./e2eEnv.mjs";

const API_HEALTH = process.env.E2E_API_HEALTH ?? `http://localhost:${E2E_API_PORT}/api/health`;

/**
 * Playwright waits for the web dev server before running globalSetup,
 * but the API boots concurrently and may lag slightly behind. The web
 * app proxies /api to the API, so we poll the API health endpoint until it
 * responds before any spec touches an install/auth route.
 */
async function globalSetup(_config: FullConfig) {
  const deadline = Date.now() + 60_000;
  let lastErr: unknown;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(API_HEALTH);
      if (res.ok) {
        console.log(`[e2e] API healthy at ${API_HEALTH}`);
        return;
      }
      lastErr = `status ${res.status}`;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }

  throw new Error(`[e2e] API never became healthy at ${API_HEALTH}: ${String(lastErr)}`);
}

export default globalSetup;

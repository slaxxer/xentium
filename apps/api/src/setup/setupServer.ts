import express, { type Express } from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import path from "node:path";
import { setupConfigSchema, InstallStep } from "@xentium/contracts";
import { writeEnvConfig } from "../core/installer-engine/steps/writeConfig.js";
import { nodeRow, type RequirementRow } from "../core/installer-engine/requirementRows.js";
// Safe here: version.ts reads a package.json and validates nothing at load time.
import { XENTIUM_VERSION } from "../config/version.js";

/**
 * Pre-env setup server (§16, WordPress-style first run).
 *
 * Runs ONLY while required env vars are missing — the full app cannot even be
 * imported yet (env.ts would process.exit). Serves just enough installer API
 * for the wizard's WELCOME → ENVIRONMENT → DATABASE steps; the DATABASE step
 * posts credentials here, we verify them with a throwaway pg client, write
 * .env (with generated secrets) via writeEnvConfig, then close this listener
 * and hand the freed port to the real app (onComplete → dynamic-import boot).
 *
 * It also serves the built SPA, because in a production install there is no
 * Vite: the wizard the admin is told to open has to come from this server.
 *
 * Module-graph rule: nothing here may import env.ts, prisma, redis or any
 * other module that validates/connects at load time.
 */

// Everything that is not an API call belongs to the SPA. Express 5 needs a
// RegExp here; the same pattern the full app uses in serveWeb.ts.
const SPA_PATH = /^\/(?!(api|uploads)(\/|$)).*/;

/**
 * Serve the built frontend, the way the full app does minus the per-request SEO
 * meta — that reads settings out of a database this process cannot talk to yet.
 *
 * Resolved exactly like env.ts would: WEB_DIST, else REPO_ROOT/apps/web/dist,
 * where REPO_ROOT defaults to two levels above the working directory. In the
 * npm package that is the package root, so the default simply works.
 */
function mountSetupWeb(app: Express): void {
  const webDist = process.env.WEB_DIST
    ? path.resolve(process.env.WEB_DIST)
    : path.resolve(process.env.REPO_ROOT ?? path.resolve(process.cwd(), "../.."), "apps/web/dist");
  const indexPath = path.join(webDist, "index.html");
  if (!existsSync(indexPath)) return; // dev: Vite owns the frontend

  app.use(express.static(webDist, { index: false }));
  app.get(SPA_PATH, (_req, res) => res.sendFile(indexPath));
}

interface SetupServerOptions {
  /** Called after .env is written and the listener is closed. Boots the app. */
  onComplete: () => Promise<void>;
}

function buildDatabaseUrl(input: {
  host: string; port: number; database: string; user: string; password: string;
}): string {
  const auth = input.password
    ? `${encodeURIComponent(input.user)}:${encodeURIComponent(input.password)}`
    : encodeURIComponent(input.user);
  return `postgresql://${auth}@${input.host}:${input.port}/${encodeURIComponent(input.database)}`;
}

async function liteEnvironmentChecks() {
  const { promises: fs } = await import("node:fs");
  const { ENV_FILE_PATH } = await import("../config/envProbe.js");

  const checks: RequirementRow[] = [nodeRow()];

  // .env writability — the wizard must be able to write the config file.
  try {
    const probe = path.resolve(path.dirname(ENV_FILE_PATH), ".env-write-probe");
    await fs.writeFile(probe, "ok");
    await fs.rm(probe);
    checks.push({
      key: "env_file",
      name: "Configuration file",
      ok: true,
      detail: `Writable: ${ENV_FILE_PATH}`,
    });
  } catch {
    checks.push({
      key: "env_file",
      name: "Configuration file",
      ok: false,
      detail: `${ENV_FILE_PATH} (directory not writable)`,
    });
  }

  // Data dir writability (same default as env.ts — relative to apps/api cwd).
  const dataDir = process.env.DATA_DIR ?? "./data";
  try {
    await fs.mkdir(dataDir, { recursive: true });
    const probe = path.join(dataDir, ".write-probe");
    await fs.writeFile(probe, "ok");
    await fs.rm(probe);
    checks.push({ key: "data_dir", name: "Installation directory", ok: true, detail: `Detected: ${dataDir}` });
  } catch {
    checks.push({ key: "data_dir", name: "Installation directory", ok: false, detail: `${dataDir} (not writable)` });
  }

  return { ok: checks.every((c) => c.ok), checks };
}

export async function startSetupServer(options: SetupServerOptions): Promise<void> {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", setupMode: true, version: XENTIUM_VERSION });
  });

  app.get("/api/install/status", (_req, res) => {
    res.json({
      installed: false,
      setupMode: true,
      currentStep: InstallStep.WELCOME,
      siteId: null,
      version: XENTIUM_VERSION,
    });
  });

  app.get("/api/install/environment", async (_req, res) => {
    res.json(await liteEnvironmentChecks());
  });

  /**
   * Verify credentials WITHOUT writing anything.
   *
   * The DATABASE step probes as you type, and the only other endpoint that can
   * answer "do these work" is the one that writes `.env` and swaps the process
   * — so before this, the wizard could not tell you your password was wrong
   * until after it had committed to it. This is that same connect, minus every
   * side effect.
   *
   * Bounded rather than rate-limited: the wizard debounces, and one probe at a
   * time is the whole budget a single-operator setup screen needs. A pending
   * probe answers 409 instead of opening a second connection.
   */
  let probing = false;
  app.post("/api/install/database/probe", async (req, res) => {
    if (probing) return res.status(409).json({ error: "probe_in_progress" });
    const parsed = setupConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid connection details" });
    }
    const input = parsed.data;
    probing = true;
    const started = Date.now();

    try {
      const { Client } = await import("pg");
      const client = new Client({
        host: input.host,
        port: input.port,
        database: input.database,
        user: input.user,
        password: input.password,
        connectionTimeoutMillis: 5000,
      });
      let postgres: string | null = null;
      try {
        await client.connect();
        const r = await client.query<{ version: string }>("SELECT version()");
        postgres = r.rows[0]?.version.match(/PostgreSQL (\d+\.\d+)/)?.[1] ?? null;
      } finally {
        await client.end().catch(() => { /* already closed */ });
      }

      // A Redis URL is optional, and its absence is not a failure — but a URL
      // that was typed and does not work has to be caught HERE. The setup write
      // pings it too, and finding out there is the failure this endpoint exists
      // to move earlier.
      let redisVersion: string | null = null;
      if (input.redisUrl) {
        const { default: Redis } = await import("ioredis");
        const redis = new Redis(input.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
        });
        try {
          await redis.connect();
          redisVersion = (await redis.info("server")).match(/redis_version:(\S+)/)?.[1] ?? "unknown";
        } finally {
          redis.disconnect();
        }
      }

      return res.json({
        ok: true,
        postgres,
        redis: redisVersion,
        latencyMs: Date.now() - started,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      return res.status(400).json({ error: message });
    } finally {
      probing = false;
    }
  });

  let configuring = false;
  app.post("/api/install/setup", async (req, res) => {
    if (configuring) {
      return res.status(409).json({ error: "setup_in_progress" });
    }
    const parsed = setupConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid setup input", detail: parsed.error.flatten() });
    }
    const input = parsed.data;
    configuring = true;

    try {
      // 1. Verify the credentials with a throwaway client — nothing is
      //    written unless the database is actually reachable.
      const { Client } = await import("pg");
      const client = new Client({
        host: input.host,
        port: input.port,
        database: input.database,
        user: input.user,
        password: input.password,
        connectionTimeoutMillis: 5000,
      });
      try {
        await client.connect();
        await client.query("SELECT 1");
      } finally {
        await client.end().catch(() => { /* already closed */ });
      }

      // Optional Redis ping when a custom URL was supplied.
      if (input.redisUrl) {
        const { default: Redis } = await import("ioredis");
        const redis = new Redis(input.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
        });
        try {
          await redis.connect();
          await redis.ping();
        } finally {
          redis.disconnect();
        }
      }

      // 2. Write .env (generated secrets included) + assign into process.env.
      await writeEnvConfig({
        databaseUrl: buildDatabaseUrl(input),
        redisUrl: input.redisUrl,
      });
    } catch (err) {
      configuring = false;
      const message = err instanceof Error ? err.message : "Connection failed";
      return res.status(400).json({ error: message });
    }

    // 3. Respond first, then swap: close this listener and boot the real app
    //    on the freed port. The wizard polls /install/status until the real
    //    API answers (setupMode no longer true). "Connection: close" makes the
    //    serving socket end after the flush so server.close() never waits on
    //    its keep-alive.
    res.set("Connection", "close");
    res.json({ ok: true });

    setImmediate(() => {
      console.log("Setup config written — swapping to full application boot");
      server.close((err) => {
        if (err) console.error("Setup server close error:", err);
        options.onComplete().catch((bootErr) => {
          console.error("Boot after setup failed:", bootErr);
          process.exit(1);
        });
      });
      // Drop idle keep-alive sockets so close() completes immediately.
      server.closeIdleConnections();
    });
  });

  // Any other API call during setup mode is unambiguous about why it fails.
  app.use("/api", (_req, res) => {
    res.status(503).json({ error: "setup_required", code: "XEC-INSTALL-SETUP" });
  });

  // Last, so the fallback never swallows an API route.
  mountSetupWeb(app);

  const port = Number(process.env.PORT ?? 4000);
  const server = app.listen(port, () => {
    const address = process.env.APP_URL?.replace(/\/+$/, "") ?? `http://localhost:${port}`;
    console.log(`Setup server running on :${port}`);
    console.log(`Finish the install at ${address}/install`);
  });
}

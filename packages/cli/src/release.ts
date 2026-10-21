/**
 * Installing a release, and the things you do around one: migrations, a
 * database backup, a health check.
 *
 * A release is an ordinary npm project whose only dependency is
 * `@xentium/server@<version>`. npm therefore does the download, the integrity
 * check and the dependency tree for us, from the shrinkwrap we published with
 * the package — every server gets the tree we tested.
 *
 * `create-xentium` bundles this file from source so a first install and an
 * update go through exactly the same code.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { run } from "./checks.js";
import type { Site } from "./site.js";

export const SERVER_PACKAGE = "@xentium/server";

export interface SpawnResult { code: number; output: string }

/** Run a command, streaming it to the terminal unless `quiet`, and keep the output. */
export function exec(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; quiet?: boolean; timeout?: number; onData?: (chunk: string) => void } = {},
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let output = "";
    const timer = opts.timeout ? setTimeout(() => child.kill("SIGKILL"), opts.timeout) : null;
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        output += chunk;
        if (!opts.quiet) process.stdout.write(chunk);
        opts.onData?.(chunk);
      });
    }
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, output: `${output}${e.message}` });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
  });
}

/** The newest published version for a dist-tag. */
export async function resolveVersion(spec = "latest"): Promise<string | null> {
  // An exact version needs no lookup, and works offline from a local cache.
  if (/^\d+\.\d+\.\d+/.test(spec)) return spec;
  return run("npm", ["view", `${SERVER_PACKAGE}@${spec}`, "version"], 30_000);
}

/**
 * Install a release into `releases/<version>/`.
 *
 * `spec` is anything npm can install — a version, a dist-tag, or a `file:` path
 * to a packed tarball, which is how an offline install and our own end-to-end
 * tests work. Because a tag or a tarball only reveals its version once it is
 * unpacked, the install happens in a staging directory that is renamed
 * afterwards. Nothing else in the site is touched, so a failed install leaves
 * the running release exactly where it was.
 *
 * Returns the version that was actually installed.
 */
export async function installRelease(
  site: Site,
  spec: string,
  opts: { quiet?: boolean } = {},
): Promise<string> {
  const staging = path.join(site.releasesDir, `.staging-${process.pid}`);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  await fs.writeFile(path.join(staging, "package.json"), `${JSON.stringify({
    name: "xentium-release",
    version: "1.0.0",
    private: true,
    description: "One installed Xentium release. Managed by the xentium CLI.",
    dependencies: { [SERVER_PACKAGE]: spec },
  }, null, 2)}\n`);

  const cleanUp = () => fs.rm(staging, { recursive: true, force: true });
  const result = await exec("npm", [
    "install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel", "error",
  ], { cwd: staging, quiet: opts.quiet });

  if (result.code !== 0) {
    await cleanUp();
    throw new Error(`npm could not install ${SERVER_PACKAGE}@${spec}:\n${result.output.trim().slice(-2000)}`);
  }

  const appDir = path.join(staging, "node_modules", "@xentium", "server");
  let version: string;
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(appDir, "package.json"), "utf8")) as { version?: string };
    if (!pkg.version) throw new Error("no version");
    version = pkg.version;
    await fs.access(path.join(appDir, "apps", "api", "dist", "server.js"));
  } catch (e) {
    await cleanUp();
    throw new Error(`${SERVER_PACKAGE} installed from "${spec}" is not a usable release: ${(e as Error).message}`);
  }

  // Reinstalling a version that is already there replaces it, so a half-finished
  // install from a previous run never becomes the release we boot.
  const dir = site.releaseDir(version);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rename(staging, dir);
  return version;
}

/**
 * npm publishes our releases with provenance, so every tarball carries a
 * signed record of the workflow that built it. Checking it is cheap; failing
 * the install over a registry that cannot answer is not, so this only reports.
 */
export async function checkProvenance(site: Site, version: string): Promise<"ok" | "unverified"> {
  const result = await exec("npm", ["audit", "signatures"], {
    cwd: site.releaseDir(version), quiet: true, timeout: 60_000,
  });
  return result.code === 0 && /verified/i.test(result.output) ? "ok" : "unverified";
}

/**
 * The package's own Prisma CLI, from the same release it migrates. The shrinkwrap
 * we publish makes npm install our tree UNDER the package, so from the registry
 * the link lives in the app's own node_modules/.bin — the release root only has
 * one when npm chose to hoist (a tarball install can).
 */
export function prismaBin(site: Site, version: string): string {
  const name = process.platform === "win32" ? "prisma.cmd" : "prisma";
  const candidates = [
    path.join(site.appDir(version), "node_modules", ".bin", name),
    path.join(site.releaseDir(version), "node_modules", ".bin", name),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`release ${version} has no Prisma CLI (looked in ${candidates.join(", ")})`);
  return found;
}

/** A failed `migrate deploy`, carrying everything it printed. */
export class MigrateError extends Error {
  constructor(readonly output: string) {
    super(`prisma migrate deploy failed:\n${output.trim().slice(-2000)}`);
  }
}

/**
 * Runs `prisma migrate deploy`; returns what it printed, or throws MigrateError.
 * `onApplying` hears each migration as Prisma starts it ("Applying migration `…`").
 */
export async function migrate(
  site: Site, version: string, opts: { quiet?: boolean; onApplying?: (name: string) => void } = {},
): Promise<string> {
  const env = { ...site.processEnv(version), ...site.readEnv() };
  let pending = "";
  const result = await exec(prismaBin(site, version), ["migrate", "deploy"], {
    cwd: site.appDir(version),
    env,
    quiet: opts.quiet,
    timeout: 10 * 60_000,
    onData: opts.onApplying && ((chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const l of lines) {
        const m = /Applying migration `([^`]+)`/.exec(l);
        if (m) opts.onApplying!(m[1]!);
      }
    }),
  });
  if (result.code !== 0) throw new MigrateError(result.output);
  return result.output;
}

export interface DeployRecord {
  status: "completed" | "failed";
  /** The release being deployed. */
  version: string;
  output: string;
  startedAt: Date;
  completedAt: Date;
}

/**
 * Write a schema deploy into ACP → System → Migration History, the same row
 * the installer writes. Through psql, which the backup already needs, because
 * the CLI has no database driver of its own.
 *
 * Every value goes in as a psql variable and is quoted by psql (`:'name'`), so
 * the log cannot break out of the statement. The times are written in UTC
 * explicitly: the columns carry no zone and the app reads them as UTC, while a
 * database default would use the session's zone.
 *
 * Best effort: false when psql is missing or the write fails. A history row is
 * never worth failing an update over.
 */
export async function recordDeploy(site: Site, record: DeployRecord): Promise<boolean> {
  const raw = site.readEnv().DATABASE_URL;
  if (!raw || !(await run("psql", ["--version"]))) return false;
  const { url } = pgConnection(raw);

  const output = record.output.length > 8000
    ? `${record.output.slice(0, 2000)}\n…\n${record.output.slice(-6000)}`
    : record.output;
  const sql = `INSERT INTO xcf_migration_runs
  (id, adapter, adapter_ver, command, status, "durationMs", output, started_at, completed_at, "createdAt")
VALUES
  (gen_random_uuid()::text, 'core', :'version', 'migrate deploy', :'status', :'duration'::int, :'output',
   (:'started')::timestamptz AT TIME ZONE 'UTC', (:'completed')::timestamptz AT TIME ZONE 'UTC',
   (:'started')::timestamptz AT TIME ZONE 'UTC');
`;
  // Variables are only interpolated in a script, never in -c — hence the file.
  await fs.mkdir(site.backupsDir, { recursive: true });
  const file = path.join(site.backupsDir, `.record-deploy-${process.pid}.sql`);
  await fs.writeFile(file, sql, { mode: 0o600 });
  try {
    const result = await exec("psql", [
      "--quiet", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
      "--set", `version=${record.version}`,
      "--set", `status=${record.status}`,
      "--set", `duration=${Math.max(0, Math.round(record.completedAt.getTime() - record.startedAt.getTime()))}`,
      "--set", `output=${output}`,
      "--set", `started=${record.startedAt.toISOString()}`,
      "--set", `completed=${record.completedAt.toISOString()}`,
      "--file", file, url,
    ], { quiet: true, timeout: 30_000 });
    return result.code === 0;
  } finally {
    await fs.rm(file, { force: true });
  }
}

/**
 * Does this release have migrations the database hasn't run? `migrate status`
 * exits 1 for "pending", so a non-zero code alone means nothing — only the text
 * does. Anything else is a status we could not read, and that throws: guessing
 * "pending" is what once sent a restore into a live database whose migrations
 * had never started.
 */
export async function migrationsPending(site: Site, version: string): Promise<boolean> {
  return (await pendingMigrations(site, version)) !== null;
}

/**
 * The migrations this release would apply, by name, oldest first; null when there
 * are none. Same reading rules as above: an unreadable status throws.
 */
export async function pendingMigrations(site: Site, version: string): Promise<string[] | null> {
  const env = { ...site.processEnv(version), ...site.readEnv() };
  const result = await exec(prismaBin(site, version), ["migrate", "status"], {
    cwd: site.appDir(version), env, quiet: true, timeout: 60_000,
  });
  if (/not yet been applied|pending/i.test(result.output)) {
    // Prisma lists them one per line after the heading; a name is a timestamp and a slug.
    return [...result.output.matchAll(/^\s*(\d{14}_[\w-]+)\s*$/gm)].map((m) => m[1]!);
  }
  if (result.code === 0) return null;
  throw new Error(`could not read the migration status:\n${result.output.trim().slice(-2000)}`);
}

/**
 * A Prisma connection URL is not a libpq one. `?schema=public` in particular is
 * Prisma's, and pg_dump refuses the whole URL over it ("invalid URI query
 * parameter"). So we hand the tools only the parameters libpq knows, and turn
 * the schema into the `--schema` flag it belongs in.
 */
const LIBPQ_PARAMS = new Set([
  "host", "hostaddr", "port", "dbname", "user", "password", "passfile", "channel_binding",
  "connect_timeout", "client_encoding", "options", "application_name", "fallback_application_name",
  "keepalives", "keepalives_idle", "keepalives_interval", "keepalives_count", "tcp_user_timeout",
  "replication", "gssencmode", "sslmode", "requiressl", "sslcompression", "sslcert", "sslkey",
  "sslpassword", "sslrootcert", "sslcrl", "sslcrldir", "sslsni", "requirepeer", "ssl_min_protocol_version",
  "ssl_max_protocol_version", "krbsrvname", "gsslib", "service", "target_session_attrs",
]);

export function pgConnection(url: string): { url: string; schema?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url }; // a key=value connection string, which the tools take as-is
  }
  const schema = parsed.searchParams.get("schema") ?? undefined;
  for (const key of [...parsed.searchParams.keys()]) {
    if (!LIBPQ_PARAMS.has(key)) parsed.searchParams.delete(key);
  }
  return { url: parsed.toString(), ...(schema && schema !== "public" ? { schema } : {}) };
}

/**
 * pg_dump the site's database into shared/backups. Returns the file, or null
 * when pg_dump isn't installed — in which case the caller decides whether to
 * carry on (an update won't, unless told to).
 */
export async function backup(site: Site, label = "backup"): Promise<string | null> {
  const raw = site.readEnv().DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set in shared/.env");
  if (!(await run("pg_dump", ["--version"]))) return null;
  const { url, schema } = pgConnection(raw);

  await fs.mkdir(site.backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(site.backupsDir, `${label}-${stamp}.sql`);

  const result = await new Promise<number>((resolve) => {
    const out = createWriteStream(file);
    // --clean --if-exists: the dump drops what it recreates, so it can be restored
    // over the live database it came from — a plain dump fails on its first CREATE.
    const args = ["--no-owner", "--no-privileges", "--clean", "--if-exists",
      ...(schema ? ["--schema", schema] : []), url];
    const child = spawn("pg_dump", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => { stderr += c; });
    child.stdout.pipe(out);
    child.on("error", () => resolve(1));
    child.on("close", (code) => {
      out.end();
      if (code !== 0 && stderr) process.stderr.write(stderr);
      resolve(code ?? 1);
    });
  });
  if (result !== 0) {
    await fs.rm(file, { force: true });
    throw new Error("pg_dump failed");
  }
  return file;
}

export async function restore(site: Site, file: string): Promise<void> {
  const raw = site.readEnv().DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set in shared/.env");
  const { url } = pgConnection(raw);
  // One transaction: a restore that fails halfway leaves the database as it was.
  const result = await exec("psql", ["--quiet", "--single-transaction", "--set", "ON_ERROR_STOP=1", "--file", file, url], { quiet: true });
  if (result.code !== 0) throw new Error(`psql could not restore ${file}:\n${result.output.trim().slice(-2000)}`);
}

/**
 * Wait for the site to answer. The installer status endpoint is the right probe:
 * it is served before and after the wizard, and it touches the database.
 */
export async function waitForHealth(port: number, timeoutMs = 60_000): Promise<boolean> {
  const url = `http://127.0.0.1:${port}/api/install/status`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** The version a release actually reports, read from the installed package. */
export async function installedVersion(site: Site, version: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(site.appDir(version), "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

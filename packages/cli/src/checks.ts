/**
 * The system checks, in one place.
 *
 * Three callers run these: `npm create xentium` before it installs anything,
 * `xentium doctor` against a live install, and the shell installer (which runs
 * `create-xentium`). The numbers come from SYSTEM_REQUIREMENTS in
 * `@xentium/contracts`, which the install wizard reads too, so the CLI and the
 * wizard can never disagree about what a server needs.
 *
 * `create-xentium` bundles this file from source rather than depending on the
 * CLI: the preflight has to run before anything of ours is installed.
 *
 * Every check is independent and never throws — a check that cannot find out
 * says so. Only node builtins and `pg` are used, so this loads on a machine
 * that has nothing of ours on it.
 */
import { execFile } from "node:child_process";
import { createConnection, createServer, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { promises as fs, statfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  SYSTEM_REQUIREMENTS,
  checkVersion,
  compareVersions,
  displayVersion,
  type VersionRequirement,
} from "../../contracts/src/system.js";

export { SYSTEM_REQUIREMENTS, compareVersions, displayVersion };

const execFileAsync = promisify(execFile);

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  /** Stable id, for --json and for tests. */
  key: string;
  name: string;
  status: CheckStatus;
  /** What we found. */
  detail: string;
  /** What to do about it, written for the machine we're on. */
  fix?: string;
}

const ok = (key: string, name: string, detail: string): Check => ({ key, name, status: "ok", detail });
const warn = (key: string, name: string, detail: string, fix?: string): Check =>
  ({ key, name, status: "warn", detail, ...(fix ? { fix } : {}) });
const fail = (key: string, name: string, detail: string, fix?: string): Check =>
  ({ key, name, status: "fail", detail, ...(fix ? { fix } : {}) });

// ── Platform helpers ─────────────────────────────────────────────────────────

/** `apt`, `dnf`, `pacman`, `apk`, `brew` or null — how this machine installs software. */
export async function packageManager(): Promise<string | null> {
  if (process.platform === "darwin") return "brew";
  if (process.platform !== "linux") return null;
  let osRelease = "";
  try {
    osRelease = await fs.readFile("/etc/os-release", "utf8");
  } catch {
    return null;
  }
  const ids = `${/^ID=(.*)$/m.exec(osRelease)?.[1] ?? ""} ${/^ID_LIKE=(.*)$/m.exec(osRelease)?.[1] ?? ""}`
    .replace(/"/g, "")
    .toLowerCase();
  if (/debian|ubuntu/.test(ids)) return "apt";
  if (/fedora|rhel|centos|almalinux|rocky/.test(ids)) return "dnf";
  if (/arch/.test(ids)) return "pacman";
  if (/alpine/.test(ids)) return "apk";
  return null;
}

/** "sudo apt install python3 make g++" — the command for the detected OS. */
export async function installHint(packages: Record<string, string[]>): Promise<string> {
  const pm = await packageManager();
  const names = (pm && packages[pm]) || packages.default || [];
  switch (pm) {
    case "apt":    return `sudo apt install ${names.join(" ")}`;
    case "dnf":    return `sudo dnf install ${names.join(" ")}`;
    case "pacman": return `sudo pacman -S ${names.join(" ")}`;
    case "apk":    return `sudo apk add ${names.join(" ")}`;
    case "brew":   return `brew install ${names.join(" ")}`;
    default:       return `install ${names.join(" ")}`;
  }
}

/** Run a command and return its trimmed stdout, or null if it isn't there. */
export async function run(cmd: string, args: string[], timeout = 10_000): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout,
      encoding: "utf8",
      // npm and docker are .cmd shims on Windows, which execFile cannot spawn.
      shell: process.platform === "win32",
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

function versionCheck(
  key: string,
  name: string,
  detected: string,
  req: VersionRequirement,
  fixText?: string,
): Check {
  const wanted = req.recommended
    ? `needs ${displayVersion(req.minimum)}+, ${displayVersion(req.recommended)}+ recommended`
    : `needs ${displayVersion(req.minimum)}+`;
  const result = checkVersion(detected, req);
  const detail = `${detected} (${wanted})`;
  if (result === "fail") return fail(key, name, detail, fixText);
  if (result === "warn") return warn(key, name, detail);
  return ok(key, name, detected);
}

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;

// ── Always ───────────────────────────────────────────────────────────────────

export function checkNode(version = process.versions.node): Check {
  return versionCheck("node", "Node.js", version, SYSTEM_REQUIREMENTS.node,
    "Install Node 24 from https://nodejs.org or with nvm, then run this again.");
}

export async function checkNpm(): Promise<Check> {
  const version = await run("npm", ["--version"]);
  if (!version) return fail("npm", "npm", "not found", "npm ships with Node.js — reinstall Node.");
  return versionCheck("npm", "npm", version, SYSTEM_REQUIREMENTS.npm, "npm install -g npm@latest");
}

/** Platforms argon2 ships a prebuilt binary for; everything else compiles it. */
const ARGON2_PREBUILDS = new Set([
  "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64", "freebsd-x64",
]);

export function checkPlatform(): Check {
  const tuple = `${process.platform}-${process.arch}`;
  if (process.platform === "linux") return ok("platform", "Platform", tuple);
  if (process.platform === "darwin" || process.platform === "win32") {
    return warn("platform", "Platform", `${tuple} — fine for trying Xentium out, but we only support Linux in production`);
  }
  return warn("platform", "Platform", `${tuple} — untested`);
}

/**
 * argon2 hashes every password, and it's the one native module we ship. If the
 * platform has no prebuilt binary, npm compiles it, which needs a toolchain —
 * and an install that discovers that halfway through is a bad install.
 */
export async function checkNativeBuild(): Promise<Check> {
  const tuple = `${process.platform}-${process.arch}`;
  if (ARGON2_PREBUILDS.has(tuple)) return ok("native", "Password hashing", `prebuilt binary for ${tuple}`);

  const tools = await Promise.all([run("python3", ["--version"]), run("make", ["-v"]), run("g++", ["--version"])]);
  const missing = ["python3", "make", "g++"].filter((_, i) => !tools[i]);
  if (missing.length === 0) return ok("native", "Password hashing", `no prebuilt binary for ${tuple}, but it can be compiled`);
  return fail("native", "Password hashing", `no prebuilt binary for ${tuple}, and ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing`,
    await installHint({ apt: ["python3", "make", "g++"], dnf: ["python3", "make", "gcc-c++"], pacman: ["python", "base-devel"], apk: ["python3", "make", "g++"], default: ["python3", "make", "g++"] }));
}

export function checkMemory(total = os.totalmem()): Check {
  const need = SYSTEM_REQUIREMENTS.memoryBytes;
  if (total >= need) return ok("memory", "Memory", `${gb(total)} RAM`);
  return warn("memory", "Memory", `${gb(total)} RAM — ${gb(need)} recommended; the worker and plugin builds get tight`);
}

/**
 * The install directory: it has to exist (or be creatable), be writable, and —
 * for a new install — be empty. Disk space is measured on the same filesystem.
 */
export async function checkTarget(dir: string, expectEmpty: boolean): Promise<Check> {
  const resolved = path.resolve(dir);
  try {
    await fs.mkdir(resolved, { recursive: true });
    const probe = path.join(resolved, `.xentium-write-probe-${process.pid}`);
    await fs.writeFile(probe, "ok");
    await fs.rm(probe);
  } catch {
    return fail("target", "Install directory", `${resolved} is not writable`,
      `sudo mkdir -p ${resolved} && sudo chown -R $USER ${resolved}`);
  }

  if (expectEmpty) {
    const entries = (await fs.readdir(resolved)).filter((e) => e !== ".DS_Store");
    if (entries.length > 0) {
      return fail("target", "Install directory", `${resolved} is not empty (${entries.length} entries)`,
        "Pick a directory that doesn't exist yet, or empty this one.");
    }
  }

  let free: number;
  try {
    const fsStat = statfsSync(resolved);
    free = fsStat.bavail * fsStat.bsize;
  } catch {
    return ok("target", "Install directory", `${resolved} (could not read free space)`);
  }
  const need = SYSTEM_REQUIREMENTS.installDiskBytes + SYSTEM_REQUIREMENTS.dataDiskBytes;
  if (free < need) {
    return fail("target", "Install directory", `${resolved} — ${gb(free)} free, ${gb(need)} needed`,
      "Free up some space, or install somewhere with more room.");
  }
  return ok("target", "Install directory", `${resolved} — ${gb(free)} free`);
}

/** Can we listen on this port? */
export function portFree(port: number, host = "0.0.0.0"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

export async function checkPort(port: number, what = "Application port"): Promise<Check> {
  if (await portFree(port)) return ok(`port_${port}`, what, `${port} is free`);
  return fail(`port_${port}`, what, `something is already listening on ${port}`,
    `Stop it, or choose another port (sudo ss -lptn 'sport = :${port}' shows what it is).`);
}

/** Any HTTP answer counts: we're testing reachability, not the response. */
async function reachable(url: string, timeoutMs = 6000): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    return true;
  } catch {
    return false;
  }
}

export async function checkRegistry(registry = "https://registry.npmjs.org"): Promise<Check> {
  if (await reachable(`${registry}/-/ping`)) return ok("registry", "npm registry", `${registry} reachable`);
  return fail("registry", "npm registry", `cannot reach ${registry}`,
    "Xentium is installed from npm. Check the network, a proxy, or `npm config get registry`.");
}

export async function checkMarketplace(url = "https://plugins.xentium.org/api/v1"): Promise<Check> {
  if (await reachable(url)) return ok("marketplace", "Xentium marketplace", "reachable");
  return warn("marketplace", "Xentium marketplace", `cannot reach ${url} — plugins and updates won't be offered until it is`);
}

// ── Docker path ──────────────────────────────────────────────────────────────

export async function checkDocker(): Promise<Check[]> {
  const version = await run("docker", ["--version"]);
  if (!version) {
    return [fail("docker", "Docker", "not installed",
      "https://docs.docker.com/engine/install/ — or run the install again and bring your own PostgreSQL and Redis.")];
  }
  const checks: Check[] = [];
  const info = await run("docker", ["info", "--format", "{{.ServerVersion}}"], 20_000);
  if (!info) {
    checks.push(fail("docker", "Docker", "installed, but the daemon is not reachable",
      "sudo systemctl start docker  (and `sudo usermod -aG docker $USER`, then log back in)"));
    return checks;
  }
  checks.push(ok("docker", "Docker", `engine ${info}`));

  const compose = await run("docker", ["compose", "version", "--short"]);
  if (!compose) {
    checks.push(fail("docker_compose", "Docker Compose", "the v2 plugin is missing",
      await installHint({ apt: ["docker-compose-plugin"], dnf: ["docker-compose-plugin"], default: ["docker-compose-plugin"] })));
  } else {
    checks.push(ok("docker_compose", "Docker Compose", `v${compose.replace(/^v/, "")}`));
  }
  return checks;
}

// ── Bring-your-own database path ─────────────────────────────────────────────

/**
 * Connect, read the version, and prove we can actually create a table — a role
 * that can connect but not write is the failure people hit most, and it only
 * shows up at migration time otherwise.
 */
export async function checkPostgres(url: string): Promise<Check> {
  let Client: typeof import("pg").Client;
  try {
    ({ Client } = await import("pg"));
  } catch {
    return warn("postgres", "PostgreSQL", "could not load the postgres driver, so the connection wasn't tested");
  }
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const { rows } = await client.query<{ version: string }>("SELECT version()");
    const version = /PostgreSQL (\d+(?:\.\d+)?)/.exec(rows[0]?.version ?? "")?.[1];

    const probe = `xentium_probe_${process.pid}`;
    try {
      await client.query(`CREATE TABLE "${probe}" (id int)`);
      await client.query(`DROP TABLE "${probe}"`);
    } catch {
      return fail("postgres", "PostgreSQL", "connected, but this user cannot create tables",
        "GRANT ALL ON DATABASE <db> TO <user>; and make the user own the public schema (Postgres 15+: GRANT ALL ON SCHEMA public TO <user>;)");
    }

    // A fork or a managed service can report its version oddly. The connection
    // works and the user can write, so we don't refuse over a string we can't parse.
    if (!version) return ok("postgres", "PostgreSQL", "connected (version not reported)");
    return versionCheck("postgres", "PostgreSQL", version, SYSTEM_REQUIREMENTS.postgres);
  } catch (e) {
    return fail("postgres", "PostgreSQL", `cannot connect — ${(e as Error).message}`,
      "Check the host, port, database name and password in the connection URL.");
  } finally {
    await client.end().catch(() => null);
  }
}

/**
 * Redis over a raw socket with inline commands, so the preflight needs no Redis
 * client. We ask for PING, INFO server and the eviction policy in one go and
 * read the answers out of the raw reply.
 */
async function redisTalk(url: string, timeoutMs = 6000): Promise<string> {
  const parsed = new URL(url);
  const tls = parsed.protocol === "rediss:";
  const port = Number(parsed.port || 6379);
  const host = parsed.hostname || "127.0.0.1";

  return new Promise((resolve, reject) => {
    const socket: Socket = tls
      ? tlsConnect({ host, port, servername: host, rejectUnauthorized: false })
      : createConnection({ host, port });

    let out = "";
    const done = (err: Error | null) => {
      socket.destroy();
      if (err) reject(err); else resolve(out);
    };
    socket.setTimeout(timeoutMs, () => done(new Error("timed out")));
    socket.on("error", done);
    socket.on("data", (chunk) => {
      out += chunk.toString("utf8");
      // The last command's reply has landed.
      if (/maxmemory-policy\r\n/.test(out) || /^-/.test(out)) done(null);
    });
    socket.on("connect", () => {
      const password = decodeURIComponent(parsed.password || "");
      const user = decodeURIComponent(parsed.username || "");
      if (password) socket.write(`AUTH ${user ? `${user} ` : ""}${password}\r\n`);
      socket.write("PING\r\nINFO server\r\nCONFIG GET maxmemory-policy\r\n");
    });
  });
}

export async function checkRedis(url: string): Promise<Check> {
  let reply: string;
  try {
    reply = await redisTalk(url);
  } catch (e) {
    return fail("redis", "Redis", `cannot connect — ${(e as Error).message}`,
      "Check REDIS_URL, and that Redis is listening (redis-cli ping).");
  }
  const authError = /^-(?:NOAUTH|WRONGPASS|ERR invalid password)[^\r]*/m.exec(reply);
  if (authError) {
    return fail("redis", "Redis", `authentication failed — ${authError[0].slice(1)}`,
      "Put the password in the URL: redis://:<password>@host:6379");
  }
  const version = /redis_version:(\S+)/.exec(reply)?.[1];
  if (!version) return ok("redis", "Redis", "connected (version not reported)");

  const base = versionCheck("redis", "Redis", version, SYSTEM_REQUIREMENTS.redis);
  if (base.status === "fail") return base;

  // CONFIG can be disabled on managed Redis; then we simply don't know.
  const policy = /maxmemory-policy\r\n\$\d+\r\n([a-z-]+)/.exec(reply)?.[1];
  const wanted = SYSTEM_REQUIREMENTS.redisMaxmemoryPolicy;
  if (policy && policy !== wanted) {
    return warn("redis", "Redis", `${version}, but maxmemory-policy is "${policy}" — queued jobs can be evicted when Redis fills up`,
      `redis-cli CONFIG SET maxmemory-policy ${wanted}  (and put it in redis.conf so it survives a restart)`);
  }
  return base;
}

// ── Running it as a service ──────────────────────────────────────────────────

export async function checkSystemd(): Promise<Check> {
  if (process.platform !== "linux") {
    return warn("systemd", "Service manager", `no systemd on ${process.platform} — Xentium will run in the foreground`);
  }
  if (!(await run("systemctl", ["--version"]))) {
    return warn("systemd", "Service manager", "systemctl not found — Xentium will run in the foreground");
  }
  if (process.getuid?.() === 0) return ok("systemd", "Service manager", "systemd (running as root)");
  if (await run("sudo", ["-n", "true"])) return ok("systemd", "Service manager", "systemd, with passwordless sudo");
  return warn("systemd", "Service manager", "systemd is there, but sudo will ask for a password when the units are installed");
}

export async function checkNginx(): Promise<Check> {
  const version = await run("nginx", ["-v"]);
  if (version) return ok("nginx", "nginx", "installed — we can write a site config for you");
  return ok("nginx", "nginx", "not installed (optional; you can put any reverse proxy in front)");
}

// ── The runner ───────────────────────────────────────────────────────────────

export interface CheckOptions {
  /** Where Xentium goes (or already is). */
  target?: string;
  /** New install: the directory must be empty. */
  expectEmpty?: boolean;
  /** The port the app will listen on. */
  port?: number;
  /** Bring-your-own database: test these instead of Docker. */
  databaseUrl?: string;
  redisUrl?: string;
  /** Docker path: check the engine, compose and the ports the compose file binds. */
  docker?: boolean;
  dockerPorts?: number[];
  /** Skip the two network checks (offline installs). */
  offline?: boolean;
  marketplaceUrl?: string;
  /** Doctor only: we already know how it's being run. */
  skipService?: boolean;
}

export async function runChecks(options: CheckOptions = {}): Promise<Check[]> {
  // Built in display order, run in parallel, flattened back in order — the list
  // people read should not depend on which check answered first.
  const tasks: Array<Promise<Check | Check[]>> = [
    Promise.resolve(checkNode()),
    checkNpm(),
    Promise.resolve(checkPlatform()),
    checkNativeBuild(),
    Promise.resolve(checkMemory()),
  ];
  if (options.target) tasks.push(checkTarget(options.target, options.expectEmpty ?? false));
  if (options.port) tasks.push(checkPort(options.port));
  if (options.docker) {
    tasks.push(checkDocker());
    for (const p of options.dockerPorts ?? []) tasks.push(checkPort(p, `Port ${p}`));
  }
  if (options.databaseUrl) tasks.push(checkPostgres(options.databaseUrl));
  if (options.redisUrl) tasks.push(checkRedis(options.redisUrl));
  if (!options.offline) {
    tasks.push(checkRegistry());
    tasks.push(checkMarketplace(options.marketplaceUrl));
  }
  if (!options.skipService) {
    tasks.push(checkSystemd());
    tasks.push(checkNginx());
  }
  return (await Promise.all(tasks)).flat();
}

/** `fail` if anything failed, else `warn` if anything warned, else `ok`. */
export function worst(checks: Check[]): CheckStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}

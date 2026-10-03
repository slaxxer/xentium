/**
 * Where everything lives in an installed site, and how to read its settings.
 *
 *   my-site/
 *     xentium.json        what this CLI knows about the site
 *     releases/<v>/       an npm project whose only dependency is @xentium/server@<v>
 *     current -> releases/<v>
 *     shared/.env         config and secrets; updates never touch it
 *     shared/uploads/     avatars, attachments, installed plugins
 *     shared/data/        anything else the app writes
 *     shared/backups/     database dumps taken before an update
 *     shared/log/         only used when the site runs without systemd
 *
 * Releases are separate directories and `current` is a symlink, so an update is
 * a symlink swap and a rollback is the same swap the other way.
 */
import { promises as fs } from "node:fs";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";

export interface SiteConfig {
  /** The release `current` points at. */
  version: string;
  /** The port the API listens on. */
  port: number;
  /** Where people reach the site; also the wizard's APP_URL. */
  url: string;
  /** systemd unit names, when the site is installed as a service. */
  service?: { api: string; worker: string };
  /** Docker Compose runs this site's PostgreSQL and Redis. */
  docker?: boolean;
  /** Written by `xentium update`, read by `xentium rollback`. */
  previousVersion?: string;
}

export class Site {
  constructor(readonly root: string) {}

  get configFile()  { return path.join(this.root, "xentium.json"); }
  get releasesDir() { return path.join(this.root, "releases"); }
  get currentLink() { return path.join(this.root, "current"); }
  get sharedDir()   { return path.join(this.root, "shared"); }
  get envFile()     { return path.join(this.sharedDir, ".env"); }
  get uploadsDir()  { return path.join(this.sharedDir, "uploads"); }
  get dataDir()     { return path.join(this.sharedDir, "data"); }
  get backupsDir()  { return path.join(this.sharedDir, "backups"); }
  get logDir()      { return path.join(this.sharedDir, "log"); }
  get runDir()      { return path.join(this.sharedDir, "run"); }
  get composeFile() { return path.join(this.sharedDir, "docker-compose.yml"); }

  releaseDir(version: string) { return path.join(this.releasesDir, version); }

  /** The @xentium/server package inside a release. */
  appDir(version?: string) {
    const base = version ? this.releaseDir(version) : this.currentLink;
    return path.join(base, "node_modules", "@xentium", "server");
  }

  /** Both processes run with the API package as their working directory. */
  workingDir(version?: string) { return path.join(this.appDir(version), "apps", "api"); }

  readConfig(): SiteConfig {
    return JSON.parse(readFileSync(this.configFile, "utf8")) as SiteConfig;
  }

  async writeConfig(config: SiteConfig): Promise<void> {
    await fs.writeFile(this.configFile, `${JSON.stringify(config, null, 2)}\n`);
  }

  async patchConfig(patch: Partial<SiteConfig>): Promise<SiteConfig> {
    const next = { ...this.readConfig(), ...patch };
    await this.writeConfig(next);
    return next;
  }

  /** `.env` as a plain object. Missing file → empty. */
  readEnv(): Record<string, string> {
    try {
      return parseEnv(readFileSync(this.envFile, "utf8"));
    } catch {
      return {};
    }
  }

  /** What the API and the worker need in their environment. */
  processEnv(version?: string): NodeJS.ProcessEnv {
    return {
      ...process.env,
      NODE_ENV: "production",
      XENTIUM_ENV_FILE: this.envFile,
      // REPO_ROOT and PRISMA_SCHEMA_PATH default off the working directory, which
      // is the package's apps/api — the package mirrors the repo layout, so the
      // defaults land on the package's own prisma/ and web build.
      ...(version ? { XENTIUM_RELEASE: version } : {}),
    };
  }

  /** Every installed release, newest first. */
  async releases(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.releasesDir);
      return entries.sort((a, b) => -compareSemver(a, b));
    } catch {
      return [];
    }
  }

  /** Which release `current` points at right now, from the filesystem. */
  currentRelease(): string | null {
    try {
      return path.basename(readlinkSync(this.currentLink));
    } catch {
      return null;
    }
  }

  async pointCurrentAt(version: string): Promise<void> {
    const target = this.releaseDir(version);
    if (!existsSync(target)) throw new Error(`release ${version} is not installed`);
    // A symlink cannot be replaced atomically, so we make the new one next to it
    // and rename it over the old one — rename() is atomic on the same filesystem.
    const staging = `${this.currentLink}.new`;
    await fs.rm(staging, { force: true, recursive: true });
    await fs.symlink(path.relative(this.root, target), staging, "dir");
    await fs.rename(staging, this.currentLink);
  }

  async ensureDirs(): Promise<void> {
    for (const dir of [this.releasesDir, this.sharedDir, this.uploadsDir, this.dataDir, this.backupsDir, this.logDir, this.runDir]) {
      await fs.mkdir(dir, { recursive: true });
    }
  }
}

/**
 * Find the site we're being run in: `--site`, then `XENTIUM_SITE`, then the
 * first `xentium.json` at or above the working directory.
 */
export function findSite(explicit?: string): Site | null {
  const start = explicit ?? process.env.XENTIUM_SITE;
  if (start) {
    const site = new Site(path.resolve(start));
    return existsSync(site.configFile) ? site : null;
  }
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, "xentium.json"))) return new Site(dir);
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** KEY=value lines, ignoring comments and surrounding quotes. */
export function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]!] = m[2]!.trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/**
 * Merge values into a `.env`, keeping comments, ordering and any hand-edited
 * lines. The same rule the install wizard follows: never clobber the file.
 */
export function mergeEnv(existing: string, updates: Record<string, string>): string {
  const pending = new Map(Object.entries(updates));
  const lines = existing.length ? existing.split(/\r?\n/) : [];
  const merged = lines.map((line) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const key = m?.[1];
    if (!key || !pending.has(key)) return line;
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key}=${value}`;
  });
  if (pending.size > 0) {
    if (merged.length && merged[merged.length - 1]!.trim() !== "") merged.push("");
    for (const [key, value] of pending) merged.push(`${key}=${value}`);
  }
  return merged.join("\n").replace(/\n*$/, "\n");
}

/** Numeric version compare, prereleases sorting below their release. */
export function compareSemver(a: string, b: string): number {
  const split = (v: string) => {
    const [core = "", pre = ""] = v.replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  // Identifier by identifier, numbers numerically: "alpha.10" is newer than
  // "alpha.9", which a plain string compare gets backwards.
  const xs = x.pre.split(".");
  const ys = y.pre.split(".");
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const p = xs[i];
    const q = ys[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) > Number(q) ? 1 : -1;
    if (pn) return -1;
    if (qn) return 1;
    return p > q ? 1 : -1;
  }
  return 0;
}

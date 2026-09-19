/**
 * `xentium update` and `xentium rollback`.
 *
 * The order matters, and every step before the swap is reversible:
 *
 *   1. resolve the version and refuse an update that can't work
 *   2. check every installed plugin's supported version window
 *   3. install the release next to the running one (nothing swapped yet)
 *   4. back the database up
 *   5. stop the site, migrate, point `current` at the new release, start it
 *   6. health check — if it fails, swap back, start the old release, and
 *      restore the dump when a migration had already run
 *
 * ⚠ The web process must never run this. The ACP button writes a request that a
 * root-owned updater unit picks up, and that unit runs this CLI. A vulnerability
 * in the app is then not a way to install code.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  backup as dumpDatabase,
  checkProvenance,
  installRelease,
  migrate,
  migrationsPending,
  resolveVersion,
  restore,
  waitForHealth,
} from "./release.js";
import { compareSemver, type Site } from "./site.js";
import { systemctl, unitNames, unitsInstalled } from "./service.js";
import { color, error, field, heading, info, line, note, success, warning } from "./ui.js";

export interface UpdateOptions {
  /** A version or a dist-tag; default `latest`. */
  version?: string;
  /** A packed tarball to install instead of one from the registry. */
  package?: string;
  /** Install and migrate even when a plugin says it doesn't support the version. */
  force?: boolean;
  /** Carry on when pg_dump isn't installed. */
  skipBackup?: boolean;
  /** Do everything except the swap. */
  dryRun?: boolean;
}

interface PluginInfo { id: string; name: string; min: string; max?: string }

/** major.minor only, which is the window a plugin declares. */
function compareBase(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, "").split(".").slice(0, 2).map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 2; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Every installed plugin, read from the plugin store next to the uploads. */
export async function installedPlugins(site: Site): Promise<PluginInfo[]> {
  const store = path.join(site.uploadsDir, "plugins");
  let entries: string[];
  try {
    entries = await fs.readdir(store);
  } catch {
    return [];
  }
  const plugins: PluginInfo[] = [];
  for (const entry of entries) {
    try {
      const raw = await fs.readFile(path.join(store, entry, "manifest.json"), "utf8");
      const m = JSON.parse(raw) as { id?: string; name?: string; minXentiumVersion?: string; maxXentiumVersion?: string };
      if (!m.id || !m.minXentiumVersion) continue;
      plugins.push({ id: m.id, name: m.name ?? m.id, min: m.minXentiumVersion, ...(m.maxXentiumVersion ? { max: m.maxXentiumVersion } : {}) });
    } catch {
      /* not an extracted plugin directory */
    }
  }
  return plugins;
}

/** Plugins whose declared window does not contain the version we're moving to. */
export async function incompatiblePlugins(site: Site, version: string): Promise<string[]> {
  const plugins = await installedPlugins(site);
  return plugins
    .filter((p) => compareBase(version, p.min) < 0 || (p.max && compareBase(version, p.max) > 0))
    .map((p) => `${p.name} supports ${p.min}${p.max ? `–${p.max}` : "+"}`);
}

/**
 * Is moving from `from` to `to` allowed? `done` means there is nothing to do,
 * `stop` means we refuse and have said why.
 */
async function verify(site: Site, from: string, to: string, options: UpdateOptions): Promise<"go" | "done" | "stop"> {
  if (compareSemver(to, from) === 0) {
    line();
    success(`Already on ${to}. Nothing to do.`);
    return "done";
  }
  if (compareSemver(to, from) < 0 && !options.force) {
    line();
    error(`${to} is older than the installed ${from}. Use \`xentium rollback\` to go back, or --force.`);
    return "stop";
  }

  const blocked = await incompatiblePlugins(site, to);
  if (blocked.length > 0) {
    line();
    error(`Xentium ${to} is outside what ${blocked.length === 1 ? "a plugin supports" : "some plugins support"}:`);
    for (const reason of blocked) info(`• ${reason}`);
    if (!options.force) {
      note("Update those plugins first, or run again with --force.");
      return "stop";
    }
    warning("--force: updating anyway. Those plugins will refuse to load.");
  }
  return "go";
}

export async function update(site: Site, options: UpdateOptions = {}): Promise<number> {
  const config = site.readConfig();
  const serviceUnits = config.service ?? unitNames();
  const managed = await unitsInstalled(serviceUnits);

  // ── 1. Which version ───────────────────────────────────────────────────────
  // A tarball only reveals its version once npm has unpacked it, so that path
  // installs first and checks after — the install itself changes nothing that
  // is running.
  heading("Update");
  const spec = options.package ? `file:${options.package}` : await resolveVersion(options.version ?? "latest");
  if (!spec) {
    error(`Could not find ${options.version ?? "latest"} on the npm registry.`);
    return 1;
  }
  field("Installed", config.version);
  if (!options.package) {
    field("Available", spec);
    const verdict = await verify(site, config.version, spec, options);
    if (verdict !== "go") return verdict === "done" ? 0 : 1;
  }

  // ── 2. Install alongside ───────────────────────────────────────────────────
  heading(options.package ? "Installing" : `Installing ${spec}`);
  let version: string;
  try {
    version = await installRelease(site, spec, { quiet: true });
  } catch (e) {
    error((e as Error).message);
    return 1;
  }
  success(`Installed into releases/${version}`);
  if (options.package) {
    // `npm audit signatures` would still pass here — it verifies the registry
    // dependencies around a tarball that never came from the registry. Saying
    // "provenance verified" for a file someone handed us would be a lie.
    note("Installed from a local tarball, so there is no npm provenance to check.");
  } else if (await checkProvenance(site, version) === "ok") {
    success("npm provenance verified");
  } else {
    note("Could not verify npm provenance — the registry didn't answer.");
  }

  // ── 3. Check what we actually got ──────────────────────────────────────────
  if (options.package) {
    field("Installed version", version);
    if (compareSemver(version, config.version) !== 0) {
      const verdict = await verify(site, config.version, version, options);
      if (verdict !== "go") return verdict === "done" ? 0 : 1;
    } else {
      note(`Reinstalling ${version} over itself.`);
    }
  }

  if (options.dryRun) {
    line();
    note("--dry-run: stopping here. The new release is installed but not in use.");
    return 0;
  }

  // ── 4. Backup ──────────────────────────────────────────────────────────────
  heading("Backing up");
  let dump: string | null = null;
  try {
    dump = await dumpDatabase(site, `pre-${version}`);
  } catch (e) {
    error((e as Error).message);
    return 1;
  }
  if (dump) success(`Database dumped to ${path.relative(site.root, dump)}`);
  else if (options.skipBackup) warning("pg_dump is not installed — continuing without a backup (--skip-backup).");
  else {
    error("pg_dump is not installed, so there would be nothing to roll back to.");
    note("Install the PostgreSQL client tools, or run again with --skip-backup.");
    return 1;
  }

  // ── 5. Swap ────────────────────────────────────────────────────────────────
  heading("Switching over");
  const previous = config.version;
  const hadMigrations = await migrationsPending(site, version);
  if (managed) systemctl("stop", serviceUnits);

  try {
    if (hadMigrations) {
      await migrate(site, version, { quiet: true });
      success("Migrations applied");
    } else {
      note("No pending migrations.");
    }
    await site.pointCurrentAt(version);
    await site.patchConfig({ version, previousVersion: previous });
    success(`current → releases/${version}`);
  } catch (e) {
    error((e as Error).message);
    await rollTo(site, previous, serviceUnits, managed);
    if (hadMigrations && dump) await restoreQuietly(site, dump);
    return 1;
  }

  if (!managed) {
    line();
    success(`Updated to ${version}.`);
    note("This site isn't run by systemd, so restart it yourself to pick up the new release.");
    return 0;
  }

  // ── 6. Health check ────────────────────────────────────────────────────────
  systemctl("start", serviceUnits);
  const healthy = await waitForHealth(config.port);
  if (healthy) {
    line();
    success(`Xentium ${version} is running.`);
    note(`Rolled something back? \`xentium rollback\` returns to ${previous}.`);
    return 0;
  }

  error(`${version} did not come up within 60 seconds. Rolling back to ${previous}.`);
  systemctl("stop", serviceUnits);
  await rollTo(site, previous, serviceUnits, managed);
  if (hadMigrations && dump) await restoreQuietly(site, dump);
  if (await waitForHealth(config.port, 60_000)) success(`Back on ${previous}.`);
  else error(`${previous} did not come back up either. The logs are in \`journalctl -u ${serviceUnits.api}\`.`);
  return 1;
}

async function rollTo(site: Site, version: string, units: { api: string; worker: string }, managed: boolean): Promise<void> {
  await site.pointCurrentAt(version).catch(() => null);
  await site.patchConfig({ version }).catch(() => null);
  if (managed) systemctl("start", units);
}

async function restoreQuietly(site: Site, dump: string): Promise<void> {
  warning(`Restoring the database from ${path.relative(site.root, dump)} — migrations had already run.`);
  try {
    await restore(site, dump);
    success("Database restored.");
  } catch (e) {
    error(`Could not restore automatically: ${(e as Error).message}`);
    note(`Restore it by hand: psql "$DATABASE_URL" -f ${dump}`);
  }
}

export async function rollback(site: Site, target?: string): Promise<number> {
  const config = site.readConfig();
  const releases = await site.releases();
  const version = target ?? config.previousVersion ?? releases.find((r) => r !== config.version);

  if (!version) {
    error("There is no other release installed to roll back to.");
    return 1;
  }
  if (!releases.includes(version)) {
    error(`Release ${version} is not installed. Installed: ${releases.join(", ") || "none"}`);
    return 1;
  }

  heading("Rollback");
  field("From", config.version);
  field("To", version);
  note("The database is not touched. A release that ran migrations can only go back with its backup restored by hand.");

  const serviceUnits = config.service ?? unitNames();
  const managed = await unitsInstalled(serviceUnits);
  if (managed) systemctl("stop", serviceUnits);
  await site.pointCurrentAt(version);
  await site.patchConfig({ version, previousVersion: config.version });
  if (!managed) {
    success(`Now on ${version}.`);
    note("This site isn't run by systemd, so restart it yourself to pick up the change.");
    return 0;
  }
  systemctl("start", serviceUnits);
  if (await waitForHealth(config.port)) {
    success(`Xentium ${version} is running.`);
    return 0;
  }
  error(`${version} did not come up. ${color.bold(`journalctl -u ${serviceUnits.api} -n 50`)} will say why.`);
  return 1;
}

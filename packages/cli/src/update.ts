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
  MigrateError,
  exec,
  pendingMigrations,
  recordDeploy,
  resolveVersion,
  restore,
  waitForHealth,
  type DeployRecord,
} from "./release.js";
import { prefetch, releasePackages } from "./download.js";
import { silentReporter, type Reporter } from "./progress.js";
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
  /** Where progress goes: the updater's status file for an update the ACP asked for. */
  reporter?: Reporter;
  /** Refuse a release whose npm provenance can't be verified (the updater always does). */
  requireProvenance?: boolean;
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
  const report = options.reporter ?? silentReporter;
  const config = site.readConfig();
  const serviceUnits = config.service ?? unitNames();
  const managed = await unitsInstalled(serviceUnits);

  // ── 1. Which version ───────────────────────────────────────────────────────
  // A tarball only reveals its version once npm has unpacked it, so that path
  // installs first and checks after — the install itself changes nothing that
  // is running.
  heading("Update");
  report.step("check", "running");
  const spec = options.package ? `file:${options.package}` : await resolveVersion(options.version ?? "latest");
  if (!spec) {
    error(`Could not find ${options.version ?? "latest"} on the npm registry.`);
    report.step("check", "failed", `${options.version ?? "latest"} is not on the npm registry`);
    return 1;
  }
  field("Installed", config.version);
  if (!options.package) {
    field("Available", spec);
    const verdict = await verify(site, config.version, spec, options);
    if (verdict !== "go") {
      report.step("check", verdict === "done" ? "done" : "failed", verdict === "done" ? `already on ${spec}` : "refused, see the log");
      return verdict === "done" ? 0 : 1;
    }
  }
  report.step("check", "done");
  report.log(`▸ update ${config.version} → ${options.package ? "a local tarball" : spec}`);

  // ── 1b. Download our own packages first, so their progress can be shown ──────
  let ownPackages = 0;
  if (!options.package && options.reporter) {
    report.step("download", "running");
    try {
      const packages = await releasePackages(site, spec);
      ownPackages = packages.length;
      report.packages(packages);
      const all = await prefetch(packages, report);
      report.step("download", "done", all ? undefined : "some packages are fetched during the install");
    } catch (e) {
      // The install downloads everything itself: a failed prefetch only costs the progress bars.
      report.log(`! ${(e as Error).message}`);
      report.step("download", "skipped", "npm downloads the packages during the install");
    }
  } else {
    report.step("download", "skipped");
  }

  // ── 2. Install alongside ───────────────────────────────────────────────────
  heading(options.package ? "Installing" : `Installing ${spec}`);
  report.step("install", "running");
  let version: string;
  try {
    version = await installRelease(site, spec, { quiet: true });
  } catch (e) {
    error((e as Error).message);
    report.log((e as Error).message);
    report.step("install", "failed", "npm could not install the release");
    return 1;
  }
  success(`Installed into releases/${version}`);
  report.log(`✓ installed into releases/${version}`);
  if (options.reporter) {
    // Everything npm brought besides our own packages, for "and N other packages".
    const listed = await exec("npm", ["ls", "--all", "--parseable", "--omit=dev"], { cwd: site.releaseDir(version), quiet: true, timeout: 60_000 });
    const total = listed.output.split("\n").filter((l) => l.includes("node_modules")).length;
    report.otherPackages(Math.max(0, total - ownPackages));
  }
  report.step("install", "done");

  report.step("verify", "running");
  if (options.package) {
    // `npm audit signatures` would still pass here — it verifies the registry
    // dependencies around a tarball that never came from the registry. Saying
    // "provenance verified" for a file someone handed us would be a lie.
    note("Installed from a local tarball, so there is no npm provenance to check.");
    report.step("verify", "skipped", "a local tarball has no provenance");
  } else if (await checkProvenance(site, version) === "ok") {
    success("npm provenance verified");
    report.log("✓ npm provenance verified");
    report.step("verify", "done");
  } else if (options.requireProvenance) {
    // An update the ACP asked for installs only what our release workflow built.
    error("Could not verify npm provenance, so this update stops here. Nothing was changed.");
    report.step("verify", "failed", "npm provenance could not be verified");
    return 1;
  } else {
    note("Could not verify npm provenance — the registry didn't answer.");
    report.step("verify", "skipped", "the registry didn't answer");
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
  report.step("backup", "running");
  let dump: string | null = null;
  try {
    dump = await dumpDatabase(site, `pre-${version}`);
  } catch (e) {
    error((e as Error).message);
    report.step("backup", "failed", (e as Error).message);
    return 1;
  }
  if (dump) {
    success(`Database dumped to ${path.relative(site.root, dump)}`);
    report.backup(path.relative(site.root, dump));
    report.log(`✓ backup written: ${path.relative(site.root, dump)}`);
    report.step("backup", "done");
  } else if (options.skipBackup) {
    warning("pg_dump is not installed — continuing without a backup (--skip-backup).");
    report.step("backup", "skipped", "pg_dump is not installed");
  } else {
    error("pg_dump is not installed, so there would be nothing to roll back to.");
    note("Install the PostgreSQL client tools, or run again with --skip-backup.");
    report.step("backup", "failed", "pg_dump is not installed");
    return 1;
  }

  // ── 5. Swap ────────────────────────────────────────────────────────────────
  heading("Switching over");
  const previous = config.version;
  // Asked while the site is still up: if we cannot tell, nothing has been touched yet.
  let hadMigrations: boolean;
  let toApply: string[] = [];
  try {
    const pending = await pendingMigrations(site, version);
    hadMigrations = pending !== null;
    toApply = pending ?? [];
  } catch (e) {
    error((e as Error).message);
    note(`Nothing was changed. ${previous} is still running.`);
    report.step("migrate", "failed", "could not read the migration status");
    return 1;
  }
  report.migrations(toApply);
  if (managed) systemctl("stop", serviceUnits);
  let applying: string | null = null;

  // What `migrate deploy` said and when, for Migration History. Only a run that
  // actually migrated is recorded: an update with nothing to apply is not a deploy.
  let deploy: DeployRecord | null = null;
  try {
    if (hadMigrations) {
      report.step("migrate", "running");
      const startedAt = new Date();
      try {
        const output = await migrate(site, version, {
          quiet: true,
          onApplying: (name) => {
            if (applying) report.migration(applying, "done");
            applying = name;
            report.migration(name, "running");
          },
        });
        deploy = { status: "completed", version, output, startedAt, completedAt: new Date() };
      } catch (e) {
        const output = e instanceof MigrateError ? e.output : (e as Error).message;
        deploy = { status: "failed", version, output, startedAt, completedAt: new Date() };
        if (applying) report.migration(applying, "failed");
        report.log(output.trim().split("\n").slice(-12).join("\n"));
        report.step("migrate", "failed", applying ? `${applying} failed` : "prisma migrate deploy failed");
        throw e;
      }
      for (const name of toApply) report.migration(name, "done");
      success("Migrations applied");
      report.log(`✓ ${toApply.length || "the"} migration${toApply.length === 1 ? "" : "s"} applied`);
      report.step("migrate", "done");
    } else {
      note("No pending migrations.");
      report.step("migrate", "skipped", "nothing to apply");
    }
    await site.pointCurrentAt(version);
    await site.patchConfig({ version, previousVersion: previous });
    success(`current → releases/${version}`);
  } catch (e) {
    error((e as Error).message);
    // Restore while nothing is running, then bring the old release back up.
    if (hadMigrations && dump) {
      report.step("restore", "running");
      report.step("restore", (await restoreQuietly(site, dump)) ? "done" : "failed");
    }
    // After the restore, which rewinds the whole database — history table included.
    if (deploy) await recordQuietly(site, deploy);
    report.step("switch-back", "running");
    await rollTo(site, previous, serviceUnits, managed);
    report.step("switch-back", "done", `back on ${previous}`);
    report.log(`▸ rolled back to ${previous}`);
    await report.finish("rolled-back", (e as Error).message.split("\n")[0]);
    return 1;
  }

  if (!managed) {
    if (deploy) await recordQuietly(site, deploy);
    line();
    success(`Updated to ${version}.`);
    note("This site isn't run by systemd, so restart it yourself to pick up the new release.");
    return 0;
  }

  // ── 6. Health check ────────────────────────────────────────────────────────
  report.step("restart", "running");
  systemctl("start", serviceUnits);
  report.step("restart", "done");
  report.step("health", "running");
  const healthy = await waitForHealth(config.port);
  if (healthy) {
    if (deploy) await recordQuietly(site, deploy);
    line();
    success(`Xentium ${version} is running.`);
    note(`Rolled something back? \`xentium rollback\` returns to ${previous}.`);
    report.step("health", "done");
    report.log(`✓ Xentium ${version} is running`);
    await report.finish("done");
    return 0;
  }
  report.step("health", "failed", `${version} did not come up within 60 seconds`);

  error(`${version} did not come up within 60 seconds. Rolling back to ${previous}.`);
  systemctl("stop", serviceUnits);
  if (hadMigrations && dump) report.step("restore", "running");
  const restored = hadMigrations && dump ? await restoreQuietly(site, dump) : false;
  if (hadMigrations && dump) report.step("restore", restored ? "done" : "failed");
  // The migrations applied, but the deploy as a whole did not stand — say so,
  // and say truthfully what happened to the database.
  if (deploy) {
    await recordQuietly(site, {
      ...deploy,
      status: "failed",
      output: `${deploy.output}\n\nerror: ${version} did not come up after migrating, so the update was rolled back to ${previous}. ${
        restored ? "The database was restored from the backup taken before the update." : "The database could NOT be restored automatically."}`,
    });
  }
  report.step("switch-back", "running");
  await rollTo(site, previous, serviceUnits, managed);
  if (await waitForHealth(config.port, 60_000)) {
    success(`Back on ${previous}.`);
    report.step("switch-back", "done", `back on ${previous}`);
  } else {
    error(`${previous} did not come back up either. The logs are in \`journalctl -u ${serviceUnits.api}\`.`);
    report.step("switch-back", "failed", `${previous} did not come back up either`);
  }
  await report.finish("rolled-back", `${version} did not come up after the update`);
  return 1;
}

async function rollTo(site: Site, version: string, units: { api: string; worker: string }, managed: boolean): Promise<void> {
  await site.pointCurrentAt(version).catch(() => null);
  await site.patchConfig({ version }).catch(() => null);
  if (managed) systemctl("start", units);
}

async function restoreQuietly(site: Site, dump: string): Promise<boolean> {
  warning(`Restoring the database from ${path.relative(site.root, dump)} — migrations had already run.`);
  try {
    await restore(site, dump);
    success("Database restored.");
    return true;
  } catch (e) {
    error(`Could not restore automatically: ${(e as Error).message}`);
    note(`Restore it by hand: psql "$DATABASE_URL" -f ${dump}`);
    return false;
  }
}

/** Record the deploy in Migration History; a note, never a failure, if it cannot. */
async function recordQuietly(site: Site, deploy: DeployRecord): Promise<void> {
  if (!(await recordDeploy(site, deploy).catch(() => false))) {
    note("Could not record this deploy in ACP → System → Migration History (psql unavailable or the write failed).");
  }
}

export async function rollback(site: Site, target?: string, reporter?: Reporter): Promise<number> {
  const report = reporter ?? silentReporter;
  const config = site.readConfig();
  const releases = await site.releases();
  const version = target ?? config.previousVersion ?? releases.find((r) => r !== config.version);

  if (!version) {
    error("There is no other release installed to roll back to.");
    report.step("switch-back", "failed", "no other release is installed");
    return 1;
  }
  if (!releases.includes(version)) {
    error(`Release ${version} is not installed. Installed: ${releases.join(", ") || "none"}`);
    report.step("switch-back", "failed", `release ${version} is not installed`);
    return 1;
  }

  heading("Rollback");
  field("From", config.version);
  field("To", version);
  note("The database is not touched. A release that ran migrations can only go back with its backup restored by hand.");

  const serviceUnits = config.service ?? unitNames();
  const managed = await unitsInstalled(serviceUnits);
  report.step("switch-back", "running");
  if (managed) systemctl("stop", serviceUnits);
  await site.pointCurrentAt(version);
  await site.patchConfig({ version, previousVersion: config.version });
  report.step("switch-back", "done", `current → releases/${version}`);
  if (!managed) {
    success(`Now on ${version}.`);
    note("This site isn't run by systemd, so restart it yourself to pick up the change.");
    report.step("restart", "skipped", "not run by systemd");
    return 0;
  }
  report.step("restart", "running");
  systemctl("start", serviceUnits);
  report.step("restart", "done");
  report.step("health", "running");
  if (await waitForHealth(config.port)) {
    success(`Xentium ${version} is running.`);
    report.step("health", "done");
    return 0;
  }
  error(`${version} did not come up. ${color.bold(`journalctl -u ${serviceUnits.api} -n 50`)} will say why.`);
  report.step("health", "failed", `${version} did not come up`);
  return 1;
}

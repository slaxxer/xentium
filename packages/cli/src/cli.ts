/**
 * `xentium` — the CLI you keep after the install.
 *
 * It works on a site directory made by `npm create xentium`: `xentium.json` at
 * the top, releases underneath, `shared/` for everything an update must not
 * touch. Run it from anywhere inside the site, or point at one with --site.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { runChecks, worst, type Check } from "./checks.js";
import { backup as dumpDatabase, installedVersion, waitForHealth } from "./release.js";
import { resetTwoFactor } from "./account.js";
import { findSite, type Site } from "./site.js";
import { installUnits, installUpdater, runForeground, systemctl, unitNames, unitState, unitsInstalled } from "./service.js";
import { rollback, update } from "./update.js";
import { FileReporter, type RunStatus } from "./progress.js";
import { STATUS_FILE, runUpdater } from "./updater.js";
import { color, error, field, heading, info, json, line, note, printChecks, success, warning } from "./ui.js";

const HELP = `
${color.bold("xentium")} — run and update a Xentium site

  ${color.bold("xentium start")}              start the site (systemd units, or in the foreground)
  ${color.bold("xentium stop")}               stop it
  ${color.bold("xentium restart")}            stop and start
  ${color.bold("xentium status")}             version, processes, database, disk
  ${color.bold("xentium doctor")}             check this machine and this install
  ${color.bold("xentium backup")}             dump the database into shared/backups
  ${color.bold("xentium update")} [version]   install a release, migrate, switch over
  ${color.bold("xentium rollback")} [version] go back to the release you were on
  ${color.bold("xentium install-service")}    install (or rewrite) the systemd units and the updater
  ${color.bold("xentium reset-2fa")} <email|username>
                             turn off two-factor sign-in for an account locked out of it
  ${color.bold("xentium updater")}            run an update the ACP asked for (started by systemd)

Options
  --site <dir>    the site to act on (default: the one you're standing in)
  --json          machine-readable output (status, doctor)
  --foreground    start in this terminal even when units are installed
  --package <tgz> update from a packed tarball instead of the registry
  --force         update past a plugin that says it doesn't support the version
  --skip-backup   update without pg_dump
  --dry-run       install the release but don't switch to it
  -h, --help      this
  -v, --version   the CLI's own version

Docs: https://doc.xentium.org
`;

interface Args {
  command: string;
  rest: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) { rest.push(arg); continue; }
    const [name, inline] = arg.replace(/^--?/, "").split("=", 2);
    // Flags that take a value: --site <dir>. Everything else is a switch.
    if (inline !== undefined) flags[name!] = inline;
    else if ((name === "site" || name === "package" || name === "report") && argv[i + 1] && !argv[i + 1]!.startsWith("-")) flags[name] = argv[++i]!;
    else flags[name!] = true;
  }
  return { command: rest.shift() ?? "", rest, flags };
}

/** Every command but `--help` needs a site; say how to make one if there isn't. */
function requireSite(flags: Args["flags"]): Site {
  const site = findSite(typeof flags.site === "string" ? flags.site : undefined);
  if (!site) {
    error("No Xentium site here.");
    note("Run this inside a site directory, pass --site <dir>, or make one with:");
    note("  npm create xentium@latest my-community");
    process.exit(1);
  }
  return site;
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function start(site: Site, flags: Args["flags"]): Promise<number> {
  const config = site.readConfig();
  const units = config.service ?? unitNames();
  if (!flags.foreground && (await unitsInstalled(units))) {
    if (!systemctl("start", units)) return 1;
    const healthy = await waitForHealth(config.port);
    if (!healthy) {
      error(`Started, but nothing answered on port ${config.port} within 60 seconds.`);
      note(`journalctl -u ${units.api} -n 50`);
      return 1;
    }
    success(`Xentium ${config.version} is running at ${config.url}`);
    return 0;
  }
  info(`Starting Xentium ${config.version} in this terminal. Ctrl-C stops it.`);
  info(`${color.dim("→")} ${config.url}`);
  line();
  return runForeground(site);
}

async function stop(site: Site): Promise<number> {
  const config = site.readConfig();
  const units = config.service ?? unitNames();
  if (!(await unitsInstalled(units))) {
    warning("This site has no systemd units, so there is nothing for me to stop.");
    note("A foreground `xentium start` stops with Ctrl-C.");
    return 0;
  }
  if (!systemctl("stop", units)) return 1;
  success("Stopped.");
  return 0;
}

async function status(site: Site, flags: Args["flags"]): Promise<number> {
  const config = site.readConfig();
  const units = config.service ?? unitNames();
  const managed = await unitsInstalled(units);
  const releases = await site.releases();
  const current = site.currentRelease();
  const running = await waitForHealth(config.port, 2000);
  const states = managed
    ? { api: await unitState(units.api), worker: await unitState(units.worker) }
    : null;
  const packageVersion = current ? await installedVersion(site, current) : null;

  if (flags.json) {
    json({ root: site.root, url: config.url, port: config.port, version: packageVersion ?? config.version,
           current, releases, running, service: states, docker: config.docker ?? false });
    return running ? 0 : 1;
  }

  heading(`Xentium at ${site.root}`);
  field("Version", packageVersion ?? config.version);
  field("Address", config.url);
  field("Responding", running ? color.green("yes") : color.red(`no (nothing on port ${config.port})`));
  if (states) {
    field("API", states.api === "active" ? color.green(states.api) : color.red(states.api));
    field("Worker", states.worker === "active" ? color.green(states.worker) : color.red(states.worker));
  } else {
    field("Service", "not installed as a service — started by hand");
  }
  field("Releases", releases.map((r) => (r === current ? color.bold(`${r} ←`) : color.dim(r))).join("  ") || "none");
  if (config.docker) field("Database", "PostgreSQL and Redis in Docker Compose");

  // A release directory that `current` doesn't point at is normal (that's how
  // rollback stays instant); a mismatch with xentium.json is not.
  if (current && current !== config.version) {
    line();
    warning(`xentium.json says ${config.version}, but current points at ${current}.`);
  }
  return running ? 0 : 1;
}

async function doctor(site: Site | null, flags: Args["flags"]): Promise<number> {
  const env = site?.readEnv() ?? {};
  const config = site ? site.readConfig() : null;
  const checks: Check[] = await runChecks({
    ...(site ? { target: site.root } : {}),
    expectEmpty: false,
    ...(env.DATABASE_URL ? { databaseUrl: env.DATABASE_URL } : {}),
    ...(env.REDIS_URL ? { redisUrl: env.REDIS_URL } : {}),
    ...(env.LICENSE_SERVER_URL ? { marketplaceUrl: env.LICENSE_SERVER_URL } : {}),
    ...(config?.docker ? { docker: true } : {}),
  });

  if (flags.json) {
    json({ status: worst(checks), checks });
    return worst(checks) === "fail" ? 1 : 0;
  }

  heading(site ? `Checking ${site.root}` : "Checking this machine");
  printChecks(checks);
  line();
  const overall = worst(checks);
  if (overall === "fail") error("Something needs fixing before Xentium will run properly.");
  else if (overall === "warn") warning("Everything works; the notes above are worth a look.");
  else success("All good.");
  return overall === "fail" ? 1 : 0;
}

async function backup(site: Site): Promise<number> {
  heading("Backup");
  const file = await dumpDatabase(site, "manual").catch((e: Error) => {
    error(e.message);
    return undefined;
  });
  if (file === undefined) return 1;
  if (file === null) {
    error("pg_dump is not installed, so there is nothing to dump with.");
    note("Install the PostgreSQL client tools for your system, then run this again.");
    return 1;
  }
  const { size } = await fs.stat(file);
  success(`${path.relative(site.root, file)} · ${(size / 1024 ** 2).toFixed(1)} MB`);
  return 0;
}

async function resetTwoFactorCommand(site: Site, who: string | undefined): Promise<number> {
  heading("Reset two-factor sign-in");
  if (!who) {
    error("Name the account: xentium reset-2fa <email or username>");
    return 1;
  }
  const result = await resetTwoFactor(site, who);
  if (!result.ok) {
    error(result.reason);
    return 1;
  }
  if (result.usernames.length === 0) {
    error(`No account has the email or username "${who}".`);
    return 1;
  }
  success(`Two-factor sign-in is off for ${result.usernames.join(", ")}, and their sessions have ended.`);
  note("They sign in with their password now, and should turn two-factor sign-in on again in their account settings.");
  return 0;
}

async function installService(site: Site): Promise<number> {
  const config = site.readConfig();
  const units = config.service ?? unitNames();
  if (!(await installUnits(site, units))) {
    error("The units were not installed.");
    return 1;
  }
  await site.patchConfig({ service: units });
  if (!(await installUpdater(site, units))) {
    warning("The updater was not installed, so updates run from this terminal only.");
  }
  note(`Start it with \`xentium start\`, or \`sudo systemctl start ${units.api}\`.`);
  return 0;
}

/**
 * `update`, and, with `--report=<run id>` (the updater's hand-over), writing its
 * progress into the run the updater opened. Such a run only installs what npm
 * provenance proves our release workflow built.
 */
async function reportedUpdate(site: Site, rest: string[], flags: Record<string, string | boolean>): Promise<number> {
  const options = {
    ...(rest[0] ? { version: rest[0] } : {}),
    ...(typeof flags.package === "string" ? { package: path.resolve(flags.package) } : {}),
    force: !!flags.force,
    skipBackup: !!flags["skip-backup"],
    dryRun: !!flags["dry-run"],
  };
  if (typeof flags.report !== "string") return update(site, options);

  const file = path.join(site.runDir, STATUS_FILE);
  let opened: RunStatus | null = null;
  try { opened = JSON.parse(await fs.readFile(file, "utf8")) as RunStatus; } catch { /* the updater writes it first */ }
  const config = site.readConfig();
  const report = FileReporter.open(file, {
    id: flags.report, action: "update", from: opened?.from ?? config.version, to: rest[0] ?? "latest",
    requestedBy: opened?.requestedBy ?? null, startedAt: opened?.startedAt ?? new Date().toISOString(),
  });
  const code = await update(site, { ...options, reporter: report, requireProvenance: true });
  if (report.snapshot.state === "running") {
    const failed = report.snapshot.steps.find((s) => s.state === "failed");
    await report.finish(code === 0 ? "done" : "failed", code === 0 ? undefined : failed?.note ?? "the update did not complete");
  }
  return code;
}

// ── Entry ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const { command, rest, flags } = parseArgs(process.argv.slice(2));

  if (flags.version || flags.v) {
    const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    line(pkg.version);
    return 0;
  }
  if (!command || flags.help || flags.h) {
    line(HELP.trim());
    return command ? 0 : 1;
  }

  switch (command) {
    case "start":           return start(requireSite(flags), flags);
    case "stop":            return stop(requireSite(flags));
    case "restart":         { const site = requireSite(flags); await stop(site); return start(site, flags); }
    case "status":          return status(requireSite(flags), flags);
    // The only command that works without a site: "why can't I install this?"
    case "doctor":          return doctor(findSite(typeof flags.site === "string" ? flags.site : undefined), flags);
    case "backup":          return backup(requireSite(flags));
    case "update":          return reportedUpdate(requireSite(flags), rest, flags);
    case "updater":         return runUpdater(requireSite(flags));
    case "rollback":        return rollback(requireSite(flags), rest[0]);
    case "install-service": return installService(requireSite(flags));
    case "reset-2fa":       return resetTwoFactorCommand(requireSite(flags), rest[0]);
    default:
      error(`Unknown command: ${command}`);
      line(HELP.trim());
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    error((e as Error).message || String(e));
    process.exit(1);
  });

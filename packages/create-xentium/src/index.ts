/**
 * `npm create xentium@latest my-community`
 *
 * Checks the machine, sets up a database, installs the release and hands over to
 * the install wizard in the browser. Everything it knows about what a server
 * needs comes from SYSTEM_REQUIREMENTS, the same numbers the wizard checks
 * against, and the checks themselves are the ones `xentium doctor` runs.
 *
 * It never installs system packages. When something is missing it prints the
 * command for the machine it is standing on and stops — the shell installer at
 * get.xentium.org is the one that may install things, with consent.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { runChecks, worst, type Check } from "../../cli/src/checks.js";
import { installRelease, resolveVersion, waitForHealth } from "../../cli/src/release.js";
import { installUnits, runForeground, systemctl, unitNames, unitsInstalled } from "../../cli/src/service.js";
import { Site, mergeEnv } from "../../cli/src/site.js";
import { exec } from "../../cli/src/release.js";
import { color, error, heading, info, json, line, logo, note, printChecks, success, warning } from "../../cli/src/ui.js";
import { startDatabases, type DatabaseSetup } from "./compose.js";
import { ask, choose, closePrompts, confirm, isAutomatic, setAutomatic } from "./prompt.js";

const HELP = `
${color.bold("npm create xentium@latest")} [directory]

Installs Xentium into a directory and opens the install wizard.

  --yes                 take every default; never ask
  --check               run the checks and stop
  --json                machine-readable check output (with --check)
  --port <n>            the port the app listens on (default 4000)
  --url <address>       where people will reach the site
  --database-url <url>  use your own PostgreSQL instead of Docker
  --redis-url <url>     use your own Redis instead of Docker
  --docker              use Docker for PostgreSQL and Redis
  --no-docker           don't; ask for connection URLs instead
  --version <spec>      a version or dist-tag of @xentium/server (default latest)
  --package <path>      install the app from a packed tarball instead of the registry
  --cli <spec>          which \`xentium\` CLI the site depends on (default latest)
  --no-service          don't offer to install systemd units
  -h, --help            this

Docs: https://doc.xentium.org
`;

interface Options {
  target?: string;
  yes: boolean;
  check: boolean;
  json: boolean;
  port?: number;
  url?: string;
  databaseUrl?: string;
  redisUrl?: string;
  docker?: boolean;
  version?: string;
  package?: string;
  cli?: string;
  service: boolean;
  help: boolean;
}

function parse(argv: string[]): Options {
  const options: Options = { yes: false, check: false, json: false, service: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) { options.target ??= arg; continue; }
    const [raw, inline] = arg.replace(/^--?/, "").split("=", 2);
    const name = raw!;
    const value = () => inline ?? argv[++i] ?? "";
    switch (name) {
      case "yes": case "y":    options.yes = true; break;
      case "check":            options.check = true; break;
      case "json":             options.json = true; break;
      case "port":             options.port = Number.parseInt(value(), 10); break;
      case "url":              options.url = value(); break;
      case "database-url":     options.databaseUrl = value(); options.docker = false; break;
      case "redis-url":        options.redisUrl = value(); options.docker = false; break;
      case "docker":           options.docker = true; break;
      case "no-docker":        options.docker = false; break;
      case "version":          options.version = value(); break;
      case "package":          options.package = path.resolve(value()); break;
      case "cli":              options.cli = value(); break;
      case "no-service":       options.service = false; break;
      case "help": case "h":   options.help = true; break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function banner(): void {
  logo("The open-source community platform · https://doc.xentium.org");
}

/** A Compose project name docker accepts: lowercase, no spaces. */
function projectName(dir: string): string {
  const base = path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  return `xentium-${base || "site"}`;
}

export async function main(argv: string[]): Promise<number> {
  let options: Options;
  try {
    options = parse(argv);
  } catch (e) {
    error((e as Error).message);
    return 1;
  }
  if (options.help) { line(HELP.trim()); return 0; }
  if (options.yes) setAutomatic(true);
  if (!options.json) banner();

  try {
    return await install(options);
  } finally {
    closePrompts();
  }
}

async function install(options: Options): Promise<number> {
  // ── Where ──────────────────────────────────────────────────────────────────
  const target = path.resolve(options.target ?? (options.check ? "." : await ask("Where should Xentium go?", "xentium")));
  const site = new Site(target);

  const existing = await fs.readFile(site.configFile, "utf8").catch(() => null);
  if (existing && !options.check) {
    error(`${target} is already a Xentium site.`);
    note("Update it with `xentium update`, or pick another directory.");
    return 1;
  }

  const port = options.port ?? Number.parseInt(await ask("Which port should the app listen on?", "4000"), 10);
  const url = (options.url ?? await ask("What address will people use?", `http://localhost:${port}`)).replace(/\/+$/, "");

  // ── Database ───────────────────────────────────────────────────────────────
  const bringYourOwn = options.databaseUrl !== undefined || options.redisUrl !== undefined;
  const useDocker = options.docker ?? (bringYourOwn ? false : await choose("How should PostgreSQL and Redis be set up?", [
    { value: true, label: "Docker", hint: "we write a compose file and run them for you" },
    { value: false, label: "I already have them", hint: "you give us the connection URLs" },
  ]));

  let databaseUrl = options.databaseUrl;
  let redisUrl = options.redisUrl;
  if (!useDocker) {
    databaseUrl ??= await ask("PostgreSQL connection URL", "postgresql://xentium:xentium@localhost:5432/xentium");
    redisUrl ??= await ask("Redis connection URL", "redis://localhost:6379");
  }

  // ── Checks ─────────────────────────────────────────────────────────────────
  // On the Docker path the database doesn't exist yet, so it can't be tested
  // here — the engine, Compose and the ports are what we can know in advance.
  const checks: Check[] = await runChecks({
    target,
    expectEmpty: !options.check,
    port,
    docker: useDocker,
    dockerPorts: [],
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(redisUrl ? { redisUrl } : {}),
    skipService: !options.service,
  });

  if (options.json) {
    json({ status: worst(checks), checks });
    return worst(checks) === "fail" ? 1 : 0;
  }

  heading("Checking this server");
  printChecks(checks);
  line();

  if (worst(checks) === "fail") {
    error("Xentium can't be installed until the ✗ items above are sorted out.");
    return 1;
  }
  if (options.check) {
    success(worst(checks) === "warn" ? "Ready to install (see the notes above)." : "Ready to install.");
    return 0;
  }
  if (worst(checks) === "warn" && !await confirm("Carry on anyway?", true)) return 1;

  // ── Layout ─────────────────────────────────────────────────────────────────
  heading("Setting up");
  await site.ensureDirs();
  info(`Site directory ${color.dim(target)}`);

  // ── Database ───────────────────────────────────────────────────────────────
  let docker = false;
  if (useDocker) {
    info("Starting PostgreSQL and Redis with Docker Compose…");
    let setup: DatabaseSetup;
    try {
      setup = await startDatabases(site, projectName(target));
    } catch (e) {
      error((e as Error).message);
      return 1;
    }
    databaseUrl = setup.databaseUrl;
    redisUrl = setup.redisUrl;
    docker = true;
    success(`PostgreSQL on 127.0.0.1:${setup.postgresPort}, Redis on 127.0.0.1:${setup.redisPort}`);
  }

  // ── Configuration ──────────────────────────────────────────────────────────
  // The secrets are not written here: the install wizard generates them, and one
  // of them is an argon2 hash, which needs the app's own native module.
  const envValues: Record<string, string> = {
    NODE_ENV: "production",
    PORT: String(port),
    APP_URL: url,
    DATABASE_URL: databaseUrl!,
    REDIS_URL: redisUrl!,
    UPLOAD_DIR: site.uploadsDir,
    DATA_DIR: site.dataDir,
  };
  const previousEnv = await fs.readFile(site.envFile, "utf8").catch(() => "");
  await fs.writeFile(site.envFile, mergeEnv(
    previousEnv || "# Xentium configuration. Updates never touch this file.\n",
    envValues,
  ), { mode: 0o600 });
  success(`Wrote ${path.relative(target, site.envFile)}`);

  // ── The release ────────────────────────────────────────────────────────────
  const spec = options.package ? `file:${options.package}` : (await resolveVersion(options.version ?? "latest"));
  if (!spec) {
    error(`Could not find @xentium/server@${options.version ?? "latest"} on the npm registry.`);
    return 1;
  }
  heading(`Installing Xentium${options.package ? "" : ` ${spec}`}`);
  info("This downloads the app and its dependencies — it takes a minute.");
  let version: string;
  try {
    version = await installRelease(site, spec, { quiet: true });
  } catch (e) {
    error((e as Error).message);
    return 1;
  }
  await site.pointCurrentAt(version);
  await site.writeConfig({ version, port, url, docker });
  success(`Xentium ${version} installed`);

  await installCliLocally(site, options);

  // ── Running it ─────────────────────────────────────────────────────────────
  const units = unitNames();
  const wantsService = options.service
    && process.platform === "linux"
    && !(await unitsInstalled(units))
    && await confirm("Install systemd units so Xentium starts on boot?", true);

  if (wantsService) {
    if (await installUnits(site, units)) {
      await site.patchConfig({ service: units });
      systemctl("start", units);
      if (await waitForHealth(port)) {
        finish(site, url, version, docker, true);
        return 0;
      }
      warning(`Started, but nothing answered on port ${port} yet.`);
      note(`Have a look with: journalctl -u ${units.api} -n 50`);
      return 1;
    }
    warning("The units were not installed — you can do it later with `xentium install-service`.");
  }

  finish(site, url, version, docker, false);

  if (!isAutomatic() && await confirm("Start Xentium now, in this terminal?", true)) {
    line();
    info(`Open ${color.bold(`${url}/install`)} — Ctrl-C stops the server.`);
    line();
    return runForeground(site);
  }
  return 0;
}

/**
 * The site depends on the `xentium` CLI, so `npx xentium` inside the directory
 * runs the version that goes with this install, and nothing has to be installed
 * globally.
 */
async function installCliLocally(site: Site, options: Options): Promise<void> {
  const spec = options.cli ?? "latest";
  await fs.writeFile(path.join(site.root, "package.json"), `${JSON.stringify({
    name: path.basename(site.root).toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "xentium-site",
    version: "1.0.0",
    private: true,
    description: "A Xentium site. `npx xentium --help` says what you can do with it.",
    dependencies: { xentium: spec },
  }, null, 2)}\n`);

  const result = await exec("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel", "error"], {
    cwd: site.root, quiet: true,
  });
  if (result.code === 0) success("The `xentium` command is installed in the site");
  else warning("Could not install the `xentium` CLI here — `npm install -g xentium` also works.");
}

function finish(site: Site, url: string, version: string, docker: boolean, running: boolean): void {
  heading("Done");
  line(`  Xentium ${color.bold(version)} is installed in ${color.bold(site.root)}.`);
  line();
  if (running) {
    line(`  ${color.green("→")} Finish the install at ${color.bold(`${url}/install`)}`);
  } else {
    line(`  Start it:            ${color.bold(`cd ${site.root} && npx xentium start`)}`);
    line(`  Then finish at:      ${color.bold(`${url}/install`)}`);
  }
  line();
  line(`  ${color.dim("Config")}    ${path.relative(site.root, site.envFile)}`);
  line(`  ${color.dim("Uploads")}   ${path.relative(site.root, site.uploadsDir)}`);
  if (docker) {
    line(`  ${color.dim("Database")}  ${path.relative(site.root, site.composeFile)} ${color.dim("(docker compose; data in named volumes)")}`);
  }
  line(`  ${color.dim("Docs")}      https://doc.xentium.org`);
  line();
}

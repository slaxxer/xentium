/**
 * Running the two processes: as systemd units on Linux, or in the foreground
 * anywhere else.
 *
 * The units point their WorkingDirectory through the `current` symlink, so a
 * restart after an update picks up the new release without rewriting any unit.
 */
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "./checks.js";
import type { Site } from "./site.js";
import { color, info, line, success } from "./ui.js";

export interface UnitNames { api: string; worker: string }

export function unitNames(prefix = "xentium"): UnitNames {
  return { api: `${prefix}-api`, worker: `${prefix}-worker` };
}

/** Does this machine run systemd, and does it know these units? */
export async function unitsInstalled(units: UnitNames): Promise<boolean> {
  if (process.platform !== "linux") return false;
  const out = await run("systemctl", ["list-unit-files", `${units.api}.service`, "--no-legend"]);
  return !!out && out.includes(units.api);
}

export function unitFile(site: Site, kind: "api" | "worker", user: string): string {
  const entry = kind === "api" ? "dist/server.js" : "dist/worker.js";
  const title = kind === "api" ? "API" : "background worker";
  return `[Unit]
Description=Xentium ${title} (${site.root})
Documentation=https://doc.xentium.org
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
# Through the symlink on purpose: a restart after an update runs the new release.
WorkingDirectory=${site.workingDir()}
Environment=NODE_ENV=production
Environment=XENTIUM_ENV_FILE=${site.envFile}
ExecStart=${process.execPath} ${entry}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${kind === "api" ? "xentium-api" : "xentium-worker"}

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=${site.sharedDir}

[Install]
WantedBy=multi-user.target
`;
}

/** Run something that needs root, through sudo unless we already are root. */
export function sudo(args: string[], opts: { quiet?: boolean } = {}): boolean {
  const root = process.getuid?.() === 0;
  const [cmd, ...rest] = root ? args : ["sudo", ...args];
  const result = spawnSync(cmd!, rest, { stdio: opts.quiet ? "ignore" : "inherit" });
  return result.status === 0;
}

/**
 * Write both units, reload systemd and enable them. Needs root, so it asks for
 * sudo — and says what it is about to do first, because a CLI that silently
 * escalates is a CLI nobody should run.
 */
export async function installUnits(site: Site, units: UnitNames): Promise<boolean> {
  const user = os.userInfo().username;
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "xentium-units-"));
  const files: Array<[string, string]> = [
    [path.join(staging, `${units.api}.service`), unitFile(site, "api", user)],
    [path.join(staging, `${units.worker}.service`), unitFile(site, "worker", user)],
  ];
  for (const [file, content] of files) await fs.writeFile(file, content);

  line();
  info(`Installing two systemd units as ${color.bold(user)}:`);
  info(`  /etc/systemd/system/${units.api}.service`);
  info(`  /etc/systemd/system/${units.worker}.service`);
  info(color.dim("sudo will ask for your password."));
  line();

  const installed =
    sudo(["install", "-m", "644", files[0]![0], files[1]![0], "/etc/systemd/system/"]) &&
    sudo(["systemctl", "daemon-reload"]) &&
    sudo(["systemctl", "enable", `${units.api}.service`, `${units.worker}.service`], { quiet: true });

  await fs.rm(staging, { recursive: true, force: true });
  if (installed) success(`Installed ${units.api} and ${units.worker}, enabled at boot.`);
  return installed;
}

export async function unitState(unit: string): Promise<string> {
  return (await run("systemctl", ["is-active", `${unit}.service`])) ?? "unknown";
}

export function systemctl(action: "start" | "stop" | "restart", units: UnitNames): boolean {
  return sudo(["systemctl", action, `${units.api}.service`, `${units.worker}.service`]);
}

/**
 * No systemd: run both processes here and stream their output, prefixed. Ctrl-C
 * stops both. This is the "trying it out" mode — on a real server the units are
 * what keeps the site up.
 */
export async function runForeground(site: Site): Promise<number> {
  const cwd = site.workingDir();
  const env = site.processEnv();
  const children = (["server", "worker"] as const).map((which) => {
    const child = spawn(process.execPath, [`dist/${which}.js`], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const tag = color.dim(which === "server" ? "api    │" : "worker │");
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      let buffer = "";
      stream.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const l of lines) line(`${tag} ${l}`);
      });
    }
    return child;
  });

  const stopAll = () => { for (const c of children) c.kill("SIGTERM"); };
  process.on("SIGINT", stopAll);
  process.on("SIGTERM", stopAll);

  // Whichever process exits first takes the other down: running one half of
  // Xentium looks like it works and quietly stops processing jobs.
  const code = await new Promise<number>((resolve) => {
    for (const child of children) {
      child.on("exit", (status) => {
        stopAll();
        resolve(status ?? 1);
      });
    }
  });
  return code;
}

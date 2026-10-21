/**
 * `xentium updater` — runs the update the ACP asked for.
 *
 * The web process never updates anything. When an admin presses Update now, the
 * API writes `shared/run/update-request.json` and nothing else. A systemd path
 * unit (installed by `xentium install-service`) notices the file and starts this
 * command as the site's user. It:
 *
 *   1. claims the request (renames it, so the path unit doesn't fire again),
 *   2. checks it: a known action, a real version, never a downgrade (update()
 *      refuses those), and only a release npm provenance proves we built,
 *   3. installs the new CLI first, because the updater's own fixes ship in it,
 *   4. hands over to that CLI for the update, which writes its progress into
 *      `shared/run/update-status.json` for the ACP to show,
 *   5. finishes the status file itself if the update stopped without doing so.
 *
 * So a compromised web process can at most ask for a newer, signed Xentium.
 */
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { exec } from "./release.js";
import { FileReporter, type RunStatus } from "./progress.js";
import type { Site } from "./site.js";
import { rollback } from "./update.js";
import { error, info, success } from "./ui.js";

export const REQUEST_FILE = "update-request.json";
export const STATUS_FILE = "update-status.json";
export const UPDATER_MARKER = "updater.json";

export interface UpdateRequest {
  v: 1;
  id: string;
  action: "update" | "rollback";
  /** The version to update to; for a rollback, the release to go back to (optional). */
  version?: string;
  requestedBy: { id: string; username: string };
  requestedAt: string;
}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ID = /^[0-9A-Za-z-]{8,64}$/;

/** Read and check a request; null with a reason when it isn't one we act on. */
export function parseRequest(raw: string): { request: UpdateRequest } | { reason: string } {
  let r: Partial<UpdateRequest>;
  try { r = JSON.parse(raw) as Partial<UpdateRequest>; } catch { return { reason: "the request is not JSON" }; }
  if (r.v !== 1 || typeof r.id !== "string" || !ID.test(r.id)) return { reason: "the request has no valid id" };
  if (r.action !== "update" && r.action !== "rollback") return { reason: `unknown action ${String(r.action)}` };
  if (r.action === "update" && (typeof r.version !== "string" || !VERSION.test(r.version))) return { reason: "the request names no valid version" };
  if (r.action === "rollback" && r.version !== undefined && (typeof r.version !== "string" || !VERSION.test(r.version))) return { reason: "the request names no valid version" };
  const by = r.requestedBy;
  if (!by || typeof by.id !== "string" || typeof by.username !== "string") return { reason: "the request says nobody asked for it" };
  return { request: { v: 1, id: r.id, action: r.action, ...(r.version ? { version: r.version } : {}), requestedBy: { id: by.id, username: by.username }, requestedAt: String(r.requestedAt ?? new Date().toISOString()) } };
}

export async function runUpdater(site: Site): Promise<number> {
  const request = path.join(site.runDir, REQUEST_FILE);
  const taken = path.join(site.runDir, `${REQUEST_FILE}.taken`);
  const statusFile = path.join(site.runDir, STATUS_FILE);

  try {
    await fs.rename(request, taken);
  } catch {
    info("No update was requested.");
    return 0;
  }

  try {
    const parsed = parseRequest(await fs.readFile(taken, "utf8"));
    const config = site.readConfig();
    if ("reason" in parsed) {
      error(`Ignoring the update request: ${parsed.reason}.`);
      return 1;
    }
    const req = parsed.request;
    const base = { id: req.id, action: req.action, from: config.version, requestedBy: req.requestedBy, startedAt: new Date().toISOString() } as const;

    if (req.action === "rollback") {
      const target = req.version ?? config.previousVersion ?? "";
      const report = FileReporter.open(statusFile, { ...base, to: target, steps: ["switch-back", "restart", "health"] });
      const code = await rollback(site, req.version, report);
      await report.finish(code === 0 ? "done" : "failed", code === 0 ? undefined : "the rollback did not complete");
      return code;
    }

    const version = req.version!;
    const report = FileReporter.open(statusFile, { ...base, to: version });
    // The CLI first: the update logic, its checks and this progress all ship in it.
    report.step("cli", "running");
    report.log(`▸ ${req.requestedBy.username} asked for ${version} in the ACP`);
    const cli = await exec("npm", ["install", `xentium@${version}`, "--no-audit", "--no-fund", "--loglevel", "error"], {
      cwd: site.root, quiet: true, timeout: 10 * 60_000,
    });
    if (cli.code !== 0) {
      report.log(cli.output.trim().slice(-1500));
      report.step("cli", "failed", "npm could not install the CLI for this release");
      await report.finish("failed", `npm could not install xentium@${version}`);
      return 1;
    }
    report.step("cli", "done");
    await report.settle(); // on disk before the new CLI takes the file over

    const entry = path.join(site.root, "node_modules", "xentium", "dist", "cli.js");
    const child = await exec(process.execPath, [entry, "update", version, "--site", site.root, `--report=${req.id}`], {
      cwd: site.root, quiet: false, timeout: 60 * 60_000,
    });

    // The new CLI finishes the file. If it stopped without doing that, we do.
    let status: RunStatus | null = null;
    try { status = JSON.parse(readFileSync(statusFile, "utf8")) as RunStatus; } catch { /* unreadable */ }
    if (!status || status.id !== req.id || status.state === "running") {
      const again = FileReporter.open(statusFile, { ...base, to: version });
      again.log(child.output.trim().split("\n").slice(-20).join("\n"));
      await again.finish(child.code === 0 ? "done" : "failed", child.code === 0 ? undefined : "the update stopped before it finished");
    }
    if (child.code === 0) success(`Updated to ${version}.`);
    return child.code;
  } finally {
    await fs.rm(taken, { force: true });
  }
}

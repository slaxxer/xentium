import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { XEC } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { cliSiteDir } from "../../config/envProbe.js";
import { XENTIUM_VERSION } from "../../config/version.js";
import { verifyPassword } from "../auth/auth.password.js";
import { offeredCoreVersion } from "./marketplace.service.js";

/**
 * One-click core updates, the API's half: it only ever ASKS.
 *
 * Starting an update writes `shared/run/update-request.json` (a version and who
 * asked). The updater (`xentium updater`, run by systemd as the site's user, set
 * up by `xentium install-service`) does the work and writes
 * `shared/run/update-status.json`, which this module serves to the update dialog
 * and to Migration History. The API restarts during an update, so the browser
 * polls this status and keeps polling through the gap.
 *
 * The status shape is the CLI's `RunStatus` (packages/cli/src/progress.ts).
 */

export type StepKey = "check" | "cli" | "download" | "install" | "verify" | "backup" | "migrate" | "restart" | "health" | "restore" | "switch-back";
export interface RunStatus {
  v: 1;
  id: string;
  action: "update" | "rollback";
  from: string;
  to: string;
  state: "running" | "done" | "failed" | "rolled-back";
  requestedBy: { id: string; username: string } | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  steps: Array<{ key: StepKey; state: "waiting" | "running" | "done" | "failed" | "skipped"; startedAt?: string; finishedAt?: string; note?: string }>;
  packages: Array<{ name: string; from: string | null; to: string; size: number | null; received: number; state: "queued" | "downloading" | "done" }>;
  otherPackages: number | null;
  migrations: Array<{ name: string; state: "waiting" | "running" | "done" | "failed" }>;
  backup: string | null;
  error: string | null;
  log: string[];
}

export interface CoreUpdateRunView {
  /** The updater is installed on this server, so the ACP can start updates. */
  available: boolean;
  /** Why not, when it isn't: a clone (no CLI install) or a CLI install without the updater. */
  unavailableReason: "not-cli-install" | "no-updater" | null;
  /** An update was asked for and the updater hasn't picked it up yet. */
  queued: boolean;
  /** The last run's status, while it runs and after (until the next one replaces it). */
  status: RunStatus | null;
  /** A running status that hasn't changed for this long is from an updater that died. */
  stalled: boolean;
  /** The version this site runs right now. */
  running: string;
  /** The version the update check offers, if any: what Update now installs. */
  offered: string | null;
}

/** An update writes something at least every few minutes; npm install can be slow. */
const STALE_MS = 20 * 60_000;

function runDir(): string | null {
  const site = cliSiteDir();
  return site ? path.join(site, "shared", "run") : null;
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

/** Read the status file; never throws (a half-missing file is "no run"). */
async function readStatus(dir: string): Promise<RunStatus | null> {
  try {
    const s = JSON.parse(await fs.readFile(path.join(dir, "update-status.json"), "utf8")) as RunStatus;
    if (s?.v !== 1 || typeof s.id !== "string" || !Array.isArray(s.steps)) return null;
    return { ...s, packages: s.packages ?? [], migrations: s.migrations ?? [], log: (s.log ?? []).slice(-200) };
  } catch {
    return null;
  }
}

export const coreUpdateRun = {
  async view(): Promise<CoreUpdateRunView> {
    const dir = runDir();
    const offered = await offeredCoreVersion().catch(() => null);
    if (!dir) return { available: false, unavailableReason: "not-cli-install", queued: false, status: null, stalled: false, running: XENTIUM_VERSION, offered };
    const [marker, queued, taken, status] = await Promise.all([
      exists(path.join(dir, "updater.json")),
      exists(path.join(dir, "update-request.json")),
      exists(path.join(dir, "update-request.json.taken")),
      readStatus(dir),
    ]);
    const stalled = !!status && status.state === "running" && Date.now() - Date.parse(status.updatedAt) > STALE_MS;
    return {
      available: marker,
      unavailableReason: marker ? null : "no-updater",
      // Written but not yet claimed by the updater.
      queued: queued && !taken,
      status,
      stalled,
      running: XENTIUM_VERSION,
      offered,
    };
  },

  /** Ask the updater for the offered version, after the admin proved it is them. */
  async start(userId: string, version: string, password: string): Promise<CoreUpdateRunView> {
    const user = await confirmIdentity(userId, password);
    const { dir } = await assertIdle();
    const offered = await offeredCoreVersion();
    if (!offered || offered !== version) {
      throw new XentiumError({ code: XEC.UPDATE_NOT_OFFERED, httpStatus: 409, message: "That version is not the update this site is offered" });
    }
    await writeRequest(dir, { action: "update", version, requestedBy: user });
    return this.view();
  },

  /** Go back to the release the last update replaced. The database is not touched. */
  async rollback(userId: string, password: string): Promise<CoreUpdateRunView> {
    const user = await confirmIdentity(userId, password);
    const { dir, view } = await assertIdle();
    const last = view.status;
    if (!last || last.action !== "update" || last.state !== "done" || last.to !== XENTIUM_VERSION) {
      throw new XentiumError({ code: XEC.UPDATE_NO_ROLLBACK, httpStatus: 409, message: "There is no finished update to roll back" });
    }
    await writeRequest(dir, { action: "rollback", version: last.from, requestedBy: user });
    return this.view();
  },
};

async function confirmIdentity(userId: string, password: string): Promise<{ id: string; username: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, passwordHash: true } });
  const valid = !!user && await verifyPassword(user.passwordHash, password).catch(() => false);
  if (!user || !valid) {
    throw new XentiumError({ code: XEC.UPDATE_REAUTH, httpStatus: 422, message: "That password is not right" });
  }
  return { id: user.id, username: user.username };
}

async function assertIdle(): Promise<{ dir: string; view: CoreUpdateRunView }> {
  const view = await coreUpdateRun.view();
  const dir = runDir();
  if (!dir || !view.available) {
    throw new XentiumError({ code: XEC.UPDATE_UNAVAILABLE, httpStatus: 409, message: "This server has no updater installed" });
  }
  if (view.queued || (view.status?.state === "running" && !view.stalled) || await exists(path.join(dir, "update-request.json.taken"))) {
    throw new XentiumError({ code: XEC.UPDATE_BUSY, httpStatus: 409, message: "An update is already running" });
  }
  return { dir, view };
}

/** Written to a temp file and renamed, so the updater's path unit never sees half a request. */
async function writeRequest(dir: string, req: { action: "update" | "rollback"; version: string; requestedBy: { id: string; username: string } }) {
  const body = JSON.stringify({ v: 1, id: randomUUID(), ...req, requestedAt: new Date().toISOString() });
  const tmp = path.join(dir, `.update-request.${process.pid}.tmp`);
  await fs.writeFile(tmp, `${body}\n`, { mode: 0o640 });
  await fs.rename(tmp, path.join(dir, "update-request.json"));
}

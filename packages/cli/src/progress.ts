/**
 * What an update is doing, written where the ACP can read it.
 *
 * A terminal run reports nothing (the terminal is the report). The updater, which
 * runs an update the ACP asked for, writes `shared/run/update-status.json`: the
 * steps, each package as it downloads, each migration, the backup, the outcome
 * and the last lines of the log. The API serves that file to the update dialog
 * and to Migration History, so both show the same run, live, across the restart
 * that takes the API itself down for a moment.
 *
 * The shape is mirrored by the API's reader (modules/admin/coreUpdateRun.ts):
 * change both together.
 */
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";

export type StepKey =
  | "check" | "cli" | "download" | "install" | "verify" | "backup"
  | "migrate" | "restart" | "health" | "restore" | "switch-back";
export type StepState = "waiting" | "running" | "done" | "failed" | "skipped";

export interface RunStep { key: StepKey; state: StepState; startedAt?: string; finishedAt?: string; note?: string }
export interface RunPackage { name: string; from: string | null; to: string; size: number | null; received: number; state: "queued" | "downloading" | "done" }
export interface RunMigration { name: string; state: "waiting" | "running" | "done" | "failed" }

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
  steps: RunStep[];
  packages: RunPackage[];
  /** Third-party dependencies npm fetched itself, without per-package progress. */
  otherPackages: number | null;
  migrations: RunMigration[];
  backup: string | null;
  error: string | null;
  log: string[];
}

export interface Reporter {
  step(key: StepKey, state: StepState, note?: string): void;
  packages(list: RunPackage[]): void;
  packageProgress(name: string, received: number, size: number | null): void;
  otherPackages(count: number): void;
  migrations(names: string[]): void;
  migration(name: string, state: RunMigration["state"]): void;
  backup(file: string): void;
  log(text: string): void;
  finish(state: RunStatus["state"], error?: string): Promise<void>;
}

/** The terminal run: the terminal output is the report. */
export const silentReporter: Reporter = {
  step() {}, packages() {}, packageProgress() {}, otherPackages() {}, migrations() {}, migration() {},
  backup() {}, log() {}, finish: async () => {},
};

/** The steps an update walks through, in order. A rollback adds its own at the end. */
export const UPDATE_STEPS: StepKey[] = ["check", "cli", "download", "install", "verify", "backup", "migrate", "restart", "health"];

const LOG_LINES = 300;

/**
 * Writes the status file, throttled: a download reports many times a second, the
 * ACP polls once a second. Every write goes to a temp file renamed over the real
 * one, so a reader never sees half a JSON document.
 */
export class FileReporter implements Reporter {
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  private constructor(readonly file: string, private status: RunStatus) {}

  /** A new run, or the one the updater started (same id): the updated CLI carries on writing it. */
  static open(file: string, init: Omit<RunStatus, "v" | "state" | "updatedAt" | "finishedAt" | "steps" | "packages" | "otherPackages" | "migrations" | "backup" | "error" | "log"> & { steps?: StepKey[] }): FileReporter {
    let existing: RunStatus | null = null;
    try {
      existing = JSON.parse(readFileSync(file, "utf8")) as RunStatus;
    } catch { /* first writer */ }
    const now = new Date().toISOString();
    const status: RunStatus = existing && existing.id === init.id
      ? existing
      : {
          v: 1, id: init.id, action: init.action, from: init.from, to: init.to, state: "running",
          requestedBy: init.requestedBy, startedAt: init.startedAt, updatedAt: now, finishedAt: null,
          steps: (init.steps ?? UPDATE_STEPS).map((key) => ({ key, state: "waiting" as const })),
          packages: [], otherPackages: null, migrations: [], backup: null, error: null, log: [],
        };
    const r = new FileReporter(file, status);
    r.flush();
    return r;
  }

  get snapshot(): RunStatus { return this.status; }

  step(key: StepKey, state: StepState, note?: string) {
    const now = new Date().toISOString();
    let s = this.status.steps.find((x) => x.key === key);
    if (!s) { s = { key, state: "waiting" }; this.status.steps.push(s); }
    s.state = state;
    if (state === "running") s.startedAt ??= now;
    if (state === "done" || state === "failed" || state === "skipped") s.finishedAt = now;
    if (note !== undefined) s.note = note;
    this.schedule(true);
  }
  packages(list: RunPackage[]) { this.status.packages = list; this.schedule(true); }
  packageProgress(name: string, received: number, size: number | null) {
    const p = this.status.packages.find((x) => x.name === name);
    if (!p) return;
    p.received = received;
    if (size !== null) p.size = size;
    p.state = size !== null && received >= size ? "done" : "downloading";
    this.schedule();
  }
  otherPackages(count: number) { this.status.otherPackages = count; this.schedule(); }
  migrations(names: string[]) { this.status.migrations = names.map((name) => ({ name, state: "waiting" })); this.schedule(true); }
  migration(name: string, state: RunMigration["state"]) {
    const m = this.status.migrations.find((x) => x.name === name);
    if (m) m.state = state; else this.status.migrations.push({ name, state });
    this.schedule(true);
  }
  backup(file: string) { this.status.backup = file; this.schedule(); }
  log(text: string) {
    for (const lineText of text.split("\n")) {
      const trimmed = lineText.trimEnd();
      if (trimmed) this.status.log.push(trimmed);
    }
    if (this.status.log.length > LOG_LINES) this.status.log.splice(0, this.status.log.length - LOG_LINES);
    this.schedule();
  }
  async finish(state: RunStatus["state"], error?: string) {
    this.status.state = state;
    this.status.finishedAt = new Date().toISOString();
    if (error) this.status.error = error;
    // A step left running at the end did not finish: say so instead of spinning.
    for (const s of this.status.steps) if (s.state === "running") s.state = state === "done" ? "done" : "failed";
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.flush();
    await this.writing;
  }

  /** Write what we have now and wait for it: before another process takes the file over. */
  async settle(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.flush();
    await this.writing;
  }

  private schedule(now = false) {
    if (now) { if (this.timer) { clearTimeout(this.timer); this.timer = null; } this.flush(); return; }
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 250);
  }

  private flush() {
    this.status.updatedAt = new Date().toISOString();
    const body = `${JSON.stringify(this.status)}\n`;
    const tmp = `${this.file}.${process.pid}.tmp`;
    this.writing = this.writing
      .then(() => fs.mkdir(path.dirname(this.file), { recursive: true }))
      .then(() => fs.writeFile(tmp, body, { mode: 0o640 }))
      .then(() => fs.rename(tmp, this.file))
      .catch(() => { /* a status file we cannot write never fails the update */ });
  }
}

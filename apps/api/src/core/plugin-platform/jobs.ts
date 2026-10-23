import { DelayedError, Worker, type Job } from "bullmq";
import type { PluginJobDeclaration, PluginJobs } from "@xentium/plugin-sdk";
import { bullConnection, bullPrefix, queues } from "../../infrastructure/queue.js";
import { previewRuns } from "../../jobs/scheduledJobs.js";
import { siteZone } from "./time.js";

/**
 * Background work for plugins (ADR-0011): one queue, `plugin-jobs`, run by the
 * worker, exactly once, with retries, surviving restarts. Replaces `setInterval`,
 * which ran once per PROCESS (every API process and the worker load plugins) and
 * lost anything pending on a restart.
 *
 * A job's data is `{ pluginId, name, data }`; its BullMQ name is
 * `plugin:<pluginId>:<name>`, so the queue reads well in logs. Handlers live in the
 * process that registered them and the worker runs them; an API process only uses
 * its registry to refuse an unknown name at the call.
 */

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const KEY = /^[A-Za-z0-9._-]{1,128}$/;
/** A held job (its plugin is off) looks again this much later. */
const HOLD_MS = 15 * 60_000;
/** Cron schedules may not fire more often than this. */
const MIN_INTERVAL_SEC = 60;

interface Registered { handler: PluginJobDeclaration["handler"]; retries: number }
const handlers = new Map<string, Map<string, Registered>>();

const jobName = (pluginId: string, name: string) => `plugin:${pluginId}:${name}`;
// BullMQ ids may not contain ":", so "__" separates the parts. Plugin ids and job
// names never hold "__" (registerJob refuses it), so the key, last, may.
const keyedId = (pluginId: string, name: string, key: string) => `p__${pluginId}__${name}__${key}`;
const schedulerId = (pluginId: string, name: string) => `p__${pluginId}__${name}`;

function fail(message: string): never {
  throw new Error(`[plugin jobs] ${message}`);
}

export function registerJob(pluginId: string, decl: PluginJobDeclaration): void {
  if (!NAME.test(decl.name) || decl.name.includes("__")) fail(`"${decl.name}" is not a valid job name (letters, digits, . _ -; up to 64; no "__").`);
  if (typeof decl.handler !== "function") fail(`job "${decl.name}" has no handler.`);
  const retries = decl.retries ?? 3;
  if (!Number.isInteger(retries) || retries < 0 || retries > 10) fail(`job "${decl.name}": retries must be 0–10.`);
  let mine = handlers.get(pluginId);
  if (!mine) handlers.set(pluginId, (mine = new Map()));
  mine.set(decl.name, { handler: decl.handler as Registered["handler"], retries });
}

/** This process forgets the plugin's handlers (disable, update). Queued jobs stay. */
export function deregisterJobs(pluginId: string): void {
  handlers.delete(pluginId);
}

function known(pluginId: string, name: string): Registered {
  const r = handlers.get(pluginId)?.get(name);
  if (!r) fail(`"${name}" is not a registered job of ${pluginId}. Call ctx.registerJob first.`);
  return r;
}

const jobOpts = (r: Registered) => ({ attempts: r.retries + 1, backoff: { type: "exponential", delay: 5000 } });

async function removeIfWaiting(id: string): Promise<boolean> {
  const job = await queues.pluginJobs.getJob(id);
  if (!job) return false;
  // A job that is running right now cannot be pulled out from under its handler.
  if (await job.isActive()) return false;
  await job.remove();
  return true;
}

/** `host.jobs` for one plugin. */
export function jobsFor(pluginId: string): PluginJobs {
  return {
    async run(name, data = null) {
      const r = known(pluginId, name);
      const job = await queues.pluginJobs.add(jobName(pluginId, name), { pluginId, name, data }, jobOpts(r));
      return job.id!;
    },

    async at(name, data, when, opts = {}) {
      const r = known(pluginId, name);
      if (!(when instanceof Date) || Number.isNaN(when.getTime())) fail(`job "${name}": "when" must be a valid Date.`);
      const delay = Math.max(0, when.getTime() - Date.now());
      let jobId: string | undefined;
      if (opts.key !== undefined) {
        if (!KEY.test(opts.key)) fail(`job "${name}": a key is 1–128 of letters, digits, . _ -.`);
        jobId = keyedId(pluginId, name, opts.key);
        // The same key again moves the job: BullMQ ignores an add whose id exists.
        await removeIfWaiting(jobId);
      }
      const job = await queues.pluginJobs.add(jobName(pluginId, name), { pluginId, name, data }, { ...jobOpts(r), delay, jobId });
      return job.id!;
    },

    async cancel(name, key) {
      if (!NAME.test(name) || !KEY.test(key)) return false;
      return removeIfWaiting(keyedId(pluginId, name, key));
    },

    async every(name, schedule, data = null) {
      const r = known(pluginId, name);
      let repeat: { pattern: string; tz: string } | { every: number };
      if ("cron" in schedule) {
        const tz = await siteZone();
        previewRuns(schedule.cron, tz, MIN_INTERVAL_SEC); // throws on a bad or too-frequent pattern
        repeat = { pattern: schedule.cron, tz };
      } else {
        const m = schedule.everyMinutes;
        if (!Number.isInteger(m) || m < 1 || m > 7 * 24 * 60) fail(`job "${name}": everyMinutes must be 1–10080.`);
        repeat = { every: m * 60_000 };
      }
      await queues.pluginJobs.upsertJobScheduler(schedulerId(pluginId, name), repeat, {
        name: jobName(pluginId, name), data: { pluginId, name, data }, opts: jobOpts(r),
      });
    },

    async stop(name) {
      if (!NAME.test(name)) return;
      await queues.pluginJobs.removeJobScheduler(schedulerId(pluginId, name));
    },
  };
}

/** Every repeating job of a plugin stops (disable). Its one-off jobs are kept and held. */
export async function stopPluginSchedules(pluginId: string): Promise<void> {
  const prefix = `p__${pluginId}__`;
  const all = await queues.pluginJobs.getJobSchedulers(0, -1);
  await Promise.all(all.filter((s) => (s.key ?? "").startsWith(prefix))
    .map((s) => queues.pluginJobs.removeJobScheduler(s.key)));
}

/** Everything of a plugin leaves the queue (uninstall). */
export async function dropPluginJobs(pluginId: string): Promise<void> {
  await stopPluginSchedules(pluginId);
  const jobs = await queues.pluginJobs.getJobs(["delayed", "waiting", "paused", "prioritized", "failed", "completed"]);
  await Promise.all(jobs.filter((j) => j?.data?.pluginId === pluginId).map((j) => j.remove().catch(() => {})));
}

export interface PluginScheduleRow {
  pluginId: string; name: string;
  pattern: string | null; everyMs: number | null; tz: string | null; next: string | null;
}

/** The repeating jobs plugins have scheduled, for ACP → Scheduled Tasks (read-only). */
export async function listPluginSchedules(): Promise<PluginScheduleRow[]> {
  const all = await queues.pluginJobs.getJobSchedulers(0, -1);
  return all.flatMap((s) => {
    const m = /^p__(.+?)__(.+)$/.exec(s.key ?? "");
    if (!m) return [];
    return [{
      pluginId: m[1]!, name: m[2]!,
      pattern: s.pattern ?? null, everyMs: s.every ? Number(s.every) : null, tz: s.tz ?? null,
      next: s.next ? new Date(s.next).toISOString() : null,
    }];
  });
}

// ── The worker ──────────────────────────────────────────────────────────────

/** Is the plugin enabled — and loaded in this process at its installed version? */
export type PluginLoader = (pluginId: string) => Promise<"enabled" | "off" | "gone">;

/**
 * Runs one plugin job. `ensureLoaded` loads the plugin into this process when it was
 * enabled (or updated) after the worker started: the worker reads plugins once at
 * boot and hears of no change made through an API process.
 */
export async function dispatchPluginJob(job: Job, token: string | undefined, ensureLoaded: PluginLoader): Promise<unknown> {
  const { pluginId, name, data } = (job.data ?? {}) as { pluginId?: string; name?: string; data?: unknown };
  if (!pluginId || !name) return { skipped: "malformed" };

  const state = await ensureLoaded(pluginId);
  if (state === "gone") return { skipped: "uninstalled" };
  if (state === "off") {
    // Held, not dropped: a disabled plugin keeps its work for when it is back.
    await job.moveToDelayed(Date.now() + HOLD_MS, token);
    throw new DelayedError();
  }

  const r = handlers.get(pluginId)?.get(name);
  if (!r) throw new Error(`${pluginId} has no job "${name}" (removed in an update?)`);
  return r.handler(data, { attempt: job.attemptsMade + 1, jobId: job.id ?? "" });
}

export function startPluginJobWorker(ensureLoaded: PluginLoader): Worker {
  return new Worker("plugin-jobs", (job, token) => dispatchPluginJob(job, token, ensureLoaded), {
    connection: bullConnection, prefix: bullPrefix, concurrency: 4,
  });
}

/** For tests. */
export function _resetPluginJobs(): void {
  handlers.clear();
}
export const _ids = { keyedId, schedulerId, jobName };

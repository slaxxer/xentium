// Central registry of timer-based (cron) background jobs and the admin-configurable
// schedule for each. Source of truth for BOTH worker.ts (applies schedules at boot)
// and the ACP jobs API (reads/updates them live). Event-driven workers
// (article-revision-cleanup, check-promotion, email-notification) are NOT here —
// they have no interval to configure.
import parser from "cron-parser";
import type { Queue } from "bullmq";
import { NEC } from "@nodevo/contracts";
import { queues } from "../infrastructure/queue.js";
import { prisma } from "../infrastructure/db.js";
import { NodevoError } from "../shared/errors/NodevoError.js";
import { bustSettingsCache } from "../shared/utils/settings.js";

export interface ScheduledJobDef {
  key:            string;   // stable id, also the settings sub-key
  schedulerId:    string;   // BullMQ job-scheduler id (must match worker.ts history)
  queue:          Queue;
  jobName:        string;   // job name the worker processes
  label:          string;
  description:    string;
  defaultCron:    string;
  minIntervalSec: number;   // guardrail: reject schedules that fire more often than this
  defaultEnabled?: boolean; // default true; set false for opt-in jobs (e.g. appearance publish)
}

export const SCHEDULED_JOBS: ScheduledJobDef[] = [
  {
    // §15 cadence: runs the four core baseline detection patterns, then every
    // plugin-registered security scan. Plugins may replace individual baseline
    // patterns via `claimSecurityPatterns` (enhanced variants); any plugin's
    // `registerSecurityScan` runs on this schedule without owning a cron itself.
    key: "security-analysis", schedulerId: "security-analysis-repeat",
    queue: queues.securityAnalysis, jobName: "security-analysis",
    label: "Security scans",
    description: "Runs the core baseline abuse-detection patterns (§15) plus any plugin-registered security scans.",
    defaultCron: "*/30 * * * *", minIntervalSec: 5 * 60,
  },
  {
    key: "ban-expiry", schedulerId: "ban-expiry-daily",
    queue: queues.banExpiry, jobName: "ban-expiry",
    label: "Ban expiry",
    description: "Expires temporary bans whose end time has passed and clears the user's banned status.",
    defaultCron: "0 2 * * *", minIntervalSec: 5 * 60,
  },
  {
    key: "warning-expiry", schedulerId: "warning-expiry-daily",
    queue: queues.warningExpiry, jobName: "warning-expiry",
    label: "Warning expiry",
    description: "Expires warnings past their expiry date and recalculates moderation thresholds.",
    defaultCron: "0 2 * * *", minIntervalSec: 5 * 60,
  },
  {
    key: "license-refresh", schedulerId: "license-refresh-daily",
    queue: queues.licenseRefresh, jobName: "license-refresh",
    label: "License refresh",
    description: "Refreshes plugin license entitlements from the marketplace (30-day grace applies).",
    defaultCron: "0 2 * * *", minIntervalSec: 60 * 60,
  },
  {
    key: "appearance-publish", schedulerId: "appearance-publish-repeat",
    queue: queues.appearancePublish, jobName: "appearance-publish",
    label: "Publish appearance changes",
    description: "Applies staged (draft) Style Editor changes to the live site at the scheduled time. Disabled by default — use 'Run now' to publish immediately, or enable a schedule to auto-publish pending drafts.",
    defaultCron: "0 3 * * *", minIntervalSec: 5 * 60,
    defaultEnabled: false,
  },
];

export type ScheduleMode = "interval" | "daily" | "cron";

export interface JobScheduleConfig {
  enabled:      boolean;
  mode:         ScheduleMode;
  intervalMin?: number;   // mode=interval (e.g. 15, 30, 60)
  dailyTime?:   string;   // mode=daily, "HH:MM" (24h)
  cron?:        string;   // mode=cron (advanced)
  tz?:          string;   // IANA tz for daily/cron; defaults to UTC
}

export function getJobDef(key: string): ScheduledJobDef | undefined {
  return SCHEDULED_JOBS.find((j) => j.key === key);
}

const settingKey = (key: string) => `jobs.${key}`;

/** Derive a friendly default config from a job's default cron. */
export function defaultConfig(def: ScheduledJobDef): JobScheduleConfig {
  const enabled = def.defaultEnabled ?? true;
  const interval = def.defaultCron.match(/^\*\/(\d+) \* \* \* \*$/);
  if (interval) return { enabled, mode: "interval", intervalMin: Number(interval[1]), tz: "UTC" };
  const daily = def.defaultCron.match(/^(\d+) (\d+) \* \* \*$/);
  if (daily) return { enabled, mode: "daily", dailyTime: `${daily[2]!.padStart(2, "0")}:${daily[1]!.padStart(2, "0")}`, tz: "UTC" };
  return { enabled, mode: "cron", cron: def.defaultCron, tz: "UTC" };
}

/** Turn a stored config into a concrete cron pattern. */
export function resolveCron(cfg: JobScheduleConfig, def: ScheduledJobDef): string {
  if (cfg.mode === "interval") {
    const m = cfg.intervalMin ?? 30;
    if (m % 60 === 0) {
      const h = m / 60;
      return h === 1 ? "0 * * * *" : `0 */${h} * * *`;
    }
    return `*/${m} * * * *`;
  }
  if (cfg.mode === "daily") {
    const [hh, mm] = (cfg.dailyTime ?? "02:00").split(":").map(Number);
    return `${mm} ${hh} * * *`;
  }
  return cfg.cron?.trim() || def.defaultCron;
}

/**
 * Validate a cron pattern and return the next N run times. Throws
 * NEC-QUEUE-5001 on a bad expression or a schedule that fires faster than
 * the job's min interval.
 */
export function previewRuns(pattern: string, tz: string | undefined, minIntervalSec: number, count = 3): string[] {
  let it;
  try {
    it = parser.parseExpression(pattern, { tz: tz || "UTC", currentDate: new Date() });
  } catch {
    throw new NodevoError({ code: NEC.QUEUE_INVALID_SCHEDULE, httpStatus: 422, message: "Invalid cron expression." });
  }
  const runs: Date[] = [];
  for (let i = 0; i < count; i++) runs.push(it.next().toDate());
  const gapSec = (runs[1]!.getTime() - runs[0]!.getTime()) / 1000;
  if (gapSec < minIntervalSec) {
    throw new NodevoError({
      code: NEC.QUEUE_INVALID_SCHEDULE, httpStatus: 422,
      message: `Schedule runs too frequently — minimum is once every ${Math.round(minIntervalSec / 60)} minutes.`,
    });
  }
  return runs.map((d) => d.toISOString());
}

/** Apply a config to BullMQ. Idempotent; safe to call from server or worker (shared Redis). */
export async function applyJobSchedule(def: ScheduledJobDef, cfg: JobScheduleConfig): Promise<void> {
  if (!cfg.enabled) {
    await def.queue.removeJobScheduler(def.schedulerId).catch(() => {});
    return;
  }
  const pattern = resolveCron(cfg, def);
  previewRuns(pattern, cfg.tz, def.minIntervalSec); // validates (throws on bad)
  await def.queue.upsertJobScheduler(
    def.schedulerId,
    { pattern, tz: cfg.tz || undefined },
    { name: def.jobName, data: {} },
  );
}

export async function getJobConfig(def: ScheduledJobDef): Promise<JobScheduleConfig> {
  const row = await prisma.setting.findUnique({ where: { key: settingKey(def.key) } });
  if (row?.value && typeof row.value === "object" && !Array.isArray(row.value)) {
    return { ...defaultConfig(def), ...(row.value as unknown as JobScheduleConfig) };
  }
  return defaultConfig(def);
}

export async function saveJobConfig(def: ScheduledJobDef, cfg: JobScheduleConfig): Promise<void> {
  const value = cfg as unknown as object;
  await prisma.setting.upsert({
    where:  { key: settingKey(def.key) },
    create: { key: settingKey(def.key), value },
    update: { value },
  });
  bustSettingsCache(settingKey(def.key));
}

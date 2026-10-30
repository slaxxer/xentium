import os from "node:os";
import type { RequestHandler } from "express";
import { queues } from "../../infrastructure/queue.js";

/**
 * What ACP → About shows under "System health", measured on this server.
 *
 * CPU and memory are the HOST's (what an admin sizing the box wants), requests are
 * THIS API process's: a small counter in front of the routers, bucketed into 2 s
 * slots, the last 40 kept (80 s of history for the sparkline). No library, nothing
 * stored, gone on restart.
 */

const BUCKET_MS = 2_000;
const BUCKETS = 40;

interface Bucket { at: number; count: number; totalMs: number }
const buckets: Bucket[] = [];

function bucketFor(now: number): Bucket {
  const at = now - (now % BUCKET_MS);
  const last = buckets[buckets.length - 1];
  if (last && last.at === at) return last;
  const b = { at, count: 0, totalMs: 0 };
  buckets.push(b);
  while (buckets.length > BUCKETS) buckets.shift();
  return b;
}

/** Counts finished API requests. Streams (SSE) are left out: their "duration" is how long a tab stayed open. */
export const requestMeter: RequestHandler = (req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    if (String(res.getHeader("content-type") ?? "").includes("text/event-stream")) return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const b = bucketFor(Date.now());
    b.count += 1;
    b.totalMs += ms;
  });
  next();
};

/** CPU busy share since the previous call (the first call: since boot). */
let lastCpu = os.cpus().map((c) => c.times);
function cpuPercent(): number {
  const now = os.cpus().map((c) => c.times);
  let idle = 0, total = 0;
  now.forEach((t, i) => {
    const p = lastCpu[i] ?? { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const d = (t.user - p.user) + (t.nice - p.nice) + (t.sys - p.sys) + (t.irq - p.irq) + (t.idle - p.idle);
    idle += t.idle - p.idle;
    total += d;
  });
  lastCpu = now;
  return total > 0 ? Math.round((1 - idle / total) * 100) : 0;
}

export interface SystemMetrics {
  cpu: { percent: number; cores: number };
  memory: { percent: number; usedMb: number; totalMb: number };
  queue: { waiting: number; active: number; delayed: number; failed: number };
  requests: { perSec: number; avgMs: number | null; history: number[] };
}

export async function systemMetrics(): Promise<SystemMetrics> {
  const total = os.totalmem();
  const used = total - os.freemem();

  const counts = await Promise.all(
    Object.values(queues).map((q) => q.getJobCounts("waiting", "active", "delayed", "failed").catch(() => null)),
  );
  const queue = { waiting: 0, active: 0, delayed: 0, failed: 0 };
  for (const c of counts) {
    if (!c) continue;
    queue.waiting += c.waiting ?? 0;
    queue.active += c.active ?? 0;
    queue.delayed += c.delayed ?? 0;
    queue.failed += c.failed ?? 0;
  }

  // Whole slots only: the one filling right now would read low.
  const now = Date.now();
  bucketFor(now);
  const done = buckets.filter((b) => b.at + BUCKET_MS <= now);
  const recent = done.slice(-5);
  const n = recent.reduce((s, b) => s + b.count, 0);
  const ms = recent.reduce((s, b) => s + b.totalMs, 0);
  const history: number[] = [];
  for (let i = BUCKETS - 1; i >= 1; i--) {
    const at = now - (now % BUCKET_MS) - i * BUCKET_MS;
    const b = done.find((x) => x.at === at);
    history.push(b ? Math.round((b.count / (BUCKET_MS / 1000)) * 10) / 10 : 0);
  }

  return {
    cpu: { percent: cpuPercent(), cores: os.cpus().length },
    memory: { percent: Math.round((used / total) * 100), usedMb: Math.round(used / 1048576), totalMb: Math.round(total / 1048576) },
    queue,
    requests: {
      perSec: recent.length ? Math.round((n / (recent.length * BUCKET_MS / 1000)) * 10) / 10 : 0,
      avgMs: n ? Math.round(ms / n) : null,
      history,
    },
  };
}

/** For tests: start counting from nothing. */
export function __resetRequestMeter() {
  buckets.length = 0;
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { __resetRequestMeter, requestMeter, systemMetrics } from "./systemMetrics.js";

function app() {
  const a = express();
  a.use(requestMeter);
  a.get("/api/ping", (_req, res) => { res.json({ ok: true }); });
  a.get("/api/stream", (_req, res) => { res.setHeader("content-type", "text/event-stream"); res.end("data: x\n\n"); });
  a.get("/page", (_req, res) => { res.send("hi"); });
  return a;
}

describe("system metrics", () => {
  beforeEach(() => {
    __resetRequestMeter();
    vi.useRealTimers();
  });

  it("measures the host, not made-up figures", async () => {
    const m = await systemMetrics();
    expect(m.cpu.cores).toBeGreaterThan(0);
    expect(m.cpu.percent).toBeGreaterThanOrEqual(0);
    expect(m.cpu.percent).toBeLessThanOrEqual(100);
    expect(m.memory.totalMb).toBeGreaterThan(0);
    expect(m.memory.usedMb).toBeLessThanOrEqual(m.memory.totalMb);
    expect(m.requests.history).toHaveLength(39);
    for (const k of ["waiting", "active", "delayed", "failed"] as const) expect(m.queue[k]).toBeGreaterThanOrEqual(0);
  });

  it("counts API requests once their slot is over, and leaves streams and pages out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T12:00:00.500Z"));
    const a = app();
    await request(a).get("/api/ping");
    await request(a).get("/api/ping");
    await request(a).get("/api/stream");
    await request(a).get("/page");

    // Still the slot being filled: not reported yet.
    expect((await systemMetrics()).requests.avgMs).toBeNull();

    vi.setSystemTime(new Date("2026-10-30T12:00:02.100Z"));
    const m = await systemMetrics();
    expect(m.requests.perSec).toBe(1); // 2 requests in one 2 s slot
    expect(m.requests.avgMs).not.toBeNull();
    expect(m.requests.history.at(-1)).toBe(1);
  });
});

/**
 * Plugin jobs against a real queue (Redis, the tests' own key prefix): names are
 * checked, a keyed job moves and cancels, a schedule is listed and stops with its
 * plugin, and the worker runs a job once, holds it while its plugin is off, and
 * skips it once the plugin is gone.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Worker } from "bullmq";
import { queues } from "../../infrastructure/queue.js";
import {
  _ids, _resetPluginJobs, dropPluginJobs, jobsFor, listPluginSchedules, registerJob, startPluginJobWorker, stopPluginSchedules,
} from "./jobs.js";

const P = "jobs-test";
const jobs = jobsFor(P);
let worker: Worker | null = null;

beforeAll(async () => { await queues.pluginJobs.obliterate({ force: true }); });
afterEach(async () => {
  await worker?.close(); worker = null;
  await dropPluginJobs(P);
  _resetPluginJobs();
});
afterAll(async () => { await queues.pluginJobs.obliterate({ force: true }); });

const until = async (check: () => Promise<boolean> | boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};

describe("plugin jobs", () => {
  it("refuses bad names and unknown jobs", async () => {
    expect(() => registerJob(P, { name: "a b", handler: () => {} })).toThrow();
    expect(() => registerJob(P, { name: "a__b", handler: () => {} })).toThrow();
    expect(() => registerJob(P, { name: "ok", handler: () => {}, retries: 99 })).toThrow();
    await expect(jobs.run("never-registered")).rejects.toThrow(/not a registered job/);
  });

  it("moves a keyed job when it is scheduled again, and cancels it", async () => {
    registerJob(P, { name: "remind", handler: () => {} });
    const later = new Date(Date.now() + 3_600_000);
    const id = await jobs.at("remind", { e: 1 }, later, { key: "ev-1" });
    expect(id).toBe(_ids.keyedId(P, "remind", "ev-1"));
    await jobs.at("remind", { e: 2 }, new Date(Date.now() + 7_200_000), { key: "ev-1" });
    const job = await queues.pluginJobs.getJob(id);
    expect(job?.data).toEqual({ pluginId: P, name: "remind", data: { e: 2 } });
    expect(await jobs.cancel("remind", "ev-1")).toBe(true);
    expect(await queues.pluginJobs.getJob(id)).toBeUndefined();
    expect(await jobs.cancel("remind", "ev-1")).toBe(false);
  });

  it("lists a repeating job and stops it with the plugin", async () => {
    registerJob(P, { name: "sweep", handler: () => {} });
    await jobs.every("sweep", { everyMinutes: 15 });
    await expect(jobs.every("sweep", { cron: "* * * * * *" })).rejects.toThrow();
    expect(await listPluginSchedules()).toContainEqual(expect.objectContaining({ pluginId: P, name: "sweep", everyMs: 900_000 }));
    await stopPluginSchedules(P);
    expect((await listPluginSchedules()).filter((r) => r.pluginId === P)).toEqual([]);
  });

  it("runs a job once in the worker, with its data", async () => {
    const handler = vi.fn();
    registerJob(P, { name: "now", handler });
    worker = startPluginJobWorker(async () => "enabled");
    await jobs.run("now", { hello: "x" });
    expect(await until(() => handler.mock.calls.length === 1)).toBe(true);
    expect(handler.mock.calls[0]![0]).toEqual({ hello: "x" });
    await new Promise((r) => setTimeout(r, 300));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("holds a job while its plugin is off, and skips it once the plugin is gone", async () => {
    const handler = vi.fn();
    registerJob(P, { name: "held", handler });
    let state: "off" | "gone" = "off";
    worker = startPluginJobWorker(async () => state);
    const id = await jobs.run("held");
    expect(await until(async () => (await queues.pluginJobs.getJob(id))?.isDelayed() ?? false)).toBe(true);
    expect(handler).not.toHaveBeenCalled();

    state = "gone";
    await (await queues.pluginJobs.getJob(id))!.promote();
    expect(await until(async () => (await queues.pluginJobs.getJob(id))?.isCompleted() ?? false)).toBe(true);
    expect((await queues.pluginJobs.getJob(id))!.returnvalue).toEqual({ skipped: "uninstalled" });
    expect(handler).not.toHaveBeenCalled();
  });
});

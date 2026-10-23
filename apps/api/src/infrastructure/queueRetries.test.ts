/**
 * Background jobs survive a passing failure: every queue retries a failed job
 * (three tries, with a growing pause), and a job that keeps failing is kept for a
 * day for a look instead of vanishing. Run against real Redis, with BullMQ itself.
 */
import { afterAll, describe, expect, it } from "vitest";
import { Queue, QueueEvents, Worker } from "bullmq";

const { queues, defaultJobOptions, bullConnection } = await import("./queue.js");

const prefix = `xentium-test-retry-${process.pid}`;
const opened: { close: () => Promise<unknown> }[] = [];
afterAll(async () => { for (const o of opened.reverse()) await o.close(); });

describe("queue retries", () => {
  it("every queue retries three times with a growing pause, and keeps failures", () => {
    for (const [name, q] of Object.entries(queues)) {
      expect(q.defaultJobOptions.attempts, name).toBe(3);
      expect(q.defaultJobOptions.backoff, name).toMatchObject({ type: "exponential" });
      expect(q.defaultJobOptions.removeOnFail, name).toMatchObject({ age: 86_400 });
    }
  });

  it("a job that fails twice succeeds on its third try; one that keeps failing stops after three", async () => {
    // The same options as every real queue, with a short pause so the test is quick.
    const opts = { ...defaultJobOptions, backoff: { type: "exponential", delay: 20 } };
    const q = new Queue("retry-probe", { connection: bullConnection, prefix, defaultJobOptions: opts });
    const events = new QueueEvents("retry-probe", { connection: bullConnection, prefix });
    opened.push(q, events);
    const tries: Record<string, number> = {};
    const worker = new Worker("retry-probe", async (job) => {
      tries[job.name] = (tries[job.name] ?? 0) + 1;
      if (job.name === "flaky" && tries[job.name]! < 3) throw new Error("not yet");
      if (job.name === "broken") throw new Error("always");
      return "done";
    }, { connection: bullConnection, prefix });
    opened.push(worker);
    await events.waitUntilReady();

    const flaky = await q.add("flaky", {});
    expect(await flaky.waitUntilFinished(events, 10_000)).toBe("done");
    expect(tries.flaky).toBe(3);

    const broken = await q.add("broken", {});
    await expect(broken.waitUntilFinished(events, 10_000)).rejects.toThrow("always");
    expect(tries.broken).toBe(3);
    const kept = await q.getJob(broken.id!);
    expect(kept?.attemptsMade).toBe(3);
    expect(await kept?.getState()).toBe("failed");
    await q.obliterate({ force: true });
  });
});

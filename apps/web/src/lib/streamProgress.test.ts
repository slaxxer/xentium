import { describe, it, expect, vi, beforeEach } from "vitest";

const updates: Array<[number, string]> = [];
const succeeded: string[] = [];
const failed: string[] = [];
let streamChunks: string[] = [];
let responseOk = true;
let hasBody = true;

vi.mock("./dialog", () => ({
  openProgressDialog: () => ({
    update: (percent: number, message: string) => { updates.push([percent, message]); },
    succeed: (m: string) => { succeeded.push(m); },
    fail: (m: string) => { failed.push(m); },
    close: () => {},
  }),
}));

vi.mock("./api", () => ({
  apiStream: async () => ({
    ok: responseOk,
    status: responseOk ? 200 : 500,
    body: hasBody
      ? {
          getReader: () => {
            let i = 0;
            const enc = new TextEncoder();
            return {
              read: async () =>
                i < streamChunks.length
                  ? { done: false, value: enc.encode(streamChunks[i++]) }
                  : { done: true, value: undefined },
            };
          },
        }
      : null,
  }),
}));

const { runStreamedJob } = await import("./streamProgress");

const OPTS = {
  title: "t",
  phaseLabel: (phase?: string, message?: string) => (message ? `${phase} ${message}` : `${phase}`),
  successMessage: () => "done",
  failureMessage: (final: { message?: unknown } | null, err?: unknown) =>
    (final?.message as string) ?? (err instanceof Error ? err.message : "failed"),
};

beforeEach(() => {
  updates.length = 0; succeeded.length = 0; failed.length = 0;
  responseOk = true; hasBody = true;
});

describe("runStreamedJob", () => {
  it("reports each progress event and then success", async () => {
    streamChunks = [
      JSON.stringify({ phase: "downloading", percent: 30 }) + "\n",
      JSON.stringify({ phase: "installing", percent: 80 }) + "\n",
      JSON.stringify({ done: true, ok: true }) + "\n",
    ];
    const res = await runStreamedJob("/x", {}, OPTS);
    expect(res.ok).toBe(true);
    expect(updates).toEqual([[30, "downloading"], [80, "installing"]]);
    expect(succeeded).toEqual(["done"]);
    expect(failed).toEqual([]);
  });

  // The reason this helper exists rather than being copy-pasted: a network chunk
  // can split mid-line, and naive per-chunk JSON.parse loses that event.
  it("handles an event split across two chunks", async () => {
    const line = JSON.stringify({ phase: "downloading", percent: 42 }) + "\n";
    streamChunks = [
      line.slice(0, 12),
      line.slice(12),
      JSON.stringify({ done: true, ok: true }) + "\n",
    ];
    const res = await runStreamedJob("/x", {}, OPTS);
    expect(res.ok).toBe(true);
    expect(updates).toEqual([[42, "downloading"]]);
  });

  it("handles several events arriving in one chunk", async () => {
    streamChunks = [
      JSON.stringify({ phase: "a", percent: 1 }) + "\n" +
      JSON.stringify({ phase: "b", percent: 2 }) + "\n" +
      JSON.stringify({ done: true, ok: true }) + "\n",
    ];
    await runStreamedJob("/x", {}, OPTS);
    expect(updates).toEqual([[1, "a"], [2, "b"]]);
  });

  it("passes the event message through to the label", async () => {
    streamChunks = [
      JSON.stringify({ phase: "downloading", percent: 15, message: "2.1 MB" }) + "\n",
      JSON.stringify({ done: true, ok: true }) + "\n",
    ];
    await runStreamedJob("/x", {}, OPTS);
    expect(updates).toEqual([[15, "downloading 2.1 MB"]]);
  });

  // Failures arrive as a terminal event, not an HTTP status — headers are long
  // since flushed by the time anything can go wrong.
  it("fails with the server's message on a terminal error event", async () => {
    streamChunks = [
      JSON.stringify({ phase: "downloading", percent: 20 }) + "\n",
      JSON.stringify({ done: true, ok: false, message: "sha256 mismatch" }) + "\n",
    ];
    const res = await runStreamedJob("/x", {}, OPTS);
    expect(res.ok).toBe(false);
    expect(failed).toEqual(["sha256 mismatch"]);
    expect(succeeded).toEqual([]);
  });

  it("fails when the stream ends without a terminal event", async () => {
    streamChunks = [JSON.stringify({ phase: "downloading", percent: 20 }) + "\n"];
    const res = await runStreamedJob("/x", {}, OPTS);
    expect(res.ok).toBe(false);
    expect(failed).toEqual(["failed"]);
  });

  // A single malformed line must not abort an install that is otherwise fine.
  it("skips an unparseable line and keeps going", async () => {
    streamChunks = [
      "{not json\n",
      JSON.stringify({ phase: "installing", percent: 80 }) + "\n",
      JSON.stringify({ done: true, ok: true }) + "\n",
    ];
    const res = await runStreamedJob("/x", {}, OPTS);
    expect(res.ok).toBe(true);
    expect(updates).toEqual([[80, "installing"]]);
  });

  it("ignores blank lines", async () => {
    streamChunks = ["\n\n", JSON.stringify({ done: true, ok: true }) + "\n"];
    const res = await runStreamedJob("/x", {}, OPTS);
    expect(res.ok).toBe(true);
    expect(updates).toEqual([]);
  });

  it("fails cleanly on a non-ok response", async () => {
    responseOk = false;
    streamChunks = [];
    const res = await runStreamedJob("/x", {}, OPTS);
    expect(res.ok).toBe(false);
    expect(failed).toEqual(["http_500"]);
  });

  it("fails cleanly when there is no response body", async () => {
    hasBody = false;
    streamChunks = [];
    const res = await runStreamedJob("/x", {}, OPTS);
    expect(res.ok).toBe(false);
  });
});

import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { cacheFor, dropPluginKeys, limitsFor } from "./limits.js";

const P = "lim-test";
afterAll(async () => { await dropPluginKeys(P); await dropPluginKeys("lim-other"); });

describe("plugin rate limits", () => {
  it("refuses the request past the limit, per address", async () => {
    const app = express();
    app.post("/post", limitsFor(P).middleware(`post-${Date.now()}`, { windowSec: 60, max: 2, by: "ip" }) as express.RequestHandler, (_req, res) => { res.json({ ok: true }); });
    expect((await request(app).post("/post")).status).toBe(200);
    expect((await request(app).post("/post")).status).toBe(200);
    const third = await request(app).post("/post");
    expect(third.status).toBe(429);
  });

  it("counts uses of a key and says when it is over", async () => {
    const l = limitsFor(P);
    const name = `vote-${Date.now()}`;
    expect(await l.check(name, "u1", { windowSec: 60, max: 2 })).toMatchObject({ ok: true, remaining: 1 });
    expect(await l.check(name, "u1", { windowSec: 60, max: 2 })).toMatchObject({ ok: true, remaining: 0 });
    const over = await l.check(name, "u1", { windowSec: 60, max: 2 });
    expect(over.ok).toBe(false);
    expect(over.retryAfterSec).toBeGreaterThan(0);
    expect((await l.check(name, "u2", { windowSec: 60, max: 2 })).ok).toBe(true);
  });
});

describe("plugin cache", () => {
  it("keeps each plugin's values to itself, and forgets them on uninstall", async () => {
    const mine = cacheFor(P), theirs = cacheFor("lim-other");
    await mine.set("top", { n: 1 });
    expect(await mine.get("top")).toEqual({ n: 1 });
    expect(await theirs.get("top")).toBeNull();
    let calls = 0;
    const compute = () => { calls++; return 42; };
    expect(await mine.remember("answer", 60, compute)).toBe(42);
    expect(await mine.remember("answer", 60, compute)).toBe(42);
    expect(calls).toBe(1);
    await dropPluginKeys(P);
    expect(await mine.get("top")).toBeNull();
  });
});

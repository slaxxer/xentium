/**
 * The request log never carries credentials. Until rc.2 every request's
 * Authorization header and cookies (the 30-day refresh token among them) went to
 * the journal in production.
 */
import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import express from "express";
import pinoHttp from "pino-http";
import request from "supertest";

const { HTTP_LOG_REDACT } = await import("../app/app.js");

describe("the request log", () => {
  it("redacts the access token, request cookies and cookies the response sets", async () => {
    const lines: string[] = [];
    const sink = new Writable({ write(chunk, _enc, done) { lines.push(String(chunk)); done(); } });
    const app = express();
    app.use(pinoHttp({ redact: HTTP_LOG_REDACT }, sink));
    app.get("/x", (_req, res) => { res.cookie("xt_refresh", "refresh-secret").json({ ok: true }); });

    await request(app).get("/x")
      .set("Authorization", "Bearer access-secret")
      .set("Cookie", "xt_refresh=old-refresh-secret; xt_locale=de");

    const out = lines.join("\n");
    expect(out).toContain("request completed");
    expect(out).not.toMatch(/access-secret|refresh-secret/);
    expect(out).toContain("[redacted]");
  });
});

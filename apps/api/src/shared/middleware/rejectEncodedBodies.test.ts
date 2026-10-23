/**
 * A compressed request body never reaches a decompressor (CVE-2026-111497).
 */
import { brotliCompressSync, gzipSync } from "node:zlib";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { rejectEncodedBodies } from "./rejectEncodedBodies.js";

const app = express();
app.use(rejectEncodedBodies);
app.use(express.json({ inflate: false }));
app.post("/echo", (req, res) => { res.json({ got: req.body }); });

const body = Buffer.from(JSON.stringify({ hello: "world" }));

describe("rejectEncodedBodies", () => {
  it("refuses a Brotli body with 415 before parsing it", async () => {
    const res = await request(app).post("/echo")
      .set("content-type", "application/json").set("content-encoding", "br")
      .send(brotliCompressSync(body));
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("XEC-API-4150");
  });

  it("refuses gzip and deflate too, whatever the case", async () => {
    for (const enc of ["gzip", "GZIP", "deflate"]) {
      const res = await request(app).post("/echo")
        .set("content-type", "application/json").set("content-encoding", enc)
        .send(gzipSync(body));
      expect(res.status, enc).toBe(415);
    }
  });

  it("lets plain and identity bodies through", async () => {
    expect((await request(app).post("/echo").send({ hello: "world" })).body).toEqual({ got: { hello: "world" } });
    const res = await request(app).post("/echo")
      .set("content-type", "application/json").set("content-encoding", "identity")
      .send(body.toString());
    expect(res.body).toEqual({ got: { hello: "world" } });
  });
});

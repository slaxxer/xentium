/**
 * What the stylesheet response TELLS a client about itself.
 *
 * A theme is applied live (no publish step), so the loudest moment for this endpoint
 * is the second right after a switch. It used to answer `max-age=60`, which meant a
 * page loaded in that window painted the previous theme — and, because the client
 * compared stream events to each other rather than to what it was holding, kept it.
 * Both halves of the fix are pinned: the response revalidates, and it names the
 * version it carries so the client can tell stale from current (see
 * `apps/web/src/lib/liveStyle.test.ts` for the other side of the contract).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const state = { version: 1788111319980, live: ":root { --c-accent: #2f9e5e; }" };

vi.mock("./appearance.service.js", () => ({
  appearanceService: {
    getLiveCss:              async () => state.live,
    getStyleVersion:         async () => state.version,
    buildCSS:                async () => ":root { --c-accent: #ff5c39; }",
    getEffectiveDraftTokens: async () => ({ light: {}, dark: {} }),
  },
  parseColourwayId: () => null,
}));

const { appearanceRouter } = await import("./appearance.routes.js");

function app() {
  const a = express();
  a.use("/api/appearance", appearanceRouter);
  return a;
}

beforeEach(() => { state.version = 1788111319980; });

describe("GET /appearance/css freshness", () => {
  it("revalidates rather than being held, and still answers 304 with no body", async () => {
    const first = await request(app()).get("/api/appearance/css");
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-cache");

    // The ETag is what keeps "always current" from meaning "always re-downloaded".
    const etag = String(first.headers.etag ?? "");
    expect(etag).not.toBe("");
    const again = await request(app())
      .get("/api/appearance/css")
      .set("If-None-Match", etag);
    expect(again.status).toBe(304);
    expect(again.text).toBeFalsy();
  });

  it("names the version it carries", async () => {
    const res = await request(app()).get("/api/appearance/css");
    expect(res.headers["x-style-version"]).toBe(String(state.version));
    // Exposed, or a cross-origin client cannot read the header it needs.
    expect(res.headers["access-control-expose-headers"]).toContain("X-Style-Version");
  });

  it("does NOT stamp the draft — it is not what the stream announces", async () => {
    // A stamped draft would let a preview reconcile itself back to the live theme.
    const res = await request(app()).get("/api/appearance/css?source=draft");
    expect(res.status).toBe(200);
    expect(res.headers["x-style-version"]).toBeUndefined();
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

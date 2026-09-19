import { describe, expect, it } from "vitest";
import { nodeRow, postgresRow, redisRow } from "./requirementRows.js";

describe("the environment rows", () => {
  it("refuses Node 20, which the wizard used to accept", () => {
    const row = nodeRow("20.18.0");
    expect(row.ok).toBe(false);
    expect(row.detail).toContain("Required: 22.12+");
  });

  it("passes Node 22.12 with a warning, and 24 cleanly", () => {
    expect(nodeRow("22.12.0")).toMatchObject({ ok: true, warn: true });
    expect(nodeRow("24.1.0")).toMatchObject({ ok: true });
    expect(nodeRow("24.1.0").warn).toBeUndefined();
  });

  it("warns on Postgres 14 to 16, refuses below 14", () => {
    expect(postgresRow("13.9").ok).toBe(false);
    expect(postgresRow("16.4")).toMatchObject({ ok: true, warn: true });
    expect(postgresRow("17.2").warn).toBeUndefined();
  });

  it("warns when Redis can evict queued jobs, and says what to set", () => {
    const row = redisRow("7.2.4", "allkeys-lru");
    expect(row).toMatchObject({ ok: true, warn: true });
    expect(row.detail).toContain('"noeviction"');
  });

  it("does not warn when the policy is right, or can't be read", () => {
    expect(redisRow("7.2.4", "noeviction").warn).toBeUndefined();
    // Managed Redis often disables CONFIG; not knowing isn't a warning.
    expect(redisRow("7.2.4", null).warn).toBeUndefined();
  });

  it("still refuses an old Redis, whatever its policy", () => {
    expect(redisRow("5.0.7", "allkeys-lru").ok).toBe(false);
  });
});

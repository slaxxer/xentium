/**
 * Token primitives.
 *
 * The `ims` claim is the one non-obvious thing here and the reason this file
 * exists: the standard `iat` claim is second-granular, so a token minted in the
 * same second as a revocation is ambiguous against the denylist. `ims` carries
 * milliseconds and gives the check exact ordering. Lose it and revocation goes
 * quietly racy — a token issued microseconds before a ban survives it.
 */
import { describe, expect, it } from "vitest";
import { createTokenService, ACCESS_TTL_SECONDS } from "./tokens.js";

const svc = createTokenService({
  accessSecret: "access-secret-with-enough-entropy",
  refreshHmacSecret: "refresh-hmac-secret",
});

describe("createTokenService", () => {
  it("round-trips an access token", async () => {
    const token = await svc.issueAccess("user-1", "session-1");
    await expect(svc.verifyAccess(token)).resolves.toMatchObject({
      userId: "user-1",
      sessionId: "session-1",
    });
  });

  it("carries a millisecond issue time", async () => {
    const before = Date.now();
    const claims = await svc.verifyAccess(await svc.issueAccess("u", "s"));
    // Second-granular would fail this the moment `before` is not on a boundary.
    expect(claims.issuedAtMs).toBeGreaterThanOrEqual(before);
    expect(claims.issuedAtMs).toBeLessThanOrEqual(Date.now());
  });

  it("refuses a token signed with a different secret", async () => {
    const stranger = createTokenService({
      accessSecret: "a-completely-different-secret",
      refreshHmacSecret: "x",
    });
    const token = await stranger.issueAccess("u", "s");
    await expect(svc.verifyAccess(token)).rejects.toBeTruthy();
  });

  it("refuses a tampered token", async () => {
    const token = await svc.issueAccess("u", "s");
    const [h, p, sig] = token.split(".");
    await expect(svc.verifyAccess(`${h}.${p}.${sig!.slice(0, -2)}xy`)).rejects.toBeTruthy();
  });

  it("expires an access token after its TTL", async () => {
    const short = createTokenService({
      accessSecret: "s",
      refreshHmacSecret: "s",
      accessTtlSeconds: -1, // already past
    });
    await expect(short.verifyAccess(await short.issueAccess("u", "s"))).rejects.toBeTruthy();
  });

  it("hashes refresh tokens deterministically, and never stores the raw value", () => {
    const raw = svc.generateRefreshToken();
    const hash = svc.hashRefreshToken(raw);
    expect(hash).toBe(svc.hashRefreshToken(raw));
    expect(hash).not.toContain(raw);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keys the refresh hash on the secret, so a stolen database is not enough", () => {
    const other = createTokenService({ accessSecret: "a", refreshHmacSecret: "different" });
    const raw = "the-same-token";
    expect(other.hashRefreshToken(raw)).not.toBe(svc.hashRefreshToken(raw));
  });

  it("generates unguessable, unique refresh tokens", () => {
    const seen = new Set(Array.from({ length: 200 }, () => svc.generateRefreshToken()));
    expect(seen.size).toBe(200);
    expect([...seen][0]!.length).toBeGreaterThanOrEqual(42);
  });

  it("dates refresh expiry 30 days out", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(svc.refreshExpiryFrom(now).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("exposes the access TTL the revocation markers are sized against", () => {
    expect(ACCESS_TTL_SECONDS).toBe(15 * 60);
  });
});

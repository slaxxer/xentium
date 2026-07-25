import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory Redis stand-in — only the two ops the module uses.
const store = new Map<string, string>();
vi.mock("../../infrastructure/redis.js", () => ({
  rkey: (...parts: string[]) => parts.join(":"),
  redis: {
    set: vi.fn(async (key: string, val: string) => { store.set(key, val); return "OK"; }),
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
  },
}));

const {
  revokeUserAccessTokens,
  revokeSessionAccessToken,
  isAccessTokenRevoked,
} = await import("./session-revocation.js");

const nowMs = () => Date.now();

describe("session-revocation denylist", () => {
  beforeEach(() => store.clear());

  it("a token is not revoked by default", async () => {
    expect(await isAccessTokenRevoked("u1", "s1", nowMs())).toBe(false);
  });

  it("revoking a session rejects that session's token", async () => {
    await revokeSessionAccessToken("s1");
    expect(await isAccessTokenRevoked("u1", "s1", nowMs())).toBe(true);
    // ...but a different session for the same user is unaffected
    expect(await isAccessTokenRevoked("u1", "s2", nowMs())).toBe(false);
  });

  it("revoking a user rejects tokens issued before the revocation", async () => {
    const oldTokenMs = nowMs() - 60_000; // issued a minute ago
    await revokeUserAccessTokens("u1");
    expect(await isAccessTokenRevoked("u1", "any", oldTokenMs)).toBe(true);
  });

  it("a fresh login after user revocation is NOT rejected (ms precision)", async () => {
    await revokeUserAccessTokens("u1");
    // token minted just after the revocation timestamp
    const freshTokenMs = nowMs() + 1;
    expect(await isAccessTokenRevoked("u1", "any", freshTokenMs)).toBe(false);
  });

  it("user revocation does not affect a different user", async () => {
    await revokeUserAccessTokens("u1");
    expect(await isAccessTokenRevoked("u2", "s9", nowMs() - 60_000)).toBe(false);
  });

  it("missing issue-time with a user revocation present is treated as not-revoked (epoch check skipped)", async () => {
    await revokeUserAccessTokens("u1");
    // Session-scoped revocation still works without an issue time; user-epoch needs it.
    expect(await isAccessTokenRevoked("u1", "s1", undefined)).toBe(false);
    await revokeSessionAccessToken("s1");
    expect(await isAccessTokenRevoked("u1", "s1", undefined)).toBe(true);
  });
});

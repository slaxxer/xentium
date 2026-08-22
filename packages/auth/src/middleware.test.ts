/**
 * The two request guards.
 *
 * The case that matters most is the one that is easy to lose in a refactor: a
 * VALID signature whose session or user has been revoked must still be refused.
 * Access tokens live 15 minutes, so without the denylist check a banned user
 * keeps working for a quarter of an hour — the exact bug the denylist exists
 * for.
 *
 * The second is `persist: false` on both rejection shapes. Guests hitting a
 * protected route and clients riding into the 15-minute expiry are constant
 * traffic; persisting them buries everything worth reading in the error log.
 */
import { describe, expect, it, vi } from "vitest";
import { createAuthMiddleware } from "./middleware.js";
import type { AccessClaims } from "./tokens.js";

const claims: AccessClaims = { userId: "u1", sessionId: "s1", issuedAtMs: 1_000 };

function build(opts: {
  verify?: (t: string) => Promise<AccessClaims>;
  revoked?: boolean;
  onAuthenticated?: (userId: string) => void;
} = {}) {
  return createAuthMiddleware({
    verifyAccess: opts.verify ?? (async () => claims),
    isAccessTokenRevoked: async () => opts.revoked ?? false,
    ...(opts.onAuthenticated ? { onAuthenticated: opts.onAuthenticated } : {}),
  });
}

const reqWith = (auth?: string) =>
  ({ headers: auth ? { authorization: auth } : {} }) as never;

async function run(mw: ReturnType<typeof build>["requireAuth"], auth?: string) {
  const req = reqWith(auth) as unknown as { userId?: string; sessionId?: string };
  const next = vi.fn();
  let thrown: unknown;
  try {
    await mw(req as never, {} as never, next);
  } catch (e) {
    thrown = e;
  }
  return { req, next, thrown };
}

describe("requireAuth", () => {
  it("attaches identity and continues", async () => {
    const { req, next, thrown } = await run(build().requireAuth, "Bearer token");
    expect(thrown).toBeUndefined();
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe("u1");
    expect(req.sessionId).toBe("s1");
  });

  it("rejects a missing token without persisting the error", async () => {
    const { thrown, next } = await run(build().requireAuth);
    expect(next).not.toHaveBeenCalled();
    expect(thrown).toMatchObject({ code: "NEC-AUTH-1008", httpStatus: 401, persist: false });
  });

  it("rejects an unverifiable token without persisting", async () => {
    const mw = build({ verify: async () => { throw new Error("bad signature"); } }).requireAuth;
    const { thrown } = await run(mw, "Bearer nope");
    expect(thrown).toMatchObject({ code: "NEC-AUTH-1009", httpStatus: 401, persist: false });
  });

  it("rejects a VALID token whose session or user has been revoked", async () => {
    const { thrown, next } = await run(build({ revoked: true }).requireAuth, "Bearer token");
    expect(next).not.toHaveBeenCalled();
    expect(thrown).toMatchObject({ code: "NEC-AUTH-1009" });
  });

  it("fires the presence hook without awaiting it", async () => {
    const seen: string[] = [];
    const { next } = await run(build({ onAuthenticated: (id) => seen.push(id) }).requireAuth, "Bearer t");
    expect(seen).toEqual(["u1"]);
    expect(next).toHaveBeenCalled();
  });

  it("accepts a header with no Bearer prefix, as it always has", async () => {
    // Leniency preserved verbatim from before the extraction. Tightening it is a
    // deliberate change, not a refactor side effect.
    const { req, thrown } = await run(build().requireAuth, "rawtoken");
    expect(thrown).toBeUndefined();
    expect(req.userId).toBe("u1");
  });
});

describe("optionalAuth", () => {
  it("attaches identity when the token is good", async () => {
    const { req, next } = await run(build().optionalAuth, "Bearer token");
    expect(req.userId).toBe("u1");
    expect(next).toHaveBeenCalled();
  });

  it("continues anonymously with no token", async () => {
    const { req, next, thrown } = await run(build().optionalAuth);
    expect(thrown).toBeUndefined();
    expect(req.userId).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("continues anonymously with a bad token rather than throwing", async () => {
    const mw = build({ verify: async () => { throw new Error("bad"); } }).optionalAuth;
    const { req, next, thrown } = await run(mw, "Bearer nope");
    expect(thrown).toBeUndefined();
    expect(req.userId).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

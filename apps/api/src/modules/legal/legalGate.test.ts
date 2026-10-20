/**
 * The server side of "accept before going on": a signed-in member with a legal
 * document still to accept gets 403 XEC-AUTH-2012 everywhere except auth, the legal
 * pages and the read-only public chrome; accepting lets them through again.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { createSession } from "../auth/auth.tokens.js";
import { legalService } from "./legal.service.js";
import { bustLegalGate, legalGate } from "./legalGate.js";

const P = "lggate";
let userId = "", token = "";
const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Terms" }] }] };

async function clean() {
  await prisma.legalDocument.deleteMany({});
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
}

/** Run the gate: null = passed, else the error's code. */
async function gate(method: string, path: string, auth = `Bearer ${token}`): Promise<string | null> {
  const req = { method, path, headers: { authorization: auth } } as unknown as Request;
  try {
    let passed = false;
    await legalGate(req, {} as never, () => { passed = true; });
    return passed ? null : "stopped";
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
}

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  bustLegalGate();
  userId = (await prisma.user.create({ data: { email: `${P}@example.test`, username: P, passwordHash: "x" } })).id;
  token = (await createSession(userId, { ip: "127.0.0.1", userAgent: "test" })).accessToken;
});
afterEach(async () => { await clean(); bustLegalGate(); });

async function requireTerms() {
  await legalService.saveDraft("terms", doc, null as unknown as string);
  await legalService.publish("terms", null as unknown as string);
  await legalService.setRequireAcceptance("terms", true, null as unknown as string);
  bustLegalGate();
}

describe("legal gate", () => {
  it("lets everything through while nothing must be accepted", async () => {
    expect(await gate("POST", "/articles")).toBeNull();
  });

  it("refuses a member with a document pending, except auth, legal and public reads", async () => {
    await requireTerms();
    expect(await gate("POST", "/articles")).toBe("XEC-AUTH-2012");
    expect(await gate("GET", "/notifications")).toBe("XEC-AUTH-2012");
    expect(await gate("GET", "/admin/users")).toBe("XEC-AUTH-2012");
    expect(await gate("GET", "/p/xentium-forum/threads")).toBe("XEC-AUTH-2012");
    expect(await gate("POST", "/site")).toBe("XEC-AUTH-2012");      // public chrome is read-only
    expect(await gate("GET", "/sitemap")).toBe("XEC-AUTH-2012");    // a prefix match needs the slash
    expect(await gate("GET", "/auth/me")).toBeNull();
    expect(await gate("POST", "/auth/legal-consent")).toBeNull();
    expect(await gate("GET", "/legal/terms")).toBeNull();
    expect(await gate("GET", "/site")).toBeNull();
    expect(await gate("GET", "/appearance/css")).toBeNull();
    expect(await gate("POST", "/articles", "")).toBeNull();                 // guests
    expect(await gate("POST", "/articles", "Bearer not-a-token")).toBeNull(); // the route guard refuses
  });

  it("lets the member through once they accept", async () => {
    await requireTerms();
    expect(await gate("POST", "/articles")).toBe("XEC-AUTH-2012");
    await legalService.accept(userId, ["terms"]);
    bustLegalGate(userId);
    expect(await gate("POST", "/articles")).toBeNull();
  });
});

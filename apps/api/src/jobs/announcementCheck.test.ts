/**
 * The announcement channel's only real defence.
 *
 * A broadcast is a string the marketplace supplies and this instance renders in
 * a modal in front of an administrator. The signature is what makes that safe,
 * and every way it could silently stop being checked ends the same way: someone
 * who can answer for the license server — a proxy, a DNS hijack, a
 * mis-pointed LICENSE_SERVER_URL — gets to put "confirm your admin password" in
 * the most trusted surface the product has.
 *
 * So each of these is a thing that must NOT get through, pinned:
 *   1. a payload edited after signing
 *   2. an announcement signed with a different key
 *   3. one whose signature has expired
 *   4. one carrying `javascript:` where a link should be
 *   5. one with no English copy, which nothing could be guaranteed to render
 *
 * ...and a genuine one, so a check that rejects everything fails here too.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { SignJWT, exportSPKI, generateKeyPair, type CryptoKey } from "jose";

const PORT = 4931;

// The settings row the job writes, captured instead of stored.
let written: string | null = null;

vi.mock("../infrastructure/db.js", () => ({
  prisma: {
    setting: {
      findUnique: async () => (written === null ? null : { key: "announcements", value: written }),
      upsert: async ({ create }: { create: { value: string } }) => { written = create.value; },
    },
  },
}));

vi.mock("../shared/utils/settings.js", () => ({ bustSettingsCache: () => {} }));
vi.mock("../infrastructure/logging/logger.js", () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}));

// The instance's view of who the marketplace is. Set before the module under
// test is imported, because env.ts reads it at load.
vi.mock("../config/env.js", () => ({
  env: { LICENSE_SERVER_URL: `http://127.0.0.1:${PORT}/api/v1` },
  isDev: true,
  isProd: false,
}));

const marketplace = await generateKeyPair("RS256");
const impostor = await generateKeyPair("RS256");

// The verifier reads the real public key through license-engine; give it the
// marketplace half of the pair these tests sign with.
vi.mock("../core/license-engine/license-engine.js", async () => {
  const jose = await import("jose");
  return {
    getMarketplacePublicKey: async () =>
      jose.importSPKI(await exportSPKI(marketplace.publicKey), "RS256"),
  };
});

type Claims = Record<string, unknown>;

const GENUINE: Claims = {
  id: "real-1",
  severity: "important",
  publishedAt: "2026-09-25T10:00:00.000Z",
  expiresAt: null,
  link: "https://xentium.org/blog/notice",
  locales: {
    en: { title: "A real notice", body: "From the Xentium team." },
    de: { title: "Eine echte Nachricht", body: "Vom Xentium-Team." },
  },
};

async function sign(claims: Claims, key: CryptoKey, expires = "1h"): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(key);
}

let served: string[] = [];
let server: Server;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ announcements: served }));
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function run(tokens: string[]) {
  served = tokens;
  written = null;
  const { processAnnouncementCheck } = await import("./announcementCheck.js");
  await processAnnouncementCheck();
  return JSON.parse(written ?? '{"announcements":[]}') as {
    announcements: { id: string; link: string | null; locales: Record<string, unknown> }[];
  };
}

describe("announcement verification", () => {
  it("accepts one the marketplace actually signed", async () => {
    const cache = await run([await sign(GENUINE, marketplace.privateKey)]);
    expect(cache.announcements.map((a) => a.id)).toEqual(["real-1"]);
    expect(Object.keys(cache.announcements[0]!.locales).sort()).toEqual(["de", "en"]);
  });

  it("rejects a payload edited after signing", async () => {
    const genuine = await sign(GENUINE, marketplace.privateKey);
    const [header, payload, signature] = genuine.split(".");
    const edited = JSON.parse(Buffer.from(payload!, "base64url").toString()) as typeof GENUINE;
    (edited.locales as Record<string, { title: string }>).en!.title = "Confirm your admin password";
    const tampered = [
      header,
      Buffer.from(JSON.stringify(edited)).toString("base64url"),
      signature,
    ].join(".");

    const cache = await run([tampered]);
    expect(cache.announcements).toEqual([]);
  });

  it("rejects one signed with someone else's key", async () => {
    const forged = await sign(
      { ...GENUINE, id: "forged-1", locales: { en: { title: "Urgent", body: "Click here." } } },
      impostor.privateKey,
    );
    const cache = await run([forged]);
    expect(cache.announcements).toEqual([]);
  });

  it("rejects one whose signature has expired", async () => {
    // Expiry is carried by the JWT's own `exp` precisely so that it is enforced
    // by the thing that already has to be right, rather than by a second rule.
    const stale = await sign({ ...GENUINE, id: "stale-1" }, marketplace.privateKey, "-1h");
    const cache = await run([stale]);
    expect(cache.announcements).toEqual([]);
  });

  it("drops a non-https link but keeps the announcement", async () => {
    const withScript = await sign(
      { ...GENUINE, id: "link-1", link: "javascript:alert(document.cookie)" },
      marketplace.privateKey,
    );
    const cache = await run([withScript]);
    expect(cache.announcements).toHaveLength(1);
    expect(cache.announcements[0]!.link).toBeNull();
  });

  it("rejects one with no English copy", async () => {
    // English is the fallback every instance can read; without it there is no
    // guarantee this install could render the thing at all.
    const noEnglish = await sign(
      { ...GENUINE, id: "de-only", locales: { de: { title: "Nur Deutsch", body: "Text." } } },
      marketplace.privateKey,
    );
    const cache = await run([noEnglish]);
    expect(cache.announcements).toEqual([]);
  });

  it("keeps the genuine one when it arrives beside forgeries", async () => {
    const cache = await run([
      await sign({ ...GENUINE, id: "forged-2" }, impostor.privateKey),
      await sign(GENUINE, marketplace.privateKey),
      await sign({ ...GENUINE, id: "forged-3" }, impostor.privateKey),
    ]);
    expect(cache.announcements.map((a) => a.id)).toEqual(["real-1"]);
  });
});

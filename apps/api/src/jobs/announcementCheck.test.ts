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
 *
 * Then the other rule: once an admin reads one it is gone from this site, and
 * the next check must not bring it back — while the list that remembers that
 * must not outlive the announcement.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { SignJWT, exportSPKI, generateKeyPair, type CryptoKey } from "jose";

const PORT = 4931;

// The settings rows the job writes, kept in memory instead of a database.
const store = new Map<string, string>();

vi.mock("../infrastructure/db.js", () => {
  const db = {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null,
      upsert: async ({ where, create }: { where: { key: string }; create: { value: string } }) => {
        store.set(where.key, create.value);
      },
    },
    $executeRaw: async () => 0,
  };
  return { prisma: { ...db, $transaction: async (fn: (tx: typeof db) => unknown) => fn(db) } };
});

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

type Cache = { announcements: { id: string; link: string | null; locales: Record<string, unknown> }[] };

const cached = (): Cache => JSON.parse(store.get("announcements") ?? '{"announcements":[]}') as Cache;
const dismissed = (): string[] => JSON.parse(store.get("announcements.dismissed") ?? "[]") as string[];

/** One check against `tokens`. `fresh` starts from an empty instance. */
async function run(tokens: string[], { fresh = true } = {}) {
  served = tokens;
  if (fresh) store.clear();
  const { processAnnouncementCheck } = await import("./announcementCheck.js");
  await processAnnouncementCheck();
  return cached();
}

async function dismiss(id: string) {
  const { dismissAnnouncement } = await import("./announcementCheck.js");
  await dismissAnnouncement(id);
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

describe("reading an announcement", () => {
  it("removes it from the site and keeps only its id", async () => {
    await run([await sign(GENUINE, marketplace.privateKey)]);
    await dismiss("real-1");
    expect(cached().announcements).toEqual([]);
    expect(dismissed()).toEqual(["real-1"]);
  });

  it("does not come back on the next check while the marketplace still serves it", async () => {
    const token = await sign(GENUINE, marketplace.privateKey);
    await run([token]);
    await dismiss("real-1");
    const cache = await run([token], { fresh: false });
    expect(cache.announcements).toEqual([]);
    expect(dismissed()).toEqual(["real-1"]);
  });

  it("lets a newer announcement through beside a read one", async () => {
    const first = await sign(GENUINE, marketplace.privateKey);
    await run([first]);
    await dismiss("real-1");
    const second = await sign({ ...GENUINE, id: "real-2", publishedAt: "2026-09-26T10:00:00.000Z" }, marketplace.privateKey);
    const cache = await run([first, second], { fresh: false });
    expect(cache.announcements.map((a) => a.id)).toEqual(["real-2"]);
  });

  it("forgets the id once the marketplace stops serving it", async () => {
    await run([await sign(GENUINE, marketplace.privateKey)]);
    await dismiss("real-1");
    await run([], { fresh: false });
    expect(dismissed()).toEqual([]);
  });

  it("ignores an id the site does not hold", async () => {
    await run([await sign(GENUINE, marketplace.privateKey)]);
    await dismiss("never-served");
    expect(cached().announcements.map((a) => a.id)).toEqual(["real-1"]);
    expect(dismissed()).toEqual([]);
  });
});

describe("only the most recent announcement", () => {
  const at = (id: string, day: number) =>
    sign({ ...GENUINE, id, publishedAt: `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z` }, marketplace.privateKey);

  it("is shown to a fresh install, not the backlog", async () => {
    const cache = await run([await at("old-1", 10), await at("newest", 20), await at("old-2", 15)]);
    expect(cache.announcements.map((a) => a.id)).toEqual(["newest"]);
  });

  it("is not replaced by an older one once it has been read", async () => {
    const tokens = [await at("old-1", 10), await at("newest", 20)];
    await run(tokens);
    await dismiss("newest");
    const cache = await run(tokens, { fresh: false });
    expect(cache.announcements).toEqual([]);
    expect(dismissed()).toEqual(["newest"]);
  });

  it("gives way to a newer one when the team publishes again", async () => {
    await run([await at("first", 10)]);
    await dismiss("first");
    const cache = await run([await at("first", 10), await at("second", 12)], { fresh: false });
    expect(cache.announcements.map((a) => a.id)).toEqual(["second"]);
  });

  it("does not bring back an older one that was already read when the newest expires", async () => {
    // Day 10 is read, then day 20 arrives and is read too.
    await run([await at("old", 10)]);
    await dismiss("old");
    await run([await at("old", 10), await at("newest", 20)], { fresh: false });
    await dismiss("newest");
    // Day 20 expires; the marketplace's newest live one is day 10 again.
    const cache = await run([await at("old", 10)], { fresh: false });
    expect(cache.announcements).toEqual([]);
  });

  it("does not show an older one after a newer one was read, even unseen", async () => {
    await run([await at("newest", 20)]);
    await dismiss("newest");
    const cache = await run([await at("older-unseen", 15)], { fresh: false });
    expect(cache.announcements).toEqual([]);
  });

  it("drops an announcement whose expiry has passed, and shows the live one before it", async () => {
    const expired = await sign(
      { ...GENUINE, id: "expired-newest", publishedAt: "2026-09-21T10:00:00.000Z" },
      marketplace.privateKey, "-1m",
    );
    const cache = await run([expired, await at("live", 18)]);
    expect(cache.announcements.map((a) => a.id)).toEqual(["live"]);
  });
});

describe("the navbar gear's dot", () => {
  const cache = (announcements: { severity: string; expiresAt: string | null }[]) =>
    ({ checkedAt: "", announcements: announcements.map((a, i) => ({ id: `a${i}`, publishedAt: "", link: null, locales: {}, ...a })) }) as never;

  it("is lit by an unread announcement, urgent only when it is not info", async () => {
    const { pendingAnnouncement } = await import("./announcementCheck.js");
    expect(pendingAnnouncement(cache([{ severity: "info", expiresAt: null }]))).toEqual({ pending: true, urgent: false });
    expect(pendingAnnouncement(cache([{ severity: "critical", expiresAt: null }]))).toEqual({ pending: true, urgent: true });
  });

  it("goes out when nothing is waiting, or the one waiting has expired", async () => {
    const { pendingAnnouncement } = await import("./announcementCheck.js");
    expect(pendingAnnouncement(null)).toEqual({ pending: false, urgent: false });
    expect(pendingAnnouncement(cache([]))).toEqual({ pending: false, urgent: false });
    const now = Date.parse("2026-09-27T12:00:00.000Z");
    expect(pendingAnnouncement(cache([{ severity: "important", expiresAt: "2026-09-27T11:00:00.000Z" }]), now))
      .toEqual({ pending: false, urgent: false });
  });
});

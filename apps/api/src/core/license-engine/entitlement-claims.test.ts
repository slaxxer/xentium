/**
 * The claim shape is a CONTRACT, and this is the alarm on it.
 *
 * The marketplace signs entitlements; the verifying half is compiled into every
 * install. When the two drift, nothing throws — `getEntitlementStatus` simply
 * reports `missing` for a plugin the site demonstrably owns, and the admin sees
 * a licensed plugin refuse to enable with no explanation on either end.
 *
 * That is exactly what happened: grants are signed as objects (`{id,
 * updatesUntil?}`, so a lapsed-updates licence is distinguishable from a dead
 * one) while this side matched them as bare strings. Typecheck, lint, build and
 * the whole suite were green throughout.
 *
 * The JWT below is built the way the marketplace builds one. If a future change
 * to either end breaks the pairing, this fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem  = publicKey.export({ type: "spki", format: "pem" }).toString();

// Verified against the key this test owns, not whatever .env holds.
vi.stubEnv("LICENSE_PUBLIC_KEY", publicPem);

const license: { row: Record<string, unknown> | null } = { row: null };

vi.mock("../../infrastructure/db.js", () => ({
  prisma: {
    install: { findFirst: async () => ({ siteId: "9f1c8a04-1c2b-4d3e-9f10-abcdef012345" }) },
    entitlement: { findFirst: async () => license.row },
    setting: { findUnique: async () => null },
  },
}));

const { getEntitlementStatus } = await import("./license-engine.js");

/** Signed exactly as the marketplace's entitlement.service does. */
async function issue(entitlements: unknown[], opts: { expiresIn?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (opts.expiresIn ?? 30 * 24 * 3600);
  return new SignJWT({
    siteId:       "9f1c8a04-1c2b-4d3e-9f10-abcdef012345",
    licenseRef:   "XEN-LBP7-4K2M",
    environment:  "development",
    entitlements,
    issuedAt:     now,
    expiresAt,
    refreshAfter: now + 7 * 24 * 3600,
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(await importPKCS8(privatePem, "RS256"));
}

beforeEach(() => {
  license.row = null;
});

describe("entitlement claims", () => {
  it("resolves a grant the marketplace actually signs", async () => {
    license.row = {
      id: "lic_1",
      entitlementJwt: await issue([
        { id: "plugin.layout-blocks-pro", updatesUntil: 1813365624 },
        { id: "plugin.xentium-messaging" },
      ]),
      activatedAt: new Date(),
      refreshAfter: new Date(),
      domain: "kern.studio",
    };

    await expect(getEntitlementStatus("layout-blocks-pro")).resolves.toMatchObject({ state: "valid" });
    await expect(getEntitlementStatus("xentium-messaging")).resolves.toMatchObject({ state: "valid" });
  });

  it("still reports missing for a plugin no grant covers", async () => {
    license.row = {
      id: "lic_1",
      entitlementJwt: await issue([{ id: "plugin.layout-blocks-pro" }]),
      activatedAt: new Date(),
      refreshAfter: new Date(),
      domain: "kern.studio",
    };

    await expect(getEntitlementStatus("xentium-analytics")).resolves.toMatchObject({ state: "missing" });
  });

  it("does not match a grant by prefix or substring", async () => {
    // `plugin.forum-pro` must not satisfy `forum`. Matching on anything looser
    // than equality turns a cheap plugin id into a licence for an expensive one.
    license.row = {
      id: "lic_1",
      entitlementJwt: await issue([{ id: "plugin.forum-pro" }]),
      activatedAt: new Date(),
      refreshAfter: new Date(),
      domain: "kern.studio",
    };

    await expect(getEntitlementStatus("forum")).resolves.toMatchObject({ state: "missing" });
  });

  it("returns missing, not a crash, when a grant arrives in the OLD bare-string shape", async () => {
    // Belt and braces: a stored JWT from before the shapes were aligned must
    // degrade to "you do not own this" (recoverable by a refresh), never to an
    // exception inside the plugin-enable path.
    license.row = {
      id: "lic_1",
      entitlementJwt: await issue(["plugin.layout-blocks-pro"]),
      activatedAt: new Date(),
      refreshAfter: new Date(),
      domain: "kern.studio",
    };

    await expect(getEntitlementStatus("layout-blocks-pro")).resolves.toMatchObject({ state: "missing" });
  });
});

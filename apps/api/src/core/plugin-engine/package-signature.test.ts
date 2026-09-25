/**
 * What a package is allowed to claim about itself.
 *
 * The badge an admin reads — "reviewed by Xentium" — is only worth the checks
 * behind it, and every one of these is a way an attacker would try to get that
 * badge onto code we never looked at:
 *
 *   - sign it with their own key
 *   - take our signature off a real package and put it on theirs
 *   - take our signature and edit the code underneath it
 *   - take our signature for version 1.0.0 and ship it on 1.0.1
 *
 * Each has to be a REFUSAL, not a downgrade to "unverified". A package claiming
 * a review it cannot prove is hostile, and treating it as merely unsigned hands
 * the attacker the outcome they wanted — because unsigned installs fine.
 *
 * And the boring case has to keep working: a developer's own build carries no
 * signature and must install without ceremony.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import AdmZip from "adm-zip";
import { SignJWT, exportSPKI, generateKeyPair, type CryptoKey } from "jose";
import { SIGNATURE_ENTRY, computeContentDigest } from "@xentium/plugin-engine";

const xentium = await generateKeyPair("RS256");
const impostor = await generateKeyPair("RS256");

// The verifier asks license-engine for the bundled key. Hand it ours, and pin
// that it asks with the override DISABLED — an env var must not be able to move
// what counts as a Xentium review.
const askedWith: Array<{ allowOverride?: boolean } | undefined> = [];

vi.mock("../license-engine/license-engine.js", async () => {
  const jose = await import("jose");
  return {
    getMarketplacePublicKey: async (opts?: { allowOverride?: boolean }) => {
      askedWith.push(opts);
      return jose.importSPKI(await exportSPKI(xentium.publicKey), "RS256");
    },
  };
});

vi.mock("../../infrastructure/logging/logger.js", () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}));

const { verifyPackageSignature } = await import("./package-signature.js");

const MANIFEST = { id: "demo-plugin", version: "1.0.0" };

/** A minimal package. `extra` lets a test change the code under a signature. */
function buildZip(extra?: { code?: string; signature?: string }): AdmZip {
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(MANIFEST), "utf8"));
  zip.addFile("server/dist/index.js", Buffer.from(extra?.code ?? "export function onEnable() {}\n", "utf8"));
  if (extra?.signature) zip.addFile(SIGNATURE_ENTRY, Buffer.from(extra.signature, "utf8"));
  return zip;
}

function digestOf(zip: AdmZip): string {
  return computeContentDigest(
    zip.getEntries().filter((e) => !e.isDirectory).map((e) => ({ path: e.entryName, data: e.getData() })),
  );
}

async function sign(claims: Record<string, unknown>, key: CryptoKey): Promise<string> {
  return new SignJWT(claims).setProtectedHeader({ alg: "RS256" }).setIssuedAt().sign(key);
}

/** A genuine signature for the standard package. */
async function genuine(overrides: Record<string, unknown> = {}, key = xentium.privateKey) {
  const zip = buildZip();
  return sign({
    pluginId: MANIFEST.id,
    version: MANIFEST.version,
    digest: digestOf(zip),
    tier: "reviewed",
    reviewedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  }, key);
}

describe("verifyPackageSignature", () => {
  beforeAll(() => { askedWith.length = 0; });

  it("accepts a package we signed, and reports the tier", async () => {
    const p = await verifyPackageSignature(buildZip({ signature: await genuine() }), MANIFEST);
    expect(p.tier).toBe("reviewed");
    expect(p.reviewedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(p.digest).toHaveLength(64);
  });

  it("never lets an env var decide what counts as a Xentium review", async () => {
    // LICENSE_PUBLIC_KEY may move what an entitlement is checked against. It must
    // not move this, or an admin could be talked into trusting a stranger's
    // signer and every badge would mean whatever that stranger wanted.
    expect(askedWith.length).toBeGreaterThan(0);
    expect(askedWith.every((o) => o?.allowOverride === false)).toBe(true);
  });

  it("accepts an unsigned package — a developer's own build is normal", async () => {
    const p = await verifyPackageSignature(buildZip(), MANIFEST);
    expect(p.tier).toBeNull();
    expect(p.reviewedAt).toBeNull();
    expect(p.digest).toHaveLength(64);
  });

  it("refuses a signature made with someone else's key", async () => {
    const forged = await genuine({}, impostor.privateKey);
    await expect(verifyPackageSignature(buildZip({ signature: forged }), MANIFEST))
      .rejects.toThrow(/does not verify|did not come from us/i);
  });

  it("refuses our signature over code that was changed underneath it", async () => {
    const token = await genuine();
    const tampered = buildZip({ code: "export function onEnable() { steal(); }\n", signature: token });
    await expect(verifyPackageSignature(tampered, MANIFEST))
      .rejects.toThrow(/do not match its signature|altered/i);
  });

  it("refuses our signature lifted onto a different plugin", async () => {
    const token = await genuine({ pluginId: "some-other-plugin" });
    await expect(verifyPackageSignature(buildZip({ signature: token }), MANIFEST))
      .rejects.toThrow(/issued for "some-other-plugin"/);
  });

  it("refuses our signature lifted onto a different version", async () => {
    const token = await genuine({ version: "0.9.0" });
    await expect(verifyPackageSignature(buildZip({ signature: token }), MANIFEST))
      .rejects.toThrow(/issued for version 0\.9\.0/);
  });

  it("refuses a signature file that is not a token at all", async () => {
    await expect(verifyPackageSignature(buildZip({ signature: "not-a-jwt" }), MANIFEST))
      .rejects.toThrow(/does not verify|did not come from us/i);
  });

  it("refuses an empty signature file rather than reading it as unsigned", async () => {
    // Otherwise stripping a signature's contents would be a way to launder a
    // refusal into a quiet install.
    await expect(verifyPackageSignature(buildZip({ signature: "   " }), MANIFEST))
      .rejects.toThrow(/empty signature/i);
  });

  it("records an unfamiliar tier as the weakest one it knows, rather than refusing", async () => {
    // The grading vocabulary may grow on the marketplace before an old instance
    // learns the new word. That should not stop an install.
    const token = await genuine({ tier: "platinum-plus" });
    const p = await verifyPackageSignature(buildZip({ signature: token }), MANIFEST);
    expect(p.tier).toBe("unvetted");
  });

  it("gives the same digest whether or not the package carries its signature", async () => {
    // This is what lets a package contain its own signature at all.
    const unsigned = await verifyPackageSignature(buildZip(), MANIFEST);
    const signed = await verifyPackageSignature(buildZip({ signature: await genuine() }), MANIFEST);
    expect(signed.digest).toBe(unsigned.digest);
  });
});

import type AdmZip from "adm-zip";
import * as jose from "jose";
import {
  SIGNATURE_ENTRY, computeContentDigest,
  type PluginSignatureClaims,
} from "@xentium/plugin-engine";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { getMarketplacePublicKey } from "../license-engine/license-engine.js";
import { logger } from "../../infrastructure/logging/logger.js";

/**
 * Has the Xentium team looked at this package?
 *
 * Three outcomes, and the third is the one worth being careful about:
 *
 *   1. **Signed and verifies** — reviewed. We record which tier and when.
 *   2. **No signature at all** — unverified. This is the NORMAL state for a
 *      developer running their own build, and it is allowed. It is not an
 *      accusation, and the ACP says "unverified source", not "untrusted".
 *   3. **Signed and does NOT verify** — refused outright. A package CLAIMING
 *      review that cannot prove it is not a lesser plugin, it is a hostile one:
 *      either the bytes were altered after we signed them, or someone forged
 *      the claim. Treating that as merely unverified would hand an attacker the
 *      exact outcome they wanted, because an unsigned package installs fine.
 *
 * The signature travels INSIDE the package, which is what makes "trust travels
 * with the bytes, not with the channel" true: a reviewed plugin handed to a
 * customer directly, restored from a backup, or carried onto an air-gapped box
 * is still reviewed, and a package that came down the marketplace pipe is not
 * trusted merely for having come that way.
 */

/** What an installed plugin records about where it came from. */
export interface PackageProvenance {
  /** null when the package carries no signature. */
  tier: string | null;
  /** null when unsigned. */
  reviewedAt: string | null;
  /** Always computed — it is what a later re-verification compares against. */
  digest: string;
}

/** The tiers the marketplace grades with. Anything else is not a grading we know. */
const TIERS = new Set(["audited", "reviewed", "unvetted"]);

/** Every entry's bytes, for the digest. */
function entriesOf(zip: AdmZip) {
  return zip.getEntries()
    .filter((e) => !e.isDirectory)
    .map((e) => ({ path: e.entryName, data: e.getData() }));
}

function refuse(message: string): never {
  throw new XentiumError({
    code: XEC.PLUGIN_PACKAGE_INVALID,
    httpStatus: 422,
    message,
  });
}

/**
 * Read and check the package's signature, if it has one.
 *
 * Returns the provenance to record. Throws only for case 3 — a signature that
 * is present and wrong.
 *
 * ⚠ Verified against the BUNDLED marketplace key, never `LICENSE_PUBLIC_KEY`.
 * That env var may move what this instance accepts as a licence; it must not be
 * able to move what this instance accepts as a review, or an operator could be
 * talked into trusting a stranger's signer and every "reviewed by Xentium"
 * badge would mean whatever that stranger wanted.
 */
export async function verifyPackageSignature(
  zip: AdmZip,
  manifest: { id: string; version: string },
): Promise<PackageProvenance> {
  const entries = entriesOf(zip);
  const digest = computeContentDigest(entries);

  const entry = zip.getEntry(SIGNATURE_ENTRY);
  if (!entry) {
    // Case 2. A developer's own build, and the common case during plugin work.
    return { tier: null, reviewedAt: null, digest };
  }

  const token = entry.getData().toString("utf8").trim();
  if (!token) refuse("The package carries an empty signature file. Remove it, or install a properly signed build.");

  let claims: PluginSignatureClaims;
  try {
    const key = await getMarketplacePublicKey({ allowOverride: false });
    const { payload } = await jose.jwtVerify(token, key, { algorithms: ["RS256"] });
    claims = payload as unknown as PluginSignatureClaims;
  } catch (err) {
    logger.warn({ err, pluginId: manifest.id }, "Plugin signature failed to verify");
    refuse(
      `This package claims to be reviewed by Xentium, but the signature does not verify. `
      + `It has been altered since it was signed, or it did not come from us. Nothing was installed.`,
    );
  }

  // The signature is only worth anything if it is about THIS package. Each of
  // these is a lift: a valid signature moved onto a different plugin, a
  // different version of the same plugin, or altered contents.
  if (claims.digest !== digest) {
    refuse(
      `This package's contents do not match its signature. It has been altered since Xentium `
      + `reviewed it. Nothing was installed.`,
    );
  }
  if (claims.pluginId !== manifest.id) {
    refuse(
      `This package's signature was issued for "${claims.pluginId}", not "${manifest.id}". `
      + `Nothing was installed.`,
    );
  }
  if (claims.version !== manifest.version) {
    refuse(
      `This package's signature was issued for version ${claims.version}, not ${manifest.version}. `
      + `Nothing was installed.`,
    );
  }

  // A tier we do not recognise is recorded as the weakest one we do rather than
  // refused: the grading vocabulary may grow on the marketplace before an old
  // instance learns the new word, and that should not stop an install.
  const tier = TIERS.has(claims.tier) ? claims.tier : "unvetted";
  const reviewedAt = typeof claims.reviewedAt === "string" ? claims.reviewedAt : null;

  logger.info({ pluginId: manifest.id, tier }, "Plugin signature verified");
  return { tier, reviewedAt, digest };
}

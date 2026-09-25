import { createHash } from "node:crypto";

/**
 * Package provenance: what a signed `.xtplugin` says about itself.
 *
 * The rule the whole model rests on is **trust travels with the bytes, not with
 * the channel**. A package reviewed by the Xentium team carries its signature
 * inside itself, so it is still trusted when a developer hands the file to a
 * customer directly, when an admin restores it from a backup, or when it is
 * carried onto an air-gapped box. And a package that arrived down the
 * marketplace pipe is NOT trusted merely for having come that way — if the
 * bytes were altered in between, the signature says so.
 *
 * ⚠ This digest is a WIRE FORMAT. The marketplace computes it when it signs and
 * every instance computes it when it verifies, from separate codebases. Any
 * change here breaks every signature already in the field, so it is pinned by a
 * frozen test vector on both sides (`signature.test.ts` here, and its twin in
 * the marketplace repo). If you change the algorithm, both vectors must be
 * regenerated together and every published artifact re-signed.
 */

/** Where the detached signature lives inside the package. */
export const SIGNATURE_ENTRY = "xentium-signature.jwt";

/** What the marketplace signs, and what an instance reads back out. */
export interface PluginSignatureClaims {
  /** Must match the package's own manifest id. */
  pluginId: string;
  /** Must match the package's own manifest version. */
  version: string;
  /** `computeContentDigest` over every entry except SIGNATURE_ENTRY. */
  digest: string;
  /** How hard we looked: audited | reviewed | unvetted. */
  tier: string;
  /** When the review happened. A historical fact, so the signature never expires. */
  reviewedAt: string;
}

/** One file in the package, as both sides see it. */
export interface PackageEntry {
  path: string;
  data: Uint8Array;
}

/**
 * A digest of the package's CONTENTS, not of its container.
 *
 * Hashing the zip bytes would be simpler and is wrong for the job: adding the
 * signature to the archive changes those bytes, and removing it again does not
 * reproduce them — zip serialisation is not canonical, so compression level,
 * entry order and timestamps all move the hash without any content changing.
 * Hashing a sorted listing of per-entry digests is stable against all of that,
 * which is the same reason JAR signing works this way.
 *
 * Directories are skipped (they carry no content), and SIGNATURE_ENTRY is
 * skipped because it cannot cover itself.
 *
 * The NUL separator is deliberate: a path is allowed to contain almost
 * anything, and with a printable separator a file called `a b` next to one
 * called `a` could be arranged to produce the same listing as a different pair.
 * NUL cannot appear in a zip entry name.
 */
export function computeContentDigest(entries: PackageEntry[]): string {
  const lines = entries
    .filter((e) => e.path !== SIGNATURE_ENTRY && !e.path.endsWith("/"))
    .map((e) => `${e.path}\u0000${createHash("sha256").update(e.data).digest("hex")}`)
    // Default sort: UTF-16 code-unit order. Deterministic everywhere, unlike
    // anything locale-aware.
    .sort();

  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

import { createRequire } from "node:module";

/**
 * The canonical platform version — single source of truth is the api
 * package.json (kept in lockstep across all workspace packages by
 * `node scripts/set-version.mjs <version>`). Surfaced in /api/health and
 * ACP → About, and compared against plugin manifests' min/maxNodevoVersion.
 *
 * Versioning policy (SemVer): prerelease identifiers mark cuts, not commits —
 * `1.0.0-alpha.0` means "working toward alpha.1". Bump + tag only when a
 * build is actually handed to testers.
 */
const require = createRequire(import.meta.url);
export const NODEVO_VERSION: string =
  (require("../../package.json") as { version: string }).version;

/** "1.0.0-alpha.1" → [1, 0, 0] — prerelease/build metadata ignored. */
export function baseVersion(version: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

/** Numeric compare of base versions: negative if a < b, 0 if equal. */
export function compareBaseVersions(a: string, b: string): number {
  const [a1, a2, a3] = baseVersion(a);
  const [b1, b2, b3] = baseVersion(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}

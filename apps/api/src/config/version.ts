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

/**
 * The package.json sits at a different relative depth depending on how this
 * module is being executed: under tsx it runs from `src/config/`, but tsup
 * bundles it into `dist/`, one level shallower. Resolving both keeps a single
 * code path — hardcoding either one leaves the other with MODULE_NOT_FOUND at
 * startup (which is exactly what the built server used to do).
 */
function readVersion(): string {
  for (const candidate of ["../../package.json", "../package.json"]) {
    try {
      return (require(candidate) as { version: string }).version;
    } catch {
      // wrong layout — try the next candidate
    }
  }
  throw new Error("NODEVO_VERSION: could not locate the api package.json");
}

export const NODEVO_VERSION: string = readVersion();

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

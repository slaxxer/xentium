import { createRequire } from "node:module";

/**
 * The canonical platform version — single source of truth is the api
 * package.json (kept in lockstep across all workspace packages by
 * `node scripts/set-version.mjs <version>`). Surfaced in /api/health and
 * ACP → About, and compared against plugin manifests' min/maxXentiumVersion.
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
  throw new Error("XENTIUM_VERSION: could not locate the api package.json");
}

export const XENTIUM_VERSION: string = readVersion();

/**
 * Base-version comparison moved to `@xentium/plugin-engine` (ADR-0006) — it is
 * pure, and the plugin compatibility check is its only consumer. Re-exported
 * here so existing imports keep working.
 */
export { baseVersion, compareBaseVersions } from "@xentium/plugin-engine";

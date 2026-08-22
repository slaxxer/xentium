/** Moved to `@nodevo/auth` (ADR-0006). §34 migrated accounts verify with their
 *  original algorithm once, then rehash to argon2 on the way through — no forced
 *  reset. Re-exported from the original path so existing imports keep working. */
export { isLegacyScheme, verifyLegacyPassword, type LegacyPasswordScheme } from "@nodevo/auth";

/**
 * Soft authentication: attach userId/sessionId when a valid Bearer token is
 * present, carry on silently when it is not. For endpoints whose behaviour
 * varies by viewer without requiring one (a public profile, a privacy-filtered
 * read).
 *
 * Built in `requireAuth.ts` from the same framework factory so both guards share
 * one verifier; re-exported here so the existing import path keeps working.
 */
export { optionalAuth } from "./requireAuth.js";

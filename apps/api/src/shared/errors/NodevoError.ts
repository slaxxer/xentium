/**
 * Moved to `@nodevo/errors` (ADR-0006 — a framework package may not know what a
 * user, an article, or a page is; this one knows none of them).
 *
 * Re-exported from the original path so the ~36 call sites keep working. New
 * code should import from `@nodevo/errors` directly; this shim goes away once
 * they have all been moved.
 */
export { NodevoError } from "@nodevo/errors";

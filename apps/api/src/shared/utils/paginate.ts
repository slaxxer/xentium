/** Moved to `@xentium/server-kit` (ADR-0006). `buildPaginationMeta` remains the
 *  only producer of pagination meta; this is the list-endpoint pattern that
 *  uses it. Re-exported from the original path so existing imports keep
 *  working. */
export { paginate } from "@xentium/server-kit";

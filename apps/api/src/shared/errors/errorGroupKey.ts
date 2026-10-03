import { createHash } from "node:crypto";

/**
 * The same failure, told apart only by the ids in it, is one problem: "User
 * cm1x…42 not found" and "User cm9z…07 not found" are one row in the ACP error
 * log, not two hundred. Masks uuids, cuid/hash-like tokens and numbers; keeps
 * quoted text, because `(reading 'latestVersion')` is what tells two
 * TypeErrors apart.
 */
export function normalizeErrorMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{16,}\b/gi, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/** One group per code + normalized message (see normalizeErrorMessage). */
export function errorGroupKey(code: string, message: string): string {
  return createHash("sha1").update(`${code}\n${normalizeErrorMessage(message)}`).digest("hex").slice(0, 24);
}

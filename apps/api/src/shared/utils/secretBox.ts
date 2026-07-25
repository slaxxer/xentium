import crypto from "node:crypto";
import { env } from "../../config/env.js";

// Symmetric encryption-at-rest for secrets we must store but never want sitting
// in the DB as plaintext (e.g. the marketplace account token in `ncf_settings`).
//
// AES-256-GCM (authenticated) with a key derived from COOKIE_SECRET via scrypt —
// no new required env, and it rides the operator's existing secret. The stored
// form is `enc:v1:<base64(iv|tag|ciphertext)>`; the version marker lets us:
//   • recognise our own ciphertext (vs a legacy plaintext value), so decrypt is
//     backward-compatible — old plaintext is returned as-is and gets encrypted
//     on its next write — and
//   • rotate the scheme later without ambiguity.
const VERSION = "enc:v1:";
const KEY = crypto.scryptSync(env.COOKIE_SECRET, "nodevo.secretbox.v1", 32);

/** Encrypt a UTF-8 string to the versioned, self-describing stored form. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return VERSION + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** True if `stored` is a value produced by encryptSecret (vs legacy plaintext). */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(VERSION);
}

/**
 * Decrypt a value produced by encryptSecret. A value WITHOUT the version marker
 * is treated as legacy plaintext and returned unchanged — so a pre-encryption
 * token keeps working until it is next written. Throws only if a marked value
 * fails authentication (tampering / wrong key).
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const raw = Buffer.from(stored.slice(VERSION.length), "base64");
  const iv  = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

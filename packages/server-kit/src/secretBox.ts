import crypto from "node:crypto";

// Symmetric encryption-at-rest for secrets an application must store but should
// never leave sitting in a database as plaintext (e.g. a marketplace account
// token).
//
// AES-256-GCM (authenticated) with a key derived from a caller-supplied secret
// via scrypt — no new required configuration, it rides whatever secret the
// operator already has. The stored form is `enc:v1:<base64(iv|tag|ciphertext)>`;
// the version marker lets us:
//   • recognise our own ciphertext (vs a legacy plaintext value), so decrypt is
//     backward-compatible — old plaintext is returned as-is and gets encrypted
//     on its next write — and
//   • rotate the scheme later without ambiguity.
const VERSION = "enc:v1:";

/**
 * scrypt salt. Frozen: changing it changes every derived key, which makes every
 * value ever encrypted undecryptable. It is a domain separator, not a secret.
 */
const SCRYPT_SALT = "nodevo.secretbox.v1";

export interface SecretBox {
  /** Encrypt a UTF-8 string to the versioned, self-describing stored form. */
  encryptSecret(plain: string): string;
  /** True if `stored` was produced by `encryptSecret` (vs legacy plaintext). */
  isEncrypted(stored: string): boolean;
  /**
   * Decrypt a value produced by `encryptSecret`. A value WITHOUT the version
   * marker is treated as legacy plaintext and returned unchanged, so a
   * pre-encryption value keeps working until it is next written. Throws only if
   * a marked value fails authentication (tampering, or the wrong secret).
   */
  decryptSecret(stored: string): string;
}

/**
 * Derives the encryption key once, at construction. `secret` is any
 * high-entropy application secret — Nodevo's own applications pass
 * `COOKIE_SECRET`.
 */
export function createSecretBox(secret: string): SecretBox {
  const key = crypto.scryptSync(secret, SCRYPT_SALT, 32);

  const isEncrypted = (stored: string): boolean => stored.startsWith(VERSION);

  return {
    isEncrypted,

    encryptSecret(plain: string): string {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return VERSION + Buffer.concat([iv, tag, ciphertext]).toString("base64");
    },

    decryptSecret(stored: string): string {
      if (!isEncrypted(stored)) return stored;
      const raw = Buffer.from(stored.slice(VERSION.length), "base64");
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const ciphertext = raw.subarray(28);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    },
  };
}

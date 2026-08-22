import crypto from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * Legacy password verification for migrated accounts (§34 migration tooling).
 *
 * Migration adapters import users with their original hash and set
 * users.password_scheme accordingly; the login flow verifies with the legacy
 * algorithm once, then transparently rehashes to argon2 — migrated users keep
 * their password, no forced reset.
 *
 * v1 schemes:
 *   "bcrypt" — XenForo, phpBB 3.1+, WoltLab ($2a$/$2b$/$2y$)
 *   "phpass" — WordPress (< 6.8), phpBB 3.0 portable hashes ($P$/$H$)
 *
 * Not covered yet: WordPress 6.8+ "$wp$" prehashed bcrypt — adapters should
 * map those to a reset flow until a "wp-bcrypt" scheme lands.
 */
export type LegacyPasswordScheme = "bcrypt" | "phpass";

export function isLegacyScheme(scheme: string): scheme is LegacyPasswordScheme {
  return scheme === "bcrypt" || scheme === "phpass";
}

export async function verifyLegacyPassword(
  scheme: string,
  hash: string,
  password: string,
): Promise<boolean> {
  switch (scheme) {
    case "bcrypt":
      // bcryptjs only knows $2a$/$2b$ — PHP emits $2y$, identical algorithm.
      return bcrypt.compare(password, hash.replace(/^\$2y\$/, "$2a$"));
    case "phpass":
      return verifyPhpass(hash, password);
    default:
      return false;
  }
}

// ── phpass (Openwall portable hashes, as used by WordPress/phpBB) ───────────

const ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function phpassEncode64(input: Buffer, count: number): string {
  let output = "";
  let i = 0;
  do {
    let value = input[i++]!;
    output += ITOA64[value & 0x3f];
    if (i < count) value |= input[i]! << 8;
    output += ITOA64[(value >> 6) & 0x3f];
    if (i++ >= count) break;
    if (i < count) value |= input[i]! << 16;
    output += ITOA64[(value >> 12) & 0x3f];
    if (i++ >= count) break;
    output += ITOA64[(value >> 18) & 0x3f];
  } while (i < count);
  return output;
}

function md5(data: Buffer | string): Buffer {
  return crypto.createHash("md5").update(data).digest();
}

/** Verify a $P$/$H$ portable hash. Constant-time comparison on the result. */
function verifyPhpass(storedHash: string, password: string): boolean {
  const prefix = storedHash.slice(0, 3);
  if ((prefix !== "$P$" && prefix !== "$H$") || storedHash.length < 34) return false;

  const countLog2 = ITOA64.indexOf(storedHash[3]!);
  if (countLog2 < 7 || countLog2 > 30) return false;
  const salt = storedHash.slice(4, 12);
  if (salt.length !== 8) return false;

  let digest = md5(Buffer.concat([Buffer.from(salt), Buffer.from(password)]));
  let rounds = 1 << countLog2;
  const pw = Buffer.from(password);
  while (rounds--) {
    digest = md5(Buffer.concat([digest, pw]));
  }

  const computed = storedHash.slice(0, 12) + phpassEncode64(digest, 16);
  const a = Buffer.from(computed);
  const b = Buffer.from(storedHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

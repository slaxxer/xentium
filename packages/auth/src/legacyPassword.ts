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
 *   "bcrypt"        — XenForo, phpBB 3.1+, WoltLab ($2a$/$2b$/$2y$)
 *   "phpass"        — WordPress (< 6.8), phpBB 3.0 portable hashes ($P$/$H$)
 *   "vb-md5salt"    — vBulletin 3/4 (and vB5 "legacy" accounts): md5(md5(pw) . salt),
 *                     stored by the adapter as "<32 hex>:<salt>"
 *   "vb-bcrypt-md5" — vBulletin 5/6 ("blowfish:N"): bcrypt over md5(pw) in hex
 *   "wcf-double-bcrypt" — WoltLab Suite before 5.4: crypt(crypt(pw, salt), salt), the
 *                     salt being the stored hash itself
 *   "wcf1"          — WoltLab Community Framework 1.x: sha1(salt . sha1(salt . sha1(pw))),
 *                     stored as "<40 hex>:<salt>"
 *
 * Not covered yet: WordPress 6.8+ "$wp$" prehashed bcrypt — adapters should
 * map those to a reset flow until a "wp-bcrypt" scheme lands.
 */
export type LegacyPasswordScheme = "bcrypt" | "phpass" | "vb-md5salt" | "vb-bcrypt-md5" | "wcf-double-bcrypt" | "wcf1";

const LEGACY_SCHEMES: readonly string[] = ["bcrypt", "phpass", "vb-md5salt", "vb-bcrypt-md5", "wcf-double-bcrypt", "wcf1"];

export function isLegacyScheme(scheme: string): scheme is LegacyPasswordScheme {
  return LEGACY_SCHEMES.includes(scheme);
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
    case "vb-md5salt":
      return vbCandidates(password).some((pw) => verifyVbMd5Salt(hash, pw));
    case "vb-bcrypt-md5": {
      const h = hash.replace(/^\$2y\$/, "$2a$");
      for (const pw of vbCandidates(password)) {
        if (await bcrypt.compare(md5hex(pw), h)) return true;
      }
      return false;
    }
    case "wcf-double-bcrypt": {
      // PHP's crypt() with the stored hash as the salt uses its first 29 characters.
      const salt = hash.slice(0, 29).replace(/^\$2y\$/, "$2a$");
      if (!/^\$2[ab]\$\d\d\$[./A-Za-z0-9]{22}$/.test(salt)) return false;
      const inner = await bcrypt.hash(password, salt);
      const outer = await bcrypt.hash(inner, salt);
      return timingEqual(outer, hash.replace(/^\$2y\$/, "$2a$"));
    }
    case "wcf1": {
      const i = hash.indexOf(":");
      if (i !== 40) return false;
      const salt = hash.slice(41);
      const sha1 = (s: string) => crypto.createHash("sha1").update(s, "utf8").digest("hex");
      return timingEqual(sha1(salt + sha1(salt + sha1(password))), hash.slice(0, 40).toLowerCase());
    }
    default:
      return false;
  }
}

function timingEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ── vBulletin ────────────────────────────────────────────────────────────────

const md5hex = (s: string) => crypto.createHash("md5").update(s, "utf8").digest("hex");

/**
 * The strings vBulletin may have hashed for this password. vBulletin md5s the
 * password in the browser before it is sent, and its JavaScript turns every
 * character above U+00FF into an HTML entity first ("&#1234;"). Accounts created
 * that way only match the entity form, so we try both.
 */
function vbCandidates(password: string): string[] {
  const entities = [...password].map((c) => (c.codePointAt(0)! > 0xff ? `&#${c.codePointAt(0)};` : c)).join("");
  return entities === password ? [password] : [password, entities];
}

/** "<32 hex>:<salt>": md5(md5(password) . salt). The salt may itself contain ":". */
function verifyVbMd5Salt(stored: string, password: string): boolean {
  if (stored.length < 34 || stored[32] !== ":") return false;
  const expected = stored.slice(0, 32).toLowerCase();
  const salt = stored.slice(33);
  const computed = md5hex(md5hex(password) + salt);
  const a = Buffer.from(computed);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

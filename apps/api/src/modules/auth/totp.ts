import crypto from "node:crypto";

/**
 * TOTP (RFC 6238) — what Google Authenticator, 1Password, Authy and every app
 * like them speak: HMAC-SHA1, 6 digits, a 30-second step. Those defaults are
 * not ours to tune; several apps silently ignore `algorithm`/`digits`/`period`
 * in the QR code and compute SHA1/6/30 regardless, so anything else would
 * produce codes that never match.
 *
 * Written against node:crypto rather than pulled in: it is thirty lines, and
 * the code that decides who gets past sign-in is the last place to
 * add a dependency.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
/** One step either side: a phone clock a little off, or a code typed as it rolled over. */
const DRIFT_STEPS = 1;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Not base32.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 bits, the size RFC 4226 recommends for an HMAC-SHA1 key. */
export const generateSecret = () => base32Encode(crypto.randomBytes(20));

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(bin).padStart(DIGITS, "0");
}

/**
 * The step a code is valid for, or null.
 *
 * `lastStep` is the step of the last code this account spent: anything at or
 * before it is refused, so a code works once even inside its own window.
 */
export function verifyCode(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const here = currentStep(now);
  for (let d = -DRIFT_STEPS; d <= DRIFT_STEPS; d++) {
    const step = here + d;
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(codeAt(secret, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(digits))) return step;
  }
  return null;
}

/** The `otpauth://` URI the QR code carries. */
export function otpauthUri(secret: string, accountLabel: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const q = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

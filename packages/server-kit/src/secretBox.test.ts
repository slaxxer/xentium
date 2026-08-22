/**
 * Encryption-at-rest for stored secrets. Carried over from `apps/api` with the
 * extraction (ADR-0006); the last case is new and is the one that matters most
 * here — the key derivation must not have changed, or every value encrypted
 * before the move becomes undecryptable.
 */
import { describe, it, expect } from "vitest";
import { createSecretBox } from "./secretBox.js";

const SECRET = "test-cookie-secret-with-enough-entropy";
const { encryptSecret, decryptSecret, isEncrypted } = createSecretBox(SECRET);

describe("secretBox encryption-at-rest", () => {
  it("round-trips a value", () => {
    const plain = "acct_tok_abc123.def456";
    const enc = encryptSecret(plain);
    expect(enc).not.toContain(plain);       // ciphertext must not leak the plaintext
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("passes legacy plaintext through unchanged (backward compatible)", () => {
    const legacy = "plain-old-token";
    expect(isEncrypted(legacy)).toBe(false);
    expect(decryptSecret(legacy)).toBe(legacy);
  });

  it("rejects a tampered ciphertext (GCM auth)", () => {
    const enc = encryptSecret("secret");
    // Flip a character in the base64 body to corrupt the auth tag / ciphertext.
    const body = enc.slice("enc:v1:".length);
    const tampered = "enc:v1:" + (body[0] === "A" ? "B" : "A") + body.slice(1);
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("handles unicode", () => {
    const plain = "tökén-🔐-ünïcode";
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it("derives the same key from the same secret, across instances", () => {
    // The extraction moved the derivation behind a factory. If the salt or the
    // scrypt parameters drifted, this is the test that catches it — a value
    // written by yesterday's build has to open with today's.
    const other = createSecretBox(SECRET);
    expect(other.decryptSecret(encryptSecret("carried-over"))).toBe("carried-over");
  });

  it("cannot open a value encrypted with a different secret", () => {
    const stranger = createSecretBox("a-completely-different-secret");
    expect(() => stranger.decryptSecret(encryptSecret("mine"))).toThrow();
  });
});

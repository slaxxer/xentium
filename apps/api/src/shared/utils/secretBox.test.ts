import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted } from "./secretBox.js";

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
});

import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { verifyLegacyPassword, isLegacyScheme } from "./legacyPassword.js";

describe("legacy password verification (migrated accounts)", () => {
  describe("phpass (WordPress / phpBB portable)", () => {
    // Canonical test vector from Openwall's phpass reference test suite.
    const VECTOR_HASH = "$P$9IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0";
    const VECTOR_PASSWORD = "test12345";

    it("verifies the reference vector", async () => {
      expect(await verifyLegacyPassword("phpass", VECTOR_HASH, VECTOR_PASSWORD)).toBe(true);
    });

    it("rejects a wrong password", async () => {
      expect(await verifyLegacyPassword("phpass", VECTOR_HASH, "test12346")).toBe(false);
      expect(await verifyLegacyPassword("phpass", VECTOR_HASH, "")).toBe(false);
    });

    it("rejects malformed hashes", async () => {
      expect(await verifyLegacyPassword("phpass", "$X$9IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0", VECTOR_PASSWORD)).toBe(false);
      expect(await verifyLegacyPassword("phpass", "$P$9short", VECTOR_PASSWORD)).toBe(false);
      // count character below the allowed minimum (log2 < 7)
      expect(await verifyLegacyPassword("phpass", "$P$1IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0", VECTOR_PASSWORD)).toBe(false);
    });
  });

  describe("bcrypt (XenForo / phpBB 3.1+ / WoltLab)", () => {
    it("verifies a bcrypt hash", async () => {
      const hash = await bcrypt.hash("hunter2!", 10);
      expect(await verifyLegacyPassword("bcrypt", hash, "hunter2!")).toBe(true);
      expect(await verifyLegacyPassword("bcrypt", hash, "hunter3!")).toBe(false);
    });

    it("accepts PHP's $2y$ prefix", async () => {
      const hash = (await bcrypt.hash("hunter2!", 10)).replace(/^\$2[ab]\$/, "$2y$");
      expect(await verifyLegacyPassword("bcrypt", hash, "hunter2!")).toBe(true);
    });
  });

  it("unknown schemes never verify", async () => {
    expect(await verifyLegacyPassword("md5", "5f4dcc3b5aa765d61d8327deb882cf99", "password")).toBe(false);
    expect(isLegacyScheme("argon2")).toBe(false);
    expect(isLegacyScheme("bcrypt")).toBe(true);
    expect(isLegacyScheme("phpass")).toBe(true);
  });

  describe("vBulletin", () => {
    const md5 = (x: string) => crypto.createHash("md5").update(x, "utf8").digest("hex");

    it("verifies vB3/4 md5(md5(pw) . salt), including salts with a colon", async () => {
      for (const salt of ["a1~", "x:y", "0123456789abcdefghijklmnopqrst"]) {
        const stored = `${md5(md5("hunter2!") + salt)}:${salt}`;
        expect(await verifyLegacyPassword("vb-md5salt", stored, "hunter2!")).toBe(true);
        expect(await verifyLegacyPassword("vb-md5salt", stored, "hunter3!")).toBe(false);
      }
      expect(await verifyLegacyPassword("vb-md5salt", "nothex", "hunter2!")).toBe(false);
    });

    it("verifies vB5/6 bcrypt over md5(pw), with PHP's $2y$", async () => {
      const hash = (await bcrypt.hash(md5("hunter2!"), 10)).replace(/^\$2[ab]\$/, "$2y$");
      expect(await verifyLegacyPassword("vb-bcrypt-md5", hash, "hunter2!")).toBe(true);
      expect(await verifyLegacyPassword("vb-bcrypt-md5", hash, "hunter3!")).toBe(false);
    });

    it("matches passwords vBulletin hashed in entity form (characters above U+00FF)", async () => {
      const salt = "q;Z";
      const stored = `${md5(md5("пароль&#8364;") + salt)}:${salt}`;
      expect(await verifyLegacyPassword("vb-md5salt", `${md5(md5("&#1087;&#1072;&#1088;&#1086;&#1083;&#1100;&#8364;") + salt)}:${salt}`, "пароль€")).toBe(true);
      expect(await verifyLegacyPassword("vb-md5salt", stored, "nope")).toBe(false);
    });

    it("knows the new schemes", () => {
      expect(isLegacyScheme("vb-md5salt")).toBe(true);
      expect(isLegacyScheme("vb-bcrypt-md5")).toBe(true);
      expect(isLegacyScheme("md5")).toBe(false);
    });
  });

  describe("WoltLab", () => {
    it("verifies pre-5.4 double bcrypt (crypt over crypt, same salt)", async () => {
      const salt = "$2a$08$abcdefghijklmnopqrstuv";
      const stored = await bcrypt.hash(await bcrypt.hash("hunter2!", salt), salt);
      expect(await verifyLegacyPassword("wcf-double-bcrypt", stored, "hunter2!")).toBe(true);
      expect(await verifyLegacyPassword("wcf-double-bcrypt", stored, "hunter3!")).toBe(false);
      expect(await verifyLegacyPassword("wcf-double-bcrypt", "nonsense", "hunter2!")).toBe(false);
    });

    it("verifies WCF 1.x triple sha1 with salt", async () => {
      const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");
      const salt = "0123456789abcdef0123456789abcdef01234567";
      const stored = `${sha1(salt + sha1(salt + sha1("hunter2!")))}:${salt}`;
      expect(await verifyLegacyPassword("wcf1", stored, "hunter2!")).toBe(true);
      expect(await verifyLegacyPassword("wcf1", stored, "nope")).toBe(false);
      expect(await verifyLegacyPassword("wcf1", "short:salt", "hunter2!")).toBe(false);
    });
  });
});

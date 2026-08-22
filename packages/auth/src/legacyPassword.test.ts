import { describe, it, expect } from "vitest";
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
});

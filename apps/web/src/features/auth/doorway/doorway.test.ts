import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { passwordStrength } from "./RegisterPanel";
import { apiErr, errorText } from "./authErrors";

const t = ((key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key)) as unknown as TFunction;

describe("password strength", () => {
  it("never calls a short password more than weak", () => {
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("Ab1!")).toBeLessThanOrEqual(1);
  });

  it("rewards variety and length", () => {
    expect(passwordStrength("abcdefgh")).toBe(1);
    expect(passwordStrength("Abcdefgh1")).toBe(3);
    expect(passwordStrength("Abcdefgh1!")).toBe(4);
    expect(passwordStrength("correcthorsebatterystaple")).toBe(3);
  });
});

describe("error wording", () => {
  it("names what went wrong for codes the doorway knows", () => {
    expect(errorText(t, { code: "XEC-AUTH-1011" })).toBe("door.err.linkInvalid");
    expect(errorText(t, { code: "XEC-AUTH-1061" })).toBe("door.err.providerEmailTaken");
  });

  it("shows a guard's own message as it is", () => {
    expect(errorText(t, { code: "XEC-AUTH-1040", message: "Too many attempts. Try again in 10 minutes." }))
      .toBe("Too many attempts. Try again in 10 minutes.");
  });

  it("says how long a ban lasts", () => {
    expect(errorText(t, { code: "XEC-AUTH-1004", details: { reason: "Spam" } })).toContain("door.err.bannedForever");
    expect(errorText(t, { code: "XEC-AUTH-1003", details: { reason: "Spam", expiresAt: "2030-01-01T00:00:00Z" } })).toContain("door.err.bannedUntil");
  });

  it("falls back to a generic line, never to a raw code", () => {
    expect(errorText(t, { code: "XEC-SOMETHING-9999" })).toBe("door.err.generic");
    expect(apiErr({ detail: { error: { code: "X" } } })).toEqual({ code: "X" });
  });
});

describe("PIN step wording", () => {
  it("reads invalid credentials as a wrong PIN", async () => {
    const { pinErrorText } = await import("./authErrors");
    expect(pinErrorText(t, { code: "XEC-AUTH-1001" })).toBe("door.err.pinWrong");
    expect(pinErrorText(t, { code: "XEC-AUTH-1040", message: "Locked for 10 minutes." })).toBe("Locked for 10 minutes.");
  });
});

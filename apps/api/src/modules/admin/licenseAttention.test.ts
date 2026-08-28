/**
 * The rule behind the ACP's red badge and its entry dialog.
 *
 * Every test here is a regression guard for one shipped bug: the badge read
 * `daysLeft <= 30` against an entitlement that is issued with a 30-day life and
 * refreshed every 7, so it was true the moment an account connected and true
 * forever after. Every connected install in the field carried a permanent red
 * "licence expiring" badge — the state in which a warning has stopped being a
 * warning.
 *
 * It was found by looking at a freshly connected install that owned nothing and
 * asking why it claimed to be licensed. Nothing failed; there was nothing to
 * fail.
 */
import { describe, expect, it } from "vitest";
import { countGrants, licenseAttention, ENTITLEMENT_STALE_DAYS } from "./licenseAttention.js";

const NOW = new Date("2026-08-28T12:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

/** A JWT-shaped string carrying just the payload this module reads. */
const jwtWith = (entitlements: unknown) =>
  `header.${Buffer.from(JSON.stringify({ entitlements }), "utf8").toString("base64url")}.sig`;

describe("a healthy install is never warned", () => {
  it("says nothing at the moment of activation", () => {
    // The bug, stated as a test: an entitlement issued seconds ago is 30 days
    // from expiry, and the old rule called that "expiring soon".
    const a = licenseAttention(inDays(30), 1, NOW);
    expect(a.expiringSoon).toBe(false);
    expect(a.expired).toBe(false);
  });

  it("says nothing anywhere in the normal refresh cycle", () => {
    // refreshAfter is 7 days, so a working install re-issues at ~23 days left
    // and never goes below it. Every day in that band must be silent.
    for (let daysLeft = 23; daysLeft <= 30; daysLeft++) {
      const a = licenseAttention(inDays(daysLeft), 1, NOW);
      expect(a.expiringSoon, `${daysLeft} days left`).toBe(false);
    }
  });

  it("keeps the threshold below the cycle's floor", () => {
    // If this ever creeps up to 23 or beyond, the permanent badge is back. The
    // constant is only safe because it sits under where refresh keeps things.
    expect(ENTITLEMENT_STALE_DAYS).toBeLessThan(23);
  });
});

describe("a stale entitlement is warned about", () => {
  it("warns once refreshing has been failing for weeks", () => {
    const a = licenseAttention(inDays(5), 1, NOW);
    expect(a.expiringSoon).toBe(true);
    expect(a.expired).toBe(false);
    expect(a.daysLeft).toBe(5);
  });

  it("reports expiry once it is past", () => {
    const a = licenseAttention(inDays(-2), 1, NOW);
    expect(a.expired).toBe(true);
    expect(a.expiringSoon).toBe(false);
  });

  it("anchors acknowledgement at the moment the window opened", () => {
    // Not at activation: the anchor has to move forward on each refresh, or an
    // admin who dismissed one cycle's warning never sees the next.
    const a = licenseAttention(inDays(5), 1, NOW);
    expect(a.anchor).toEqual(new Date(inDays(5).getTime() - ENTITLEMENT_STALE_DAYS * 86_400_000));
  });
});

describe("an entitlement that grants nothing", () => {
  it("is not warned about, however close its expiry", () => {
    // Connecting is not buying. An account that linked but has not bought
    // anything holds a signed document with an empty list — there is no licence
    // in it, so there is nothing that can lapse.
    expect(licenseAttention(inDays(1), 0, NOW)).toMatchObject({ expiringSoon: false, expired: false });
    expect(licenseAttention(inDays(-9), 0, NOW)).toMatchObject({ expiringSoon: false, expired: false });
  });

  it("contributes no anchor, so nothing can be nagged about", () => {
    expect(licenseAttention(inDays(1), 0, NOW).anchor).toBeNull();
  });

  it("is silent when no entitlement is held at all", () => {
    expect(licenseAttention(null, 3, NOW)).toMatchObject({ expiringSoon: false, daysLeft: null });
  });
});

describe("countGrants", () => {
  it("counts the grants in a payload", () => {
    expect(countGrants(jwtWith([{ id: "plugin.a" }, { id: "theme.b" }]))).toBe(2);
  });

  it("returns 0 for the empty list an unbought account gets", () => {
    expect(countGrants(jwtWith([]))).toBe(0);
  });

  it("returns 0 rather than inventing an alarm from something unreadable", () => {
    // This decides whether to WARN. A token we cannot read must not produce
    // one; refusing ACCESS on a bad token is getEntitlementStatus's job, and it
    // verifies properly.
    expect(countGrants("not-a-jwt")).toBe(0);
    expect(countGrants("a.!!!not-base64!!!.c")).toBe(0);
    expect(countGrants(null)).toBe(0);
    expect(countGrants(jwtWith("seven"))).toBe(0);
  });
});

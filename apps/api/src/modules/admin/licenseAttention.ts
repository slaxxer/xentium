// When does the stored entitlement deserve an admin's attention?
//
// This is its own module because getting it wrong is invisible in the way that
// matters: the ACP badge and the ACP-entry dialog both read it, and a rule that
// is always true produces a permanent red badge that everybody learns to ignore
// — which costs you the one time it means something.
//
// ── What `expiresAt` actually is ────────────────────────────────────────────
//
// NOT a subscription end date. The entitlement JWT is a signed statement of
// what this install owns, issued with a 30-day life and a `refreshAfter` of
// 7 days. A healthy install re-fetches it weekly, so `expiresAt` sits between
// ~23 and 30 days out AT ALL TIMES and never approaches.
//
// The rule used to be `daysLeft <= 30`, which is therefore true the moment an
// account is connected and true forever after. Every connected install in the
// field showed a permanent red "licence expiring" badge, paying customers
// included. The threshold has to sit BELOW the refresh cadence's floor, so that
// tripping it means refreshing has actually been failing for weeks.
//
// ── And what a zero-grant entitlement is ────────────────────────────────────
//
// `/account/activate` issues a signed document even when the account owns
// nothing — connecting is not buying. Such a document has no licence in it, so
// there is nothing that can expire and nothing to warn about. Treating "I hold
// a signed document" as "I hold a licence" is what made a brand-new account
// read as `Licensed until <date>` five seconds after registering.

/** The entitlement lives 30 days and is refreshed every 7, so a healthy one is
 *  never nearer than ~23 days out. Seven days left means roughly three weeks of
 *  failed refreshes — a real problem, and the only one worth a badge. */
export const ENTITLEMENT_STALE_DAYS = 7;

export interface LicenseAttention {
  expiringSoon: boolean;
  expired:      boolean;
  daysLeft:     number | null;
  /** The moment this entered the warning window. Anchors the per-admin
   *  "have they looked at it since" acknowledgement, and moves forward on each
   *  successful refresh, so a genuine problem re-nags on the next cycle. */
  anchor:       Date | null;
}

const NONE: LicenseAttention = { expiringSoon: false, expired: false, daysLeft: null, anchor: null };

/**
 * @param expiresAt   the stored entitlement's expiry, or null when none is held
 * @param grantCount  how many products the entitlement actually grants
 */
export function licenseAttention(
  expiresAt: Date | null | undefined,
  grantCount: number,
  now: Date = new Date(),
): LicenseAttention {
  // No document, or a document that grants nothing: nothing to expire. An
  // account that has connected but not bought anything is in a perfectly good
  // state and must not be nagged as though something lapsed.
  if (!expiresAt || grantCount <= 0) return NONE;

  const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
  const anchor = new Date(expiresAt.getTime() - ENTITLEMENT_STALE_DAYS * 86_400_000);

  if (daysLeft <= 0) return { expiringSoon: false, expired: true, daysLeft, anchor };
  if (daysLeft <= ENTITLEMENT_STALE_DAYS) return { expiringSoon: true, expired: false, daysLeft, anchor };
  return { ...NONE, daysLeft };
}

/**
 * How many products an entitlement grants, read from the JWT payload.
 *
 * Decodes rather than verifies on purpose: this decides whether to show a
 * WARNING, and a document that fails verification is handled by
 * `getEntitlementStatus` (grace, then expiry) where refusing access is the
 * point. Here an unreadable payload means "do not warn", because inventing an
 * alarm from a token we cannot read is the worse failure.
 */
export function countGrants(jwt: string | null | undefined): number {
  if (!jwt) return 0;
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return 0;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      entitlements?: unknown[];
    };
    return Array.isArray(claims.entitlements) ? claims.entitlements.length : 0;
  } catch {
    return 0;
  }
}

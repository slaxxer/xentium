// Entitlement contracts (ADR 0001). The light runtime side of licensing.
//
// `EntitlementProvider` verifies the locally-stored, domain-bound entitlement JWT
// with the bundled public key. It is called on plugin enable and by the daily
// refresh job — NOT per request. Running plugins are never bricked by expiry
// (§11): an expired-but-in-grace entitlement still resolves to a usable state.

/** Where a Nodevo instance is running. Drives whether domain-binding is enforced. */
export type DeployEnvironment = "production" | "staging" | "development";

/**
 * One thing an install is entitled to run, as signed into the entitlement JWT.
 *
 * A GRANT IS AN OBJECT, not a bare id string, and that is load-bearing:
 * `updatesUntil` is what makes a lapsed-updates licence distinguishable from a
 * dead one — the install keeps running what it has but may not fetch a newer
 * version. A single global expiry cannot express that per product.
 *
 * The signing half lives in the marketplace and the verifying half is compiled
 * into every install, so this shape is a PUBLISHED CONTRACT. Both ends have to
 * move together.
 */
export interface EntitlementGrant {
  /** Namespaced: `plugin.<id>` or `theme.<id>`. */
  id:            string;
  /** Unix seconds. Absent = perpetual. */
  updatesUntil?: number;
  /** Version ceiling this licence may upgrade to, e.g. "3.x". Absent = none. */
  maxVersion?:   string;
}

/** Resolved state of a single plugin's entitlement on this site. */
export type EntitlementState =
  | "valid"            // verified, in date, domain matches (or non-prod)
  | "grace"            // expired but within the 30-day grace window
  | "expired"          // past expiry and past grace
  | "domain_mismatch"  // signed domain != this site's domain (production only)
  | "missing";         // no active license / plugin not in entitlements[]

export interface EntitlementStatus {
  pluginId:    string;
  state:       EntitlementState;
  domain:      string | null;
  environment: DeployEnvironment;
  expiresAt:   string | null;   // ISO
  graceEndsAt: string | null;   // ISO — expiresAt + 30d
}

export interface EntitlementProvider {
  /**
   * Light gate. Verifies the stored JWT (bundled public key), checks domain +
   * expiry + grace. Never throws for "expired in grace" — returns `grace` so the
   * caller keeps the plugin running. Returns `missing` when no entitlement covers
   * the plugin.
   */
  check(pluginId: string): Promise<EntitlementStatus>;

  /** Daily BullMQ job: refresh tokens nearing `refreshAfter` via the MarketplaceSource. */
  refresh(pluginId?: string): Promise<EntitlementStatus | null>;
}

// Marketplace contracts (ADR 0001). The download gate — where paid plugins are
// actually protected. Core talks to a `MarketplaceSource`, never hardcoding
// nodevo.io: a community / self-hosted source implements the same interface and
// may return free, no-op entitlements.

import type { PaginatedRequest, PaginatedResponse } from "./pagination.js";
import type { DeployEnvironment } from "./entitlement.js";

/** A listing in the catalogue mirror shown in ACP → Extensions → Marketplace. */
export interface MarketplaceListing {
  id:              string;
  kind:            ProductKind;
  name:            string;
  description:     string;
  vendor:          string;
  /** Null when nothing has been published yet — a listing can exist before its first release. */
  latestVersion:   string | null;
  priceCents:      number;   // 0 = free
  currency:        string;
  licenseRequired: boolean;
  category?:       string | null;
  /** Present only when the catalogue was fetched with a connected account: does
   *  this account hold a licence for it. The ONE place the marketplace answers
   *  "do I own this" for a listing the instance may not have installed. */
  owned?:          boolean;
}

/** The marketplace sells two kinds of thing. Themes are data, plugins are code. */
export type ProductKind = "plugin" | "theme";

/** State of the server-side connection to a marketplace account (never exposes the token). */
export interface MarketplaceConnection {
  sourceId:    string;
  connected:   boolean;
  accountRef:  string | null;  // display label e.g. masked email / account id
  connectedAt: string | null;  // ISO
}

export interface DownloadRequest {
  pluginId:    string;
  version:     string;
  siteId:      string;          // install-time site.id — what a licence binds to
  domain:      string;          // reported metadata only; binds nothing
  environment: DeployEnvironment;
  kind?:       ProductKind;     // defaults to "plugin"
}

/**
 * Result of the authenticated download gate. The marketplace has already verified
 * account + domain ownership and (for production) the activation cap before
 * returning this. `entitlementJwt` is RS256, bound to `domain` + `siteId`.
 * `downloadUrl` is the authenticated artifact location (null when the artifact is
 * supplied out-of-band, e.g. a manual upload in dev).
 */
export interface AuthorizedDownload {
  pluginId:       string;
  version:        string;
  entitlementJwt: string;
  expiresAt:      string;        // ISO
  downloadUrl:    string | null;
  sha256?:        string | null; // artifact integrity — instances verify the fetched bytes before install
}

export interface MarketplaceSource {
  readonly id:    string;        // "nodevo.io" | a self-hosted/community source
  readonly label: string;

  /** Store the server-side account credential (auth code → token in settings). */
  connect(authCode: string): Promise<MarketplaceConnection>;

  /** Drop the stored credential. */
  disconnect(): Promise<void>;

  /** Current connection state (no secret material). */
  getConnection(): Promise<MarketplaceConnection>;

  /** Catalogue mirror — the ACP browse list. */
  listPlugins(opts: PaginatedRequest): Promise<PaginatedResponse<MarketplaceListing>>;

  /**
   * THE CHOKEPOINT. Asks the source "does this account own plugin P, and is there a
   * free production activation for domain D?" — and only then issues a fresh
   * domain-bound entitlement (and, in prod, an authenticated artifact URL).
   * Throws NEC-LICENSE-9004 if the cap is hit, 9005 if no account is connected.
   */
  authorizeDownload(req: DownloadRequest): Promise<AuthorizedDownload>;
}

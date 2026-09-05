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
  /**
   * Absolute URL of the listing's preview image, or null.
   *
   * A THEME's whole pitch is what it looks like, and a grid of themes rendered as
   * name-and-price cards asks an admin to buy a look they cannot see. The URL is
   * absolute and served by the marketplace: the image lives there, not on the
   * instance, so nothing is downloaded until the admin actually installs.
   */
  screenshot?:     string | null;
  /**
   * A THEME's dependency footprint, derived from the package at ingest: every
   * template it ships a layout for, and every block type those layouts place.
   *
   * A theme arranging `forum.index`, or placing a `forum.recentThreads`, needs
   * that plugin. The importer already handles the absence gracefully — it skips
   * what it cannot render and keeps the rest, so an admin's arrangement survives
   * a plugin being disabled — which is right at runtime and reads as "I bought
   * this and half of it did not appear" when the theme was just purchased. These
   * let the ACP say so BEFORE the money.
   *
   * ⚠ Types and template keys, NOT plugin ids: a plugin's id (`nodevo-forum`) and
   * its block namespace (`forum.`) are deliberately different strings, and the
   * package carries neither the id nor the mapping. Only an instance that HAS the
   * plugin can resolve one to the other — which is exactly the instance that does
   * not need the warning. So the ACP names the block types it cannot draw, rather
   * than guessing at a plugin to sell.
   *
   * Absent for plugins, and absent on a theme published before the footprint
   * existed — an empty array means "needs nothing beyond core", so the two must
   * not be conflated.
   */
  usesTemplates?:  string[];
  usesBlocks?:     string[];
  /**
   * A THEME rendered by the MARKETPLACE, from the version on sale.
   *
   * A theme has no runtime, so the authenticated download is the only chokepoint
   * there will ever be — which means "install it and see" cannot be undone and
   * "try it on your own site" cannot happen without giving the theme away. The
   * marketplace draws it instead and serves markup, so a buyer can look at the
   * arrangement and the palette before spending anything.
   *
   * `previewTemplates` is which pages have a rendering (NOT `usesTemplates`: a
   * layout that failed to parse ships no page and must not offer a dead tab), and
   * `previewUrlBase` is where they live — absolute, because the ACP renders this
   * catalogue on the instance's own origin. One page is
   * `${previewUrlBase}/${templateKey}?scheme=light|dark`.
   *
   * ⚠ The document is built from a stranger's package. It is served under a CSP
   * that sandboxes it and forbids scripts, and it must ALSO be embedded in a
   * sandboxed iframe: the second lock belongs where the embedding happens, so it
   * cannot be lost if the route is ever refactored.
   */
  previewTemplates?: string[];
  previewUrlBase?:   string;
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

// The download gate (ADR 0001). Core talks to a `MarketplaceSource`, never
// hardcoding a marketplace host — the URL comes from env.LICENSE_SERVER_URL,
// which defaults to the hosted marketplace (licenseserver.ich.codes). This source
// authenticates with a server-side account token (stored in `settings`, NOT
// the browser) and binds every download to this site's domain. A community /
// self-hosted source can implement the same interface and return free, no-op
// entitlements.

import { buildPaginationMeta } from "@nodevo/contracts";
import type {
  AuthorizedDownload,
  DownloadRequest,
  MarketplaceConnection,
  MarketplaceListing,
  MarketplaceSource,
  PaginatedRequest,
  PaginatedResponse,
} from "@nodevo/contracts";
import { NEC } from "@nodevo/contracts";
import { prisma } from "../../infrastructure/db.js";
import { DEV_CATALOG } from "./dev-catalog.js";
import { env } from "../../config/env.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import {
  deactivateAccountLicenses,
  getSiteDomain,
  getSiteId,
  provisionEntitlement,
  resolveEnvironment,
} from "./license-engine.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";

const SOURCE_ID = "nodevo.io";

// settings keys for the server-side connection (never exposed to the browser)
const K_TOKEN = `marketplace.${SOURCE_ID}.token`;
const K_REF   = `marketplace.${SOURCE_ID}.accountRef`;
const K_AT    = `marketplace.${SOURCE_ID}.connectedAt`;
// The set of plugin ids the marketplace sells as PAID. Cached from the catalogue
// so the license gate can be authoritative by id (not by a plugin's self-declared
// manifest `licenseRequired`, which an uploaded package controls). Read by
// license-engine.pluginRequiresLicense.
const K_PAID_IDS = "marketplace.paid_plugin_ids";

// Local licensing (core development): with a dev signing key present we serve
// the dev catalogue and mint entitlements locally instead of calling the hosted
// marketplace. Every real install has no dev key, so it uses the server.
const useDevLicensing = !!env.LICENSE_DEV_PRIVATE_KEY;

// Dev catalogue lives in dev-catalog.ts — shared with signDevJwt's grants.

async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return (row?.value as string | null) ?? null;
}

async function writeSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await prisma.setting.deleteMany({ where: { key } });
  } else {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  bustSettingsCache(key);
}

class NodevoMarketplaceSource implements MarketplaceSource {
  readonly id = SOURCE_ID;
  readonly label = "Nodevo Marketplace";

  async connect(authCode: string): Promise<MarketplaceConnection> {
    if (!authCode.trim()) {
      throw new NodevoError({ code: NEC.LICENSE_ACCOUNT_REQUIRED, httpStatus: 400, message: "An authorization code is required." });
    }

    let token = authCode.trim();
    let accountRef = "connected-account";

    // Prod: exchange the auth code for a durable account token + label.
    if (!useDevLicensing) {
      const res = await fetch(`${env.LICENSE_SERVER_URL}/account/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Domain = the CANONICAL site URL (site.url), the host this license is
        // bound to. environment lets the server bind dev/staging domains
        // without eating the production domain slot (ADR 0001 §5).
        body: JSON.stringify({
          authCode,
          domain:      await getSiteDomain(),
          environment: await resolveEnvironment(),
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);

      if (!res) {
        throw new NodevoError({ code: NEC.LICENSE_SOURCE_UNREACHABLE, httpStatus: 503, message: "Could not reach the marketplace to verify your account." });
      }
      if (res.status === 409) {
        // The account's license is bound to a different domain (1 license =
        // 1 instance) — the coupling is refused, with the server naming the
        // bound domain. Only a marketplace admin can move the binding.
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new NodevoError({ code: NEC.LICENSE_DOMAIN_MISMATCH, httpStatus: 409, message: body.message ?? "This account's license is bound to a different domain." });
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new NodevoError({
          code:       res.status >= 500 ? NEC.LICENSE_SOURCE_UNREACHABLE : NEC.LICENSE_ACCOUNT_REQUIRED,
          httpStatus: res.status >= 500 ? 503 : res.status,
          message:    body.message ?? "Could not connect your marketplace account.",
        });
      }
      const body = await res.json() as { token: string; accountRef?: string };
      token = body.token;
      accountRef = body.accountRef ?? accountRef;
    }

    const connectedAt = new Date().toISOString();
    await writeSetting(K_TOKEN, token);
    await writeSetting(K_REF, accountRef);
    await writeSetting(K_AT, connectedAt);

    logger.info({ source: this.id, accountRef }, "Marketplace account connected");
    return { sourceId: this.id, connected: true, accountRef, connectedAt };
  }

  async disconnect(): Promise<void> {
    const token = await readSetting(K_TOKEN);

    // Tell the marketplace BEFORE dropping the token so it can revoke the
    // token server-side (kills the abandoned credential + the portal's ghost
    // "connected site" row). The domain binding itself survives on the server:
    // a license is bound to the domain it was bought for, and only a
    // marketplace admin can release it — best-effort: an unreachable
    // marketplace must never block a disconnect.
    if (token && !useDevLicensing) {
      const siteId = await getSiteId();
      await fetch(`${env.LICENSE_SERVER_URL}/account/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ siteId, domain: await getSiteDomain(), environment: await resolveEnvironment() }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
    }

    await writeSetting(K_TOKEN, null);
    await writeSetting(K_REF, null);
    await writeSetting(K_AT, null);

    // Account-derived licenses die with the account coupling (§53): the raw key
    // was never here, so they could never refresh again anyway. Manual-key
    // licenses survive — they are the offline fallback.
    const deactivated = await deactivateAccountLicenses();

    logger.info({ source: this.id, deactivated }, "Marketplace account disconnected");
  }

  async getConnection(): Promise<MarketplaceConnection> {
    const token = await readSetting(K_TOKEN);
    return {
      sourceId:    this.id,
      connected:   !!token,
      accountRef:  await readSetting(K_REF),
      connectedAt: await readSetting(K_AT),
    };
  }

  async listPlugins(opts: PaginatedRequest): Promise<PaginatedResponse<MarketplaceListing>> {
    const all = (await this.fetchCatalog()) ?? DEV_CATALOG;
    // Keep the authoritative paid-id set fresh whenever we have the catalogue.
    void this.cachePaidIds(all).catch(() => {});

    const start = (opts.page - 1) * opts.limit;
    return {
      data: all.slice(start, start + opts.limit),
      meta: buildPaginationMeta({ page: opts.page, limit: opts.limit, total: all.length }),
    };
  }

  /** The full catalogue: the dev list in dev mode, else the live marketplace.
   *  null when the marketplace couldn't be reached (so callers don't clobber a
   *  cached paid-id set with a fallback). */
  private async fetchCatalog(): Promise<MarketplaceListing[] | null> {
    if (useDevLicensing) return DEV_CATALOG;
    const token = await readSetting(K_TOKEN);
    const res = await fetch(`${env.LICENSE_SERVER_URL}/marketplace/plugins`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    if (res?.ok) return (await res.json() as { plugins: MarketplaceListing[] }).plugins;
    return null;
  }

  /** Persist the ids the marketplace sells as paid (licenseRequired = true). */
  private async cachePaidIds(listings: MarketplaceListing[]): Promise<void> {
    const ids = listings.filter((l) => l.licenseRequired).map((l) => l.id);
    await prisma.setting.upsert({ where: { key: K_PAID_IDS }, update: { value: ids }, create: { key: K_PAID_IDS, value: ids } });
    bustSettingsCache(K_PAID_IDS);
  }

  /** Best-effort refresh of the paid-id set from the live catalogue. No-op when
   *  the marketplace is unreachable — the last cached set stays in force. */
  async refreshPaidPluginIds(): Promise<void> {
    const all = await this.fetchCatalog();
    if (all) await this.cachePaidIds(all);
  }

  async authorizeDownload(req: DownloadRequest): Promise<AuthorizedDownload> {
    const token = await readSetting(K_TOKEN);

    // Prod: the server is the chokepoint — it checks account ownership + the
    // per-domain activation cap before issuing a domain-bound entitlement.
    if (!useDevLicensing) {
      if (!token) {
        throw new NodevoError({ code: NEC.LICENSE_ACCOUNT_REQUIRED, httpStatus: 400, message: "Connect your marketplace account first." });
      }
      const res = await fetch(`${env.LICENSE_SERVER_URL}/marketplace/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);

      if (!res) {
        throw new NodevoError({ code: NEC.LICENSE_SOURCE_UNREACHABLE, httpStatus: 503, message: "Marketplace unreachable." });
      }
      if (res.status === 402 || res.status === 409) {
        throw new NodevoError({ code: NEC.LICENSE_CAP_REACHED, httpStatus: 402, message: "No free activation slot for this domain. Add a domain to your purchase." });
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new NodevoError({ code: NEC.LICENSE_NOT_FOUND, httpStatus: 404, message: body.message ?? `Marketplace returned ${res.status}` });
      }
      const body = await res.json() as Omit<AuthorizedDownload, "pluginId" | "version">;
      return { pluginId: req.pluginId, version: req.version, ...body };
    }

    // Dev: no server. Mint a domain-bound entitlement locally so the full gate
    // flow is exercisable end-to-end. Artifact bytes come from manual upload.
    const { jwt, expiresAt } = await provisionEntitlement();
    return { pluginId: req.pluginId, version: req.version, entitlementJwt: jwt, expiresAt, downloadUrl: null, sha256: null };
  }
}

// Concrete type (not the MarketplaceSource interface) so callers can reach the
// nodevo.io-specific paid-id cache refresh, which isn't part of the generic source.
export const marketplaceSource = new NodevoMarketplaceSource();

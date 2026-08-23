// The download gate (ADR 0001). Core talks to a `MarketplaceSource`, never
// hardcoding a marketplace host — the URL comes from env.LICENSE_SERVER_URL. A
// community / self-hosted source can implement the same interface and return
// free, no-op entitlements.
//
// This source speaks PROTOCOL v1 (the marketplace's `/api/v1`): every call
// after connect carries an account token AND an Ed25519 signature over the
// request, which is what lets a licence bind to this install's `siteId`
// instead of to its hostname. The transport lives in protocol-client.ts; this
// file is only the six conversations we have with it.

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
import { logger } from "../../infrastructure/logging/logger.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { deactivateAccountLicenses } from "./license-engine.js";
import { getSiteDomain, getSiteId, resolveEnvironment } from "./site-identity.js";
import {
  SOURCE_ID, K_REF, K_AT,
  clearIdentity, getAccountToken, getOrCreateKeypair, setAccountToken,
  protocolFetch, readSetting, writeSetting,
} from "./protocol-client.js";

/**
 * The set of ids the marketplace sells as PAID. Cached from the catalogue so the
 * licence gate can be authoritative BY ID, rather than trusting a plugin's
 * self-declared manifest `licenseRequired` — which an uploaded package controls.
 * Read by license-engine.pluginRequiresLicense.
 */
const K_PAID_IDS = "marketplace.paid_plugin_ids";

/** What the marketplace's `/account/licenses` hands back (protocol v1). */
export interface OwnedLicense {
  keyRef:       string;
  status:       string;
  seats:        number | null;
  seatsUsed:    number;
  /** Is this licence bound to THIS install, or only owned by the account. */
  activeHere:   boolean;
  updatesUntil: string | null;
  purchasedAt:  string;
  product: {
    id:               string;
    kind:             "plugin" | "theme";
    name:             string;
    vendor:           string;
    summary:          string | null;
    latestVersion:    string | null;
    latestReleasedAt: string | null;
  };
}

class NodevoMarketplaceSource implements MarketplaceSource {
  readonly id = SOURCE_ID;
  readonly label = "Nodevo Marketplace";

  /**
   * Exchange a portal auth code for an account token, registering this
   * install's public key on the way through.
   *
   * The only unsigned call in the protocol — until it succeeds this install has
   * no identity the marketplace knows about, so there is nothing to sign with.
   * The keypair is minted here and its private half never leaves the instance.
   */
  async connect(authCode: string): Promise<MarketplaceConnection> {
    if (!authCode.trim()) {
      throw new NodevoError({ code: NEC.LICENSE_ACCOUNT_REQUIRED, httpStatus: 400, message: "An authorization code is required." });
    }

    // getSiteId throws when the installer never finished — deliberately, and
    // BEFORE the network call: an install with no identity has nothing to bind
    // a licence to, and letting it connect would burn the admin's auth code.
    const siteId = await getSiteId();
    const { publicKeyB64 } = await getOrCreateKeypair();

    const body = await protocolFetch<{ token: string; expiresAt: string; accountRef?: string }>({
      method: "POST",
      path:   "/account/connect",
      signed: false,
      timeoutMs: 10_000,
      body: {
        authCode: authCode.trim(),
        siteId,
        publicKey:   publicKeyB64,
        domain:      await getSiteDomain(),
        environment: await resolveEnvironment(),
      },
    });

    const accountRef  = body.accountRef ?? "connected-account";
    const connectedAt = new Date().toISOString();

    await setAccountToken(body.token);
    await writeSetting(K_REF, accountRef);
    await writeSetting(K_AT, connectedAt);

    logger.info({ source: this.id, accountRef }, "Marketplace account connected");
    return { sourceId: this.id, connected: true, accountRef, connectedAt };
  }

  /**
   * Release this install's seats and drop every local credential.
   *
   * With install binding this is the ordinary way a customer moves a licence
   * between sites — deactivate here, activate there, no support ticket. That is
   * the operation hostname binding made impossible without staff.
   *
   * Best-effort on the wire: an unreachable marketplace must never block a
   * disconnect, and the local credentials go either way.
   */
  async disconnect(): Promise<void> {
    const token = await getAccountToken();

    if (token) {
      // A disconnect has to work even when everything else is broken, so a
      // missing install identity just means the marketplace cannot be told —
      // exactly like an unreachable one.
      //
      // try/catch, NOT a `.catch()` on the call: `getSiteId()` throws while the
      // argument object is being built, before there is a promise to attach a
      // handler to, so a rejection handler would never see it and an instance
      // with no install row could not disconnect at all.
      try {
        await protocolFetch<void>({
          method: "POST",
          path:   "/account/deactivate",
          timeoutMs: 10_000,
          body: {
            siteId:      await getSiteId(),
            domain:      await getSiteDomain(),
            environment: await resolveEnvironment(),
          },
        });
      } catch (err) {
        logger.info({ err }, "Marketplace not told about the disconnect — dropping local credentials anyway");
      }
    }

    await clearIdentity();

    // Account-derived licences die with the account coupling (§53): the raw key
    // was never here, so they could never refresh again anyway.
    const deactivated = await deactivateAccountLicenses();
    logger.info({ source: this.id, deactivated }, "Marketplace account disconnected");
  }

  async getConnection(): Promise<MarketplaceConnection> {
    return {
      sourceId:    this.id,
      connected:   !!(await getAccountToken()),
      accountRef:  await readSetting(K_REF),
      connectedAt: await readSetting(K_AT),
    };
  }

  /**
   * The catalogue, paginated BY THE SERVER.
   *
   * The previous protocol returned every listing in one array and let this
   * client slice it in memory, which stops being viable somewhere well short of
   * a real catalogue. The token rides along when we hold one, and that is what
   * makes `owned` come back populated.
   */
  async listPlugins(opts: PaginatedRequest): Promise<PaginatedResponse<MarketplaceListing>> {
    const page = await this.fetchCatalogPage({ page: opts.page, limit: opts.limit });
    if (!page) {
      // Unreachable / not connected — the ACP browse list is simply blank
      // rather than a fabricated catalogue.
      return { data: [], meta: buildPaginationMeta({ page: opts.page, limit: opts.limit, total: 0 }) };
    }
    return page;
  }

  /** One catalogue page. null when the marketplace couldn't be reached, so
   *  callers never clobber a cached paid-id set with a fallback. */
  private async fetchCatalogPage(q: { page: number; limit: number }): Promise<PaginatedResponse<MarketplaceListing> | null> {
    try {
      return await protocolFetch<PaginatedResponse<MarketplaceListing>>({
        method: "GET",
        path:   "/catalog",
        // Public read: signing it would buy nothing, but the token makes the
        // response carry `owned`.
        signed: false,
        optionalToken: true,
        timeoutMs: 8_000,
        query: { kind: "plugin", page: q.page, limit: q.limit },
      });
    } catch {
      return null;
    }
  }

  /**
   * Best-effort refresh of the paid-id set from the live catalogue.
   *
   * Walks every page: the set gates whether a plugin needs a licence at all, so
   * a partial set silently un-gates whatever fell off the end.
   */
  async refreshPaidPluginIds(): Promise<void> {
    const ids: string[] = [];
    for (let page = 1; ; page++) {
      const res = await this.fetchCatalogPage({ page, limit: 100 });
      if (!res) return;   // unreachable mid-walk — keep the last cached set intact
      for (const l of res.data) if (l.licenseRequired) ids.push(l.id);
      if (page >= (res.meta.totalPages ?? 1)) break;
      if (page > 50) break;   // a catalogue this size means something is wrong upstream
    }

    await prisma.setting.upsert({ where: { key: K_PAID_IDS }, update: { value: ids }, create: { key: K_PAID_IDS, value: ids } });
    bustSettingsCache(K_PAID_IDS);
  }

  /** Everything this install's account owns — licences, seats, update windows.
   *  The other direction of the protocol: not "may I have this", but "what do
   *  I have". Throws when no account is connected. */
  async listOwned(): Promise<OwnedLicense[]> {
    const { licenses } = await protocolFetch<{ licenses: OwnedLicense[] }>({
      method: "GET",
      path:   "/account/licenses",
      timeoutMs: 10_000,
    });
    return licenses;
  }

  /**
   * THE CHOKEPOINT. The marketplace checks the signature, the account, the
   * licence and (in production) the seat before it issues a fresh entitlement
   * and a single-use artifact URL.
   */
  async authorizeDownload(req: DownloadRequest): Promise<AuthorizedDownload> {
    const body = await protocolFetch<Omit<AuthorizedDownload, "pluginId" | "version">>({
      method: "POST",
      path:   "/downloads/authorize",
      body: {
        id:          req.pluginId,
        kind:        req.kind ?? "plugin",
        version:     req.version,
        siteId:      req.siteId,
        environment: req.environment,
      },
    });
    return { pluginId: req.pluginId, version: req.version, ...body };
  }
}

// Concrete type (not the MarketplaceSource interface) so callers can reach the
// nodevo.io-specific extras — the paid-id cache and the ownership listing —
// which aren't part of the generic source contract.
export const marketplaceSource = new NodevoMarketplaceSource();

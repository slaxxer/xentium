// The download gate (ADR 0001). Core talks to a `MarketplaceSource`; it never
// hardcodes nodevo.io. The nodevo.io source authenticates with a server-side
// account token (stored in `settings`, NOT the browser) and binds every download
// to this site's domain. A community / self-hosted source can implement the same
// interface and return free, no-op entitlements.

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
import { env } from "../../config/env.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { provisionEntitlement } from "./license-engine.js";

const SOURCE_ID = "nodevo.io";

// settings keys for the server-side connection (never exposed to the browser)
const K_TOKEN = `marketplace.${SOURCE_ID}.token`;
const K_REF   = `marketplace.${SOURCE_ID}.accountRef`;
const K_AT    = `marketplace.${SOURCE_ID}.connectedAt`;

// Dev catalogue mirror — used when no LICENSE_SERVER_URL is configured.
const DEV_CATALOG: MarketplaceListing[] = [
  { id: "nodevo-forum",        name: "Forum",               description: "Full-featured forum with categories, threads, and moderation.", vendor: "Nodevo", latestVersion: "1.0.0", priceCents: 2900, currency: "USD", licenseRequired: true  },
  { id: "nodevo-messaging",    name: "Private Messaging",   description: "Direct messaging with conversations and read receipts.",        vendor: "Nodevo", latestVersion: "1.0.0", priceCents: 1900, currency: "USD", licenseRequired: true  },
  { id: "nodevo-seo-tools",    name: "SEO Tools",           description: "Meta tags, sitemaps, structured data, and search optimization.", vendor: "Nodevo", latestVersion: "1.0.0", priceCents: 2400, currency: "USD", licenseRequired: true  },
  { id: "nodevo-analytics",    name: "Analytics",           description: "Built-in analytics dashboard with no third-party scripts.",     vendor: "Nodevo", latestVersion: "1.0.0", priceCents: 3400, currency: "USD", licenseRequired: true  },
  { id: "nodevo-advanced-mod", name: "Advanced Moderation", description: "Multi-account detection, scoring, and automation tools.",       vendor: "Nodevo", latestVersion: "1.0.0", priceCents: 4900, currency: "USD", licenseRequired: true  },
  { id: "nodevo-2fa",          name: "Two-Factor Auth",     description: "TOTP 2FA for all users. Admins can require it for staff.",      vendor: "Nodevo", latestVersion: "1.0.0", priceCents: 0,    currency: "USD", licenseRequired: false },
];

async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return (row?.value as string | null) ?? null;
}

async function writeSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await prisma.setting.deleteMany({ where: { key } });
    return;
  }
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
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
    if (env.LICENSE_SERVER_URL) {
      const res = await fetch(`${env.LICENSE_SERVER_URL}/account/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authCode, domain: new URL(env.APP_URL).host }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);

      if (!res || !res.ok) {
        throw new NodevoError({ code: NEC.LICENSE_SOURCE_UNREACHABLE, httpStatus: 503, message: "Could not reach the marketplace to verify your account." });
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
    await writeSetting(K_TOKEN, null);
    await writeSetting(K_REF, null);
    await writeSetting(K_AT, null);
    logger.info({ source: this.id }, "Marketplace account disconnected");
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
    let all = DEV_CATALOG;

    if (env.LICENSE_SERVER_URL) {
      const token = await readSetting(K_TOKEN);
      const res = await fetch(`${env.LICENSE_SERVER_URL}/marketplace/plugins`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(8_000),
      }).catch(() => null);
      if (res?.ok) {
        const body = await res.json() as { plugins: MarketplaceListing[] };
        all = body.plugins;
      }
    }

    const start = (opts.page - 1) * opts.limit;
    return {
      data: all.slice(start, start + opts.limit),
      meta: buildPaginationMeta({ page: opts.page, limit: opts.limit, total: all.length }),
    };
  }

  async authorizeDownload(req: DownloadRequest): Promise<AuthorizedDownload> {
    const token = await readSetting(K_TOKEN);

    // Prod: the server is the chokepoint — it checks account ownership + the
    // per-domain activation cap before issuing a domain-bound entitlement.
    if (env.LICENSE_SERVER_URL) {
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
    return { pluginId: req.pluginId, version: req.version, entitlementJwt: jwt, expiresAt, downloadUrl: null };
  }
}

export const marketplaceSource: MarketplaceSource = new NodevoMarketplaceSource();

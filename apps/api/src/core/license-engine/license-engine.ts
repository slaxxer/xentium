import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as jose from "jose";
import type { DeployEnvironment, EntitlementStatus } from "@nodevo/contracts";
import { prisma } from "../../infrastructure/db.js";
import { env, isProd } from "../../config/env.js";
import { logger } from "../../infrastructure/logging/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the bundled public key (in packages/sdk — read at repo root)
const PUBLIC_KEY_PATH = path.resolve(
  __dirname,
  "../../../../../packages/sdk/src/license-public-key.pem",
);

const GRACE_PERIOD_DAYS = 30;

// ── Domain binding (ADR 0001) ────────────────────────────────────────────────

/** The host this instance is bound to, derived from APP_URL. */
export function getSiteDomain(): string {
  try {
    return new URL(env.APP_URL).host;
  } catch {
    return "localhost";
  }
}

function isLocalHost(host: string): boolean {
  const h = host.split(":")[0] ?? host;
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h.endsWith(".local") ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/**
 * Where this instance runs. Domain binding is enforced ONLY in `production`;
 * `development` / `staging` are uncapped and never domain-locked (ADR 0001 §5),
 * which keeps local dev, CI, and staging painless.
 */
export function resolveEnvironment(): DeployEnvironment {
  if (!isProd) return "development";
  return isLocalHost(getSiteDomain()) ? "staging" : "production";
}

async function getPublicKey() {
  // LICENSE_PUBLIC_KEY (env) overrides the bundled key. In dev it holds the
  // public half of the dev signing pair, so the real RS256 verify path runs
  // locally. In prod it is unset and the bundled nodevo.io key is used.
  const pem = env.LICENSE_PUBLIC_KEY
    ? env.LICENSE_PUBLIC_KEY.replace(/\\n/g, "\n")
    : await readFile(PUBLIC_KEY_PATH, "utf8");
  return jose.importSPKI(pem, "RS256");
}

export interface EntitlementPayload {
  siteId:       string;
  licenseKey:   string;
  entitlements: string[];   // e.g. ["plugin.nodevo-forum", "plugin.nodevo-seo-tools"]
  domain?:      string;        // bound host (ADR 0001) — optional for back-compat
  environment?: DeployEnvironment;
  issuedAt:     number;
  expiresAt:    number;
  refreshAfter: number;
}

export async function verifyEntitlementJwt(jwt: string): Promise<EntitlementPayload> {
  const publicKey = await getPublicKey();
  const { payload } = await jose.jwtVerify(jwt, publicKey, { algorithms: ["RS256"] });
  return payload as unknown as EntitlementPayload;
}

/** Call the license server to get an entitlement JWT for a key, bound to this domain. */
async function fetchEntitlementJwt(licenseKey: string, siteId: string): Promise<string> {
  const domain      = getSiteDomain();
  const environment = resolveEnvironment();

  // Dev mode: sign locally with the dev private key
  if (env.LICENSE_DEV_PRIVATE_KEY && !env.LICENSE_SERVER_URL) {
    return signDevJwt(licenseKey, siteId, domain, environment);
  }

  if (!env.LICENSE_SERVER_URL) {
    throw new Error("License server is not configured. Set LICENSE_SERVER_URL in your environment.");
  }

  const res = await fetch(`${env.LICENSE_SERVER_URL}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Domain + environment are sent so the server can enforce the per-domain cap
    // and bind the issued entitlement to this host (ADR 0001).
    body: JSON.stringify({ licenseKey, siteId, domain, environment }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message ?? `License server returned ${res.status}`);
  }

  const { entitlementJwt } = await res.json() as { entitlementJwt: string };
  return entitlementJwt;
}

/** Dev-only: sign a JWT locally using the dev private key (matching the bundled public key). */
async function signDevJwt(
  licenseKey:  string,
  siteId:      string,
  domain:      string,
  environment: DeployEnvironment,
): Promise<string> {
  const pemKey = (env.LICENSE_DEV_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  const privateKey = await jose.importPKCS8(pemKey, "RS256");

  const now = Math.floor(Date.now() / 1000);

  return new jose.SignJWT({
    siteId,
    licenseKey,
    entitlements: ["plugin.nodevo-forum", "plugin.nodevo-messaging", "plugin.nodevo-advanced-moderation", "plugin.nodevo-seo-tools"],  // dev grants
    domain,
    environment,
    issuedAt:     now,
    expiresAt:    now + 365 * 24 * 3600,    // 1 year
    refreshAfter: now + 30  * 24 * 3600,    // 30 days
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now)
    .setExpirationTime("1y")
    .sign(privateKey);
}

async function getSiteId(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: "site.id" } });
  return (row?.value as string | null) ?? "dev-site";
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function activateLicense(licenseKey: string): Promise<void> {
  const existing = await prisma.license.findFirst({ where: { status: "active" } });
  if (existing) throw new Error("A license is already active. Deactivate it before activating a new one.");

  const siteId = await getSiteId();
  const jwt    = await fetchEntitlementJwt(licenseKey, siteId);
  const claims = await verifyEntitlementJwt(jwt);

  await prisma.license.create({
    data: {
      licenseKey,
      siteId,
      entitlementJwt: jwt,
      status:         "active",
      domain:         claims.domain ?? getSiteDomain(),
      environment:    claims.environment ?? resolveEnvironment(),
      expiresAt:      new Date(claims.expiresAt * 1000),
      refreshAfter:   new Date(claims.refreshAfter * 1000),
    },
  });

  logger.info(
    { licenseKey: licenseKey.slice(0, 8) + "…", entitlements: claims.entitlements, domain: claims.domain ?? getSiteDomain() },
    "License activated",
  );
}

export async function refreshLicense(): Promise<void> {
  const license = await prisma.license.findFirst({ where: { status: "active" } });
  if (!license) return;

  try {
    const jwt    = await fetchEntitlementJwt(license.licenseKey, license.siteId);
    const claims = await verifyEntitlementJwt(jwt);

    await prisma.license.update({
      where: { id: license.id },
      data: {
        entitlementJwt: jwt,
        domain:         claims.domain ?? license.domain ?? getSiteDomain(),
        environment:    claims.environment ?? license.environment ?? resolveEnvironment(),
        expiresAt:      new Date(claims.expiresAt * 1000),
        refreshAfter:   new Date(claims.refreshAfter * 1000),
        status:         "active",
      },
    });

    logger.info({ licenseId: license.id }, "License refreshed");
  } catch (err) {
    logger.warn({ licenseId: license.id, err }, "License refresh failed — grace period applies");

    // Mark expired if past grace period
    const graceCutoff = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 3600 * 1000);
    const lastRefresh  = license.refreshAfter ?? license.activatedAt;
    if (lastRefresh < graceCutoff) {
      await prisma.license.update({
        where: { id: license.id },
        data:  { status: "expired" },
      });
      logger.error({ licenseId: license.id }, "License expired (grace period exceeded)");
    }
  }
}

/**
 * Mint a domain-bound entitlement for the connected account / key without
 * persisting it. Used by the MarketplaceSource download gate (ADR 0001): the
 * source proves ownership, then hands the caller a fresh entitlement. In dev this
 * signs locally; in prod it comes from the license server.
 */
export async function provisionEntitlement(
  licenseKey = "account-connected",
): Promise<{ jwt: string; expiresAt: string; siteId: string }> {
  const siteId = await getSiteId();
  const jwt    = await fetchEntitlementJwt(licenseKey, siteId);
  const claims = await verifyEntitlementJwt(jwt);
  return { jwt, expiresAt: new Date(claims.expiresAt * 1000).toISOString(), siteId };
}

export async function deactivateLicense(): Promise<void> {
  await prisma.license.updateMany({
    where: { status: "active" },
    data:  { status: "deactivated" },
  });
  logger.info("License deactivated");
}

/**
 * Resolve the full entitlement status for a plugin (ADR 0001). Always runs the
 * real RS256 verification path — in dev the dev keypair signs and verifies
 * locally, so this exercises the exact logic prod uses.
 *
 * Domain binding is enforced ONLY in `production`: a signed `domain` claim that
 * doesn't match this site's host yields `domain_mismatch`. In `development` /
 * `staging` the domain claim is informational and never blocks.
 */
export async function getEntitlementStatus(pluginId: string): Promise<EntitlementStatus> {
  const environment = resolveEnvironment();
  const license = await prisma.license.findFirst({ where: { status: "active" } });

  const base = {
    pluginId,
    domain:      license?.domain ?? null,
    environment,
    expiresAt:   license?.expiresAt?.toISOString() ?? null,
    graceEndsAt: license?.expiresAt
      ? new Date(license.expiresAt.getTime() + GRACE_PERIOD_DAYS * 24 * 3600 * 1000).toISOString()
      : null,
  } satisfies Omit<EntitlementStatus, "state">;

  if (!license) return { ...base, state: "missing" };

  try {
    const claims = await verifyEntitlementJwt(license.entitlementJwt);
    if (!claims.entitlements.includes(`plugin.${pluginId}`)) {
      return { ...base, state: "missing" };
    }
    // Production-only domain enforcement (ADR 0001 §5).
    if (environment === "production" && claims.domain && claims.domain !== getSiteDomain()) {
      return { ...base, domain: claims.domain, state: "domain_mismatch" };
    }
    return { ...base, domain: claims.domain ?? base.domain, state: "valid" };
  } catch {
    // Verify failed (expired / unreachable signature) — apply the 30-day grace
    // window so running plugins are never bricked (§11).
    const graceCutoff = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 3600 * 1000);
    const lastGood = license.refreshAfter ?? license.activatedAt;
    return { ...base, state: lastGood > graceCutoff ? "grace" : "expired" };
  }
}

/** Boolean convenience: is the plugin usable right now (valid or within grace). */
export async function isPluginEntitled(pluginId: string): Promise<boolean> {
  const { state } = await getEntitlementStatus(pluginId);
  return state === "valid" || state === "grace";
}

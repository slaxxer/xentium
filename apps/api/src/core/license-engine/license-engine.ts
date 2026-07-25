import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as jose from "jose";
import type { DeployEnvironment, EntitlementStatus } from "@nodevo/contracts";
import { prisma } from "../../infrastructure/db.js";
import { env, isProd } from "../../config/env.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { getSetting } from "../../shared/utils/settings.js";
import { decryptSecret } from "../../shared/utils/secretBox.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";

/** Map a license-server error response to a coded NodevoError: 5xx = server
 *  trouble (unreachable-class, grace applies), 4xx = an explicit refusal whose
 *  message names the reason (unknown key, term ended, no free slot, …). */
async function licenseServerError(res: Response): Promise<NodevoError> {
  const body = await res.json().catch(() => ({}));
  const message = (body as any).message ?? `License server returned ${res.status}`;
  return res.status >= 500
    ? new NodevoError({ code: NEC.LICENSE_SOURCE_UNREACHABLE, httpStatus: 503, message })
    : new NodevoError({ code: NEC.LICENSE_SERVER_REJECTED, httpStatus: res.status, message });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the bundled public key (in packages/sdk — read at repo root)
const PUBLIC_KEY_PATH = path.resolve(
  __dirname,
  "../../../../../packages/sdk/src/license-public-key.pem",
);

const GRACE_PERIOD_DAYS = 30;

// ── Domain binding (ADR 0001) ────────────────────────────────────────────────

/**
 * The host this instance is bound to. The admin-configured canonical URL
 * (`site.url`, the same one served in canonical/OG meta) is the source of
 * truth — APP_URL is only the pre-install / unset fallback. Domain-bound
 * licensing must follow what the site claims to be publicly, not a deploy env.
 */
export async function getSiteDomain(): Promise<string> {
  const canonical = await getSetting<string>("site.url", "");
  try {
    return new URL(canonical || env.APP_URL).host;
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
export async function resolveEnvironment(): Promise<DeployEnvironment> {
  if (!isProd) return "development";
  return isLocalHost(await getSiteDomain()) ? "staging" : "production";
}

async function getPublicKey() {
  // LICENSE_PUBLIC_KEY (env) overrides the bundled entitlement-verification key —
  // e.g. to verify against a non-default license server. Normally unset, and the
  // bundled marketplace key is used (packages/sdk/src/license-public-key.pem —
  // must be licenseserver.ich.codes's public half; see the marketplace repo's
  // DEPLOY note).
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

/** Entitlement JWT for a raw key — used only to REFRESH legacy manual-key
 *  licenses; new activations are account-only. */
async function fetchEntitlementJwt(licenseKey: string, siteId: string): Promise<string> {
  const domain      = await getSiteDomain();
  const environment = await resolveEnvironment();

  const res = await fetch(`${env.LICENSE_SERVER_URL}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Domain + environment are sent so the server can enforce the per-domain cap
    // and bind the issued entitlement to this host (ADR 0001).
    body: JSON.stringify({ licenseKey, siteId, domain, environment }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  if (!res) {
    throw new NodevoError({ code: NEC.LICENSE_SOURCE_UNREACHABLE, httpStatus: 503, message: "License server unreachable." });
  }
  if (!res.ok) throw await licenseServerError(res);

  const { entitlementJwt } = await res.json() as { entitlementJwt: string };
  return entitlementJwt;
}

/**
 * This install's UUID, minted by the installer's finalize step into
 * ncf_installs.siteId. (A settings key "site.id" was read here historically,
 * but nothing ever wrote it — every instance reported "dev-site" to the
 * marketplace.) Exported: the single source for anything talking to the
 * license server.
 */
export async function getSiteId(): Promise<string> {
  const row = await prisma.install.findFirst({ select: { siteId: true } });
  return row?.siteId ?? "dev-site";
}

/**
 * Account-token activation (§53): the marketplace holds license keys hashed and
 * activates directly off the connected account — the raw key never travels.
 * Setting key mirrors marketplace-source's `marketplace.<SOURCE_ID>.token`
 * (not imported from there: that module imports us, and a cycle at load time
 * would break the plugin loader's dynamic imports).
 */
const MARKETPLACE_TOKEN_KEY = "marketplace.nodevo.io.token";

async function fetchAccountEntitlementJwt(siteId: string): Promise<{ jwt: string; keyRef: string }> {
  const domain      = await getSiteDomain();
  const environment = await resolveEnvironment();

  const row = await prisma.setting.findUnique({ where: { key: MARKETPLACE_TOKEN_KEY } });
  const stored = (row?.value as string | null) ?? null;
  const token = stored === null ? null : decryptSecret(stored); // encrypted at rest (A1.5)
  if (!token) {
    throw new NodevoError({ code: NEC.LICENSE_ACCOUNT_REQUIRED, httpStatus: 400, message: "No marketplace account is connected. Connect one in ACP \u2192 Extensions \u2192 License." });
  }

  const res = await fetch(`${env.LICENSE_SERVER_URL}/account/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ siteId, domain, environment }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  if (!res) {
    throw new NodevoError({ code: NEC.LICENSE_SOURCE_UNREACHABLE, httpStatus: 503, message: "License server unreachable." });
  }
  if (!res.ok) throw await licenseServerError(res);

  const body = await res.json() as { entitlementJwt: string; license?: { keyRef?: string } };
  return { jwt: body.entitlementJwt, keyRef: body.license?.keyRef ?? "NVL-account" };
}

/**
 * Activate from the connected marketplace account — no key entry. Returns true
 * when a license was activated, false when one was already active. This is THE
 * activation path: manual key entry was removed from the ACP 2026-07-18 — a
 * linked marketplace account is required. (Legacy `activatedVia: "key"` rows
 * from before that still refresh via /activate.)
 */
export async function activateFromAccount(): Promise<boolean> {
  const existing = await prisma.license.findFirst({ where: { status: "active" } });
  if (existing) return false;

  const siteId = await getSiteId();
  const { jwt, keyRef } = await fetchAccountEntitlementJwt(siteId);
  const claims = await verifyEntitlementJwt(jwt);

  const data = {
    siteId,
    entitlementJwt: jwt,
    status:         "active",
    activatedVia:   "account",
    domain:         claims.domain ?? await getSiteDomain(),
    environment:    claims.environment ?? await resolveEnvironment(),
    expiresAt:      new Date(claims.expiresAt * 1000),
    refreshAfter:   new Date(claims.refreshAfter * 1000),
  };
  await prisma.license.upsert({
    where:  { licenseKey: keyRef },
    create: { licenseKey: keyRef, ...data },
    update: data,
  });

  logger.info(
    { keyRef, entitlements: claims.entitlements, domain: claims.domain ?? await getSiteDomain() },
    "License activated from connected marketplace account",
  );
  return true;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Deactivate every license that was activated via the connected account (§53).
 * Called on marketplace disconnect: those rows only ever held the masked keyRef,
 * so without the account token they can never refresh again — keeping them
 * "active" would just be a 30-day zombie. Manual-key licenses (`activatedVia:
 * "key"`) are untouched: they are the offline fallback and outlive the account.
 * Rows are kept as `deactivated` so a reconnect revives them via upsert.
 */
export async function deactivateAccountLicenses(): Promise<number> {
  const { count } = await prisma.license.updateMany({
    where: { status: "active", activatedVia: "account" },
    data:  { status: "deactivated" },
  });
  if (count > 0) logger.info({ count }, "Account-activated licenses deactivated");
  return count;
}

export async function refreshLicense(): Promise<void> {
  const license = await prisma.license.findFirst({ where: { status: "active" } });
  if (!license) {
    // Connected account but nothing activated yet (connected before buying, or
    // pre-§53 instances): self-heal from the account instead of doing nothing.
    try {
      await activateFromAccount();
    } catch {
      // No connected account / no usable license — nothing to refresh.
    }
    return;
  }

  // An account-activated license with no connected account is a deliberate
  // state (the admin disconnected), not an outage — deactivate instead of
  // letting the grace window keep a zombie alive. Also converges instances
  // that disconnected before disconnect() learned to do this itself.
  if (license.activatedVia === "account") {
    const row = await prisma.setting.findUnique({ where: { key: MARKETPLACE_TOKEN_KEY } });
    if (!row?.value) {
      await prisma.license.update({ where: { id: license.id }, data: { status: "deactivated" } });
      logger.info({ licenseId: license.id }, "Account-activated license deactivated — no marketplace account connected");
      return;
    }
  }

  try {
    // Account-activated licenses refresh through the account token (the raw
    // key was never known here); manual keys refresh through /activate.
    // siteId is re-read, not taken from the row: rows activated while getSiteId
    // was broken carry "dev-site" — a refresh heals them to the install UUID.
    const siteId = await getSiteId();
    const jwt = license.activatedVia === "account"
      ? (await fetchAccountEntitlementJwt(siteId)).jwt
      : await fetchEntitlementJwt(license.licenseKey, siteId);
    const claims = await verifyEntitlementJwt(jwt);

    await prisma.license.update({
      where: { id: license.id },
      data: {
        siteId,
        entitlementJwt: jwt,
        domain:         claims.domain ?? license.domain ?? await getSiteDomain(),
        environment:    claims.environment ?? license.environment ?? await resolveEnvironment(),
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
  const environment = await resolveEnvironment();
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
    if (environment === "production" && claims.domain && claims.domain !== (await getSiteDomain())) {
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

/**
 * Whether a plugin needs a license to run — authoritative BY ID. A plugin only
 * requires a license if the marketplace sells THAT id as paid (cached set in
 * `marketplace.paid_plugin_ids`, refreshed from the catalogue). This deliberately
 * ignores the package's own `licenseRequired` manifest flag, which an uploaded
 * .nvplugin controls — so a paid plugin repackaged as "free" is still gated.
 * Ids the marketplace doesn't sell (genuine third-party plugins) aren't gated:
 * they aren't your product and couldn't be entitled through your account anyway.
 */
export async function pluginRequiresLicense(pluginId: string): Promise<boolean> {
  const { getSetting } = await import("../../shared/utils/settings.js");
  const paidIds = await getSetting<string[]>("marketplace.paid_plugin_ids", []);
  return Array.isArray(paidIds) && paidIds.includes(pluginId);
}

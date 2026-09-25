import { readFile } from "node:fs/promises";
import path from "node:path";
import * as jose from "jose";
import type { DeployEnvironment, EntitlementGrant, EntitlementStatus, ProductKind } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { env, isProd } from "../../config/env.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { getAccountToken, protocolFetch } from "./protocol-client.js";
import { getSiteDomain, getSiteId, resolveEnvironment } from "./site-identity.js";

// Re-exported so the many callers that ask this module "who am I" keep working;
// the answers themselves now live in site-identity, which the protocol client
// can import without a cycle back through here.
export { getSiteDomain, getSiteId, resolveEnvironment };

// Path to the bundled public key (in packages/sdk — read at repo root).
// Anchored on REPO_ROOT rather than walking up from import.meta.url: tsup
// bundles this module into apps/api/dist/, so a fixed number of `..` hops is
// only correct for the source layout and overshoots the repo root in a build.
const PUBLIC_KEY_PATH = path.resolve(
  env.REPO_ROOT,
  "packages/sdk/src/license-public-key.pem",
);

const GRACE_PERIOD_DAYS = 30;

/**
 * The marketplace's public half — the key that decides what this instance will
 * believe Xentium itself said.
 *
 * ⚠ `allowOverride` is the important argument, and it defaults to NO.
 *
 * `LICENSE_PUBLIC_KEY` exists so a developer can verify entitlements issued by
 * a local marketplace. That is fine for entitlements: a forged one only grants
 * plugin access on a box whose environment the forger already controls, and
 * nothing follows from it.
 *
 * It is NOT fine for the two things that carry an IDENTITY CLAIM — an
 * announcement ("the Xentium team says this", rendered in a modal in front of
 * an administrator) and a package signature ("the Xentium team reviewed this").
 * If an env var could reassign those, an admin could be talked into pointing
 * their instance at a stranger's signer, and both statements would then mean
 * whatever that stranger wanted. So they ask for the bundled key and get it,
 * whatever the environment says.
 *
 * In DEVELOPMENT the override is honoured for identity claims too, so a local
 * marketplace can be exercised end to end. That is not a hole worth closing:
 * nobody is protected from an operator who can already write their own `.env`,
 * and running a real forum in development mode has loud consequences of its own.
 * What the pin removes is the legitimate-looking configuration — "point this at
 * our community marketplace" stops being something a normal install can do.
 */
export async function getMarketplacePublicKey(opts: { allowOverride?: boolean } = {}) {
  return getPublicKey(opts.allowOverride === true || !isProd);
}

async function getPublicKey(allowOverride = true) {
  // LICENSE_PUBLIC_KEY (env) overrides the bundled ENTITLEMENT-verification key,
  // for development against a local marketplace. Normally unset, and the bundled
  // key is used (packages/sdk/src/license-public-key.pem — plugins.xentium.org's
  // public half; see the marketplace repo's DEPLOY note). It cannot move what an
  // announcement or a package signature is checked against in production — see
  // getMarketplacePublicKey.
  const pem = allowOverride && env.LICENSE_PUBLIC_KEY
    ? env.LICENSE_PUBLIC_KEY.replace(/\\n/g, "\n")
    : await readFile(PUBLIC_KEY_PATH, "utf8");
  return jose.importSPKI(pem, "RS256");
}

/**
 * The claims the marketplace signs. Mirrors its `EntitlementClaims` exactly —
 * this is the consuming half of a published contract, so a field that drifts
 * here does not fail loudly, it just quietly stops matching (a `missing`
 * entitlement for a plugin the site owns).
 */
export interface EntitlementPayload {
  siteId:       string;
  /** Display reference (`XEN-…`), never the key itself. */
  licenseRef:   string;
  entitlements: EntitlementGrant[];
  /** Reported at issue — display and audit only, gates nothing since v2. */
  domain?:      string;
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

/**
 * Legacy manual-key refresh.
 *
 * Protocol v1 has no key-entry endpoint: manual key entry was removed from the
 * ACP on 2026-07-18, and the server that served `/activate` no longer exists.
 * Rows carrying `activatedVia: "key"` therefore cannot be refreshed by anyone,
 * and pretending otherwise would just spend the 30-day grace window on requests
 * to a dead host before failing anyway.
 *
 * Refused loudly rather than deleted: an admin who still holds one of these
 * needs to be told to connect an account, not to watch a licence quietly rot.
 */
async function fetchEntitlementJwt(): Promise<string> {
  throw new XentiumError({
    code:       XEC.LICENSE_SERVER_REJECTED,
    httpStatus: 410,
    message:    "Manual license keys can no longer be refreshed. Connect your marketplace account in ACP → Extensions → License.",
  });
}

/**
 * Account activation (§53): the marketplace holds licence keys hashed and
 * activates directly off the connected account — the raw key never travels.
 *
 * `siteId` is sent in the body AND signed for in the headers. The marketplace
 * refuses a mismatch: the signature proves which install is calling, the body
 * says which it claims to be, and one install speaking for another is exactly
 * what install-binding has to make impossible.
 */
async function fetchAccountEntitlementJwt(siteId: string): Promise<{ jwt: string; keyRef: string }> {
  const body = await protocolFetch<{ entitlementJwt: string; license?: { keyRef?: string } }>({
    method: "POST",
    path:   "/account/activate",
    timeoutMs: 10_000,
    body: {
      siteId,
      domain:      await getSiteDomain(),
      environment: await resolveEnvironment(),
    },
  });
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
  const existing = await prisma.entitlement.findFirst({ where: { status: "active" } });
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
  await prisma.entitlement.upsert({
    where:  { licenseRef: keyRef },
    create: { licenseRef: keyRef, ...data },
    update: data,
  });

  logger.info(
    { keyRef, entitlements: claims.entitlements.map((e) => e.id), domain: claims.domain ?? await getSiteDomain() },
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
  const { count } = await prisma.entitlement.updateMany({
    where: { status: "active", activatedVia: "account" },
    data:  { status: "deactivated" },
  });
  if (count > 0) logger.info({ count }, "Account-activated licenses deactivated");
  return count;
}

export async function refreshLicense(): Promise<void> {
  const license = await prisma.entitlement.findFirst({ where: { status: "active" } });
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
    if (!(await getAccountToken())) {
      await prisma.entitlement.update({ where: { id: license.id }, data: { status: "deactivated" } });
      logger.info({ licenseId: license.id }, "Account-activated license deactivated — no marketplace account connected");
      return;
    }
  }

  try {
    // Account-activated licenses refresh through the signed protocol; manual
    // keys have no path left at all (see fetchEntitlementJwt).
    // siteId is re-read, not taken from the row: rows activated before the
    // "dev-site" fallback was removed carry that literal — a refresh heals them
    // to the install UUID. If the install row is missing entirely this throws,
    // and the catch below applies grace like any other refresh failure.
    const siteId = await getSiteId();
    const jwt = license.activatedVia === "account"
      ? (await fetchAccountEntitlementJwt(siteId)).jwt
      : await fetchEntitlementJwt();
    const claims = await verifyEntitlementJwt(jwt);

    await prisma.entitlement.update({
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
      await prisma.entitlement.update({
        where: { id: license.id },
        data:  { status: "expired" },
      });
      logger.error({ licenseId: license.id }, "License expired (grace period exceeded)");
    }
  }
}

export async function deactivateLicense(): Promise<void> {
  await prisma.entitlement.updateMany({
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
 *
 * ⚠ A grant is keyed `<kind>.<id>`, and the marketplace has issued both halves
 * since the catalogue learned to sell themes. `kind` defaults to `plugin` because
 * every caller that predates themes means a plugin — but a THEME asked for under
 * the default matches nothing and reads as `missing`, which is exactly how an
 * owned theme came back unowned.
 */
export async function getEntitlementStatus(pluginId: string, kind: ProductKind = "plugin"): Promise<EntitlementStatus> {
  const environment = await resolveEnvironment();
  const license = await prisma.entitlement.findFirst({ where: { status: "active" } });

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
    // Grants are objects — matching against the array itself silently fails
    // for every plugin, and "you do not own this" is not a failure mode that
    // announces itself.
    if (!claims.entitlements.some((e) => e.id === `${kind}.${pluginId}`)) {
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

/** Boolean convenience: is the product entitled right now (valid or within grace). */
export async function isEntitled(productId: string, kind: ProductKind = "plugin"): Promise<boolean> {
  const { state } = await getEntitlementStatus(productId, kind);
  return state === "valid" || state === "grace";
}

/** Is the plugin usable right now. The enable gate's call — named for it, because
 *  for a plugin this decides whether code runs, and for a theme nothing ever does. */
export async function isPluginEntitled(pluginId: string): Promise<boolean> {
  return isEntitled(pluginId, "plugin");
}

/**
 * Whether a plugin needs a license to run — authoritative BY ID. A plugin only
 * requires a license if the marketplace sells THAT id as paid (cached set in
 * `marketplace.paid_plugin_ids`, refreshed from the catalogue). This deliberately
 * ignores the package's own `licenseRequired` manifest flag, which an uploaded
 * .xtplugin controls — so a paid plugin repackaged as "free" is still gated.
 * Ids the marketplace doesn't sell (genuine third-party plugins) aren't gated:
 * they aren't your product and couldn't be entitled through your account anyway.
 */
export async function pluginRequiresLicense(pluginId: string): Promise<boolean> {
  return idIsPaid(pluginId, "marketplace.paid_plugin_ids");
}

/**
 * Whether the marketplace sells this THEME id as paid.
 *
 * Read by the ACP (buy vs install) and by the theme download path, so a refusal
 * can name the reason. ⚠ NOT by anything that renders: a theme is data, it has no
 * runtime, and a licence check on a theme already installed would be theatre —
 * the file is on disk and the pages are already arranged. The authoritative gate
 * is the marketplace's authenticated download, and it is the only one.
 */
export async function themeRequiresLicense(themeId: string): Promise<boolean> {
  return idIsPaid(themeId, "marketplace.paid_theme_ids");
}

/** Shared read of a cached paid-id set. The two sets are separate keys on
 *  purpose (see marketplace-source) — this only shares the lookup. */
async function idIsPaid(productId: string, key: string): Promise<boolean> {
  const { getSetting } = await import("../../shared/utils/settings.js");
  const paidIds = await getSetting<string[]>(key, []);
  return Array.isArray(paidIds) && paidIds.includes(productId);
}

/**
 * THE ENABLE GATE. Decide whether this plugin may be turned on, and when the
 * answer is no, say something the admin can act on.
 *
 * Everything here exists because the old gate — one cache read, one JWT read,
 * then a fixed refusal — was wrong in three separate ways at once, and each way
 * looked like the others:
 *
 *  1. `marketplace.paid_plugin_ids` was written ONLY by a plugin upload and the
 *     daily heartbeat, so a plugin the marketplace started selling this morning
 *     was un-gated on every install until that install's next heartbeat. The
 *     gate now syncs the set itself when it is stale.
 *  2. A plugin bought since the last entitlement refresh is genuinely owned but
 *     is not in the stored JWT yet, and the gate refused it. It now asks the
 *     marketplace once before saying no — which is also what makes "buy it,
 *     then enable it" work in the same minute.
 *  3. Every refusal said "Activate a license in ACP → Extensions → License",
 *     including to admins whose licence was already active and whose real
 *     problem was that all their seats were in use somewhere else. There is
 *     nothing to activate in that state, so the advice sent them in a circle.
 *
 * `pluginName` is only for the message; the decision is by id throughout.
 */
export async function assertPluginEnableAllowed(pluginId: string, pluginName: string): Promise<void> {
  const { marketplaceSource } = await import("./marketplace-source.js");

  // Is this a paid id at all? Re-sync first, so the answer is not up to a day
  // out of date. `never` means this install has never reached the marketplace,
  // so the set cannot be trusted to say "free" — see the fall-through below.
  const freshness = await marketplaceSource.ensurePaidPluginIdsFresh();
  const paid = await pluginRequiresLicense(pluginId);

  if (!paid) {
    if (freshness !== "never") return;
    // No set has ever been fetched, so "not in the set" carries no information.
    // The package's own manifest flag is the only signal left. It may only add
    // caution, never remove it: trusting a `false` here would reopen exactly the
    // "repackage a paid plugin as free" hole the by-id design closes, whereas
    // trusting a `true` at most asks an offline admin to connect an account.
    const record = await prisma.installedPlugin.findUnique({
      where:  { id: pluginId },
      select: { licenseRequired: true },
    });
    if (!record?.licenseRequired) return;
    throw new XentiumError({
      code:       XEC.LICENSE_SOURCE_UNREACHABLE,
      httpStatus: 503,
      message:    `"${pluginName}" declares that it needs a licence, and the marketplace could not be reached to check. Connect this install to a marketplace account and try again.`,
    });
  }

  if (await isPluginEntitled(pluginId)) return;

  // Owned-but-not-in-the-JWT is the ordinary state right after a purchase, so
  // ask before refusing. Best-effort: a refresh that fails leaves the stored
  // entitlement (and its grace window) exactly as it was.
  await refreshLicense().catch(() => {});
  if (await isPluginEntitled(pluginId)) return;

  throw await explainEnableRefusal(pluginId, pluginName);
}

/**
 * THE THEME DOWNLOAD PRE-CHECK — and it is only that.
 *
 * A paid theme is bought the same way a paid plugin is, but nothing about it can
 * ever be checked again once the file is here: a theme is data, it has no code to
 * run a check, and the pages it arranged are already arranged. So this runs at
 * DOWNLOAD time and nowhere else, and a theme that got in by any other route
 * (a manual `.xttheme` upload, a restore) is deliberately not touched. The
 * redistribution that follows from that is known and accepted (ADR-0001 / §53).
 *
 * The authoritative refusal is the marketplace's — it will not hand over an
 * artifact this account has no licence for. This exists because that refusal is a
 * deliberately vague 404 ("no such release, or it is not available to this
 * account"), which an admin reads as the marketplace being broken. Refusing here
 * first turns it into a sentence with a link in it.
 *
 * ⚠ Therefore it may only ever ADD a refusal the real gate would also make, never
 * withhold something the gate would hand over. Two consequences that are easy to
 * get wrong:
 *
 *  - A set this install has never fetched carries no information, so `never`
 *    proceeds to the real gate rather than guessing.
 *  - The stored entitlement is a fast YES, never a NO. A grant only exists if
 *    activation found this install a SEAT, and `/downloads/authorize` does not
 *    look at seats at all — it looks at the licence row. So an account whose
 *    production seats are all spent elsewhere still downloads, and refusing it
 *    here would have invented a rule the marketplace does not have.
 */
export async function assertThemeDownloadAllowed(themeId: string, themeName = themeId): Promise<void> {
  const { marketplaceSource } = await import("./marketplace-source.js");

  const freshness = await marketplaceSource.ensurePaidIdsFresh("theme");
  if (freshness === "never") return;              // no set has ever been fetched — say nothing
  if (!(await themeRequiresLicense(themeId))) return;

  // Fast yes: an entitled theme needs no round trip. Bought minutes ago is the
  // ordinary case here — a theme is browsed, bought and installed in one sitting,
  // while the stored JWT refreshes monthly — so a miss is worth one refresh.
  if (await isEntitled(themeId, "theme")) return;
  await refreshLicense().catch(() => {});
  if (await isEntitled(themeId, "theme")) return;

  // Still no grant. That is NOT yet a refusal (see the seat note above): ask what
  // the account actually holds, which is the same question the gate asks.
  let owned;
  try {
    owned = await marketplaceSource.listOwned();
  } catch {
    return;   // cannot ask — the real gate decides, as it would have anyway
  }

  const licence = owned.find((l) => l.product.kind === "theme" && l.product.id === themeId);
  if (licence && (licence.status === "active" || licence.status === "expiring")) return;

  throw await themeRefusal(themeId, themeName, licence);
}

/** The theme half of `explainEnableRefusal`, over a licence already fetched.
 *  Shorter, because two of that function's outcomes cannot arise here: a theme
 *  has no local manifest claiming it needs a licence, and a download spends no seat. */
async function themeRefusal(
  themeId:   string,
  themeName: string,
  licence:   { status: string } | undefined,
): Promise<XentiumError> {
  const { marketplaceWebUrl: url } = await import("./protocol-client.js");

  if (!(await getAccountToken())) {
    return new XentiumError({
      code:       XEC.LICENSE_ACCOUNT_REQUIRED,
      httpStatus: 402,
      message:    `"${themeName}" is a paid theme. Connect your marketplace account in ACP → Extensions → Licence and every licence you own applies to this install.`,
    });
  }

  if (licence) {
    return new XentiumError({
      code:       XEC.LICENSE_EXPIRED,
      httpStatus: 402,
      message:    `Your "${themeName}" licence is ${licence.status}. Renew it at ${url("/account/licences")} to download it again — a theme you already installed keeps working.`,
    });
  }

  return new XentiumError({
    code:       XEC.LICENSE_NOT_FOUND,
    httpStatus: 402,
    message:    `Your marketplace account does not own "${themeName}". It is available at ${url(`/themes/${themeId}`)}.`,
  });
}

/**
 * Turn "not entitled" into the specific reason, by asking the marketplace what
 * this account actually owns.
 *
 * `/account/licenses` already carries seats, seat usage and whether the licence
 * is bound HERE, so no protocol change was needed to tell "you never bought it"
 * apart from "you bought it and all your seats are on other sites" — the two
 * states that had been collapsing into one unhelpful message.
 *
 * Falls back to the generic refusal whenever the marketplace cannot be asked:
 * a vaguer message is better than a wrong one, and being offline is not proof
 * of anything about ownership.
 */
async function explainEnableRefusal(pluginId: string, pluginName: string): Promise<XentiumError> {
  const { marketplaceWebUrl } = await import("./protocol-client.js");
  const generic = new XentiumError({
    code:       XEC.LICENSE_NOT_FOUND,
    httpStatus: 402,
    message:    `"${pluginName}" needs a licence from your marketplace account, and this install does not have one yet.`,
  });

  if (!(await getAccountToken())) {
    return new XentiumError({
      code:       XEC.LICENSE_ACCOUNT_REQUIRED,
      httpStatus: 402,
      message:    `"${pluginName}" is a paid plugin. Connect your marketplace account in ACP → Extensions → Licence and every licence you own activates for this install.`,
    });
  }

  let owned;
  try {
    const { marketplaceSource } = await import("./marketplace-source.js");
    owned = await marketplaceSource.listOwned();
  } catch {
    return generic;
  }

  const licence = owned.find((l) => l.product.kind === "plugin" && l.product.id === pluginId);
  if (!licence) {
    return new XentiumError({
      code:       XEC.LICENSE_NOT_FOUND,
      httpStatus: 402,
      message:    `Your marketplace account does not own "${pluginName}". It is available at ${marketplaceWebUrl(`/plugins/${pluginId}`)}.`,
    });
  }

  // Owned, not bound here, and every seat spent elsewhere: the one refusal the
  // admin can fix without buying anything, and the one the old message hid.
  if (!licence.activeHere && licence.seats !== null && licence.seatsUsed >= licence.seats) {
    return new XentiumError({
      code:       XEC.LICENSE_CAP_REACHED,
      httpStatus: 402,
      message:    `All ${licence.seats} seat${licence.seats === 1 ? "" : "s"} of your "${pluginName}" licence are in use on other installs. Free one at ${marketplaceWebUrl("/account/licences")} and enable it again.`,
    });
  }

  if (licence.status === "expired" || licence.status === "revoked") {
    return new XentiumError({
      code:       XEC.LICENSE_EXPIRED,
      httpStatus: 402,
      message:    `Your "${pluginName}" licence is ${licence.status}. Renew it at ${marketplaceWebUrl("/account/licences")} to enable the plugin again.`,
    });
  }

  return generic;
}

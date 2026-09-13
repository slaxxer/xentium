import { createHash } from "node:crypto";
import { prisma } from "../../infrastructure/db.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { getSetting } from "../../shared/utils/settings.js";
import { compareSemver } from "../../shared/utils/semver.js";
import type { ProductKind } from "@nodevo/contracts";
import type { MarketplaceListQuery } from "../../core/license-engine/marketplace-source.js";
import { marketplaceSource } from "../../core/license-engine/marketplace-source.js";
import { marketplaceWebUrl } from "../../core/license-engine/protocol-client.js";
import {
  getSiteDomain, getSiteId, resolveEnvironment,
  refreshLicense, activateFromAccount, assertThemeDownloadAllowed,
} from "../../core/license-engine/license-engine.js";
import { processUpdateCheck } from "../../jobs/updateCheck.js";
import { pluginService } from "../plugins/plugin.service.js";
import { themeService } from "../themes/theme.service.js";
import { appearanceService } from "../appearance/appearance.service.js";
import { activityService } from "../activity/activity.service.js";
import { adminService } from "./admin.service.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { NEC, type NecCode } from "../../shared/errors/nec.js";
import { countGrants, licenseAttention } from "./licenseAttention.js";

/** One coarse step in the install/update progress stream (0..100 overall). */
export interface UpdateProgress { phase: string; percent: number; message?: string }
export type ProgressFn = (p: UpdateProgress) => void;

const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

/** Download/verify failure — a coded XentiumError so it flows through
 *  errorMiddleware in the canonical `{error:{code,…}}` shape. */
export class ArtifactError extends XentiumError {
  constructor(message: string, httpStatus: number, code: NecCode = NEC.MARKETPLACE_DOWNLOAD_FAILED) {
    super({ code, httpStatus, message });
    this.name = "ArtifactError";
  }
}

/**
 * Chokepoint: authorize the download for this site, stream the package (120s /
 * 50 MB cap, reporting byte progress), sha256-verify, and confirm the manifest id
 * matches the requested product. Reports coarse progress (authorizing → downloading
 * → verifying → validating, ~5..75%). Throws ArtifactError(status) on failure;
 * returns the verified buffer on success.
 *
 * `kind` picks which manifest reader runs at the validating step. Everything
 * before it — the gate, the transfer, the checksum — is identical for both, which
 * is why a theme download is this function with one branch rather than a second
 * copy of it: the chokepoint is supposed to be ONE place.
 */
async function downloadAndVerifyArtifact(
  productId: string, version: string, kind: ProductKind, onProgress?: ProgressFn,
): Promise<Buffer> {
  onProgress?.({ phase: "authorizing", percent: 5 });
  const authorized = await marketplaceSource.authorizeDownload({
    pluginId: productId, version, kind,
    siteId:      await getSiteId(),
    domain:      await getSiteDomain(),
    environment: await resolveEnvironment(),
  });
  if (!authorized.downloadUrl) {
    // Dev catalogue / community sources have no hosted artifact — manual upload path.
    throw new ArtifactError("This source has no downloadable artifact. Upload the package manually.", 400, NEC.MARKETPLACE_NO_ARTIFACT);
  }

  onProgress?.({ phase: "downloading", percent: 10 });
  const dl = await fetch(authorized.downloadUrl, { signal: AbortSignal.timeout(120_000) }).catch(() => null);
  if (!dl?.ok || !dl.body) {
    throw new ArtifactError(`Artifact download failed (${dl?.status ?? "unreachable"}). Try again.`, 502);
  }

  // Stream the body so the bar reflects real bytes (10..65% of the overall bar).
  const total  = Number(dl.headers.get("content-length") ?? 0);
  const reader = dl.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (received > MAX_ARTIFACT_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ArtifactError("Artifact exceeds the 50 MB package limit.", 502, NEC.MARKETPLACE_ARTIFACT_INVALID);
    }
    onProgress?.({
      phase:   "downloading",
      percent: total ? 10 + Math.round((received / total) * 55) : 15,
      message: total ? undefined : `${Math.round(received / 1024)} KB`,
    });
  }
  const buffer = Buffer.concat(chunks);

  onProgress?.({ phase: "verifying", percent: 70 });
  if (authorized.sha256) {
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== authorized.sha256) {
      throw new ArtifactError("Artifact integrity check failed (sha256 mismatch). Nothing was installed.", 502, NEC.MARKETPLACE_ARTIFACT_INVALID);
    }
  }

  onProgress?.({ phase: "validating", percent: 75 });
  // Validate first so a mismatched package (manifest id ≠ requested product) is
  // rejected before any install/import step touches the running instance.
  const info = kind === "theme"
    ? themeService.validateOnly(buffer)
    : await pluginService.validateOnly(buffer);
  if (info.id !== productId) {
    throw new ArtifactError(`Package manifest id "${info.id}" does not match the requested ${kind}.`, 502, NEC.MARKETPLACE_ARTIFACT_INVALID);
  }

  return buffer;
}

interface CachedUpdate {
  pluginId:          string;
  name?:             string;
  installedVersion?: string | null;
  latestVersion:     string;
  critical?:         boolean;
  renewalRequired?:  boolean;
  [k: string]:       unknown;
}

/**
 * Read the `marketplace.updates` cache and RECONCILE it against what's actually
 * installed right now. The cache is only refreshed by the update-check job, so a
 * plugin uninstalled (or already updated) since the last run would otherwise leave
 * a phantom "update available" alert on the ACP. An update survives only if its
 * plugin is still installed AND its current installed version is older than the
 * offered version; the installed version is refreshed for accurate display.
 */
async function readReconciledUpdates(): Promise<{ checkedAt: string | null; setSince?: string; updates: CachedUpdate[] }> {
  const raw = await getSetting<string>("marketplace.updates", "");
  if (!raw) return { checkedAt: null, updates: [] };

  let parsed: { checkedAt?: string | null; setSince?: string; updates?: CachedUpdate[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { checkedAt: null, updates: [] };
  }

  const cached = Array.isArray(parsed.updates) ? parsed.updates : [];
  if (!cached.length) return { checkedAt: parsed.checkedAt ?? null, setSince: parsed.setSince, updates: [] };

  const installed = await prisma.installedPlugin.findMany({ select: { id: true, installedVersion: true } });
  const byId = new Map(installed.map((p) => [p.id, p.installedVersion]));

  const updates = cached
    .filter((u) => {
      const current = byId.get(u.pluginId);
      return current !== undefined && compareSemver(u.latestVersion, current) > 0;
    })
    .map((u) => ({ ...u, installedVersion: byId.get(u.pluginId) ?? u.installedVersion }));

  return { checkedAt: parsed.checkedAt ?? null, setSince: parsed.setSince, updates };
}

/**
 * Poll secrets for in-flight link requests, held in memory only.
 *
 * Not a settings row: this is a short-lived credential for a handshake that
 * lasts ten minutes and belongs to one admin's click. Persisting it would mean
 * a live claim credential sitting in the database for every abandoned attempt,
 * which is exactly what the marketplace side goes out of its way not to do. A
 * restart mid-handshake costs one more click.
 */
const linkSecrets = new Map<string, { secret: string; expiresAt: number }>();

/** Drop anything the admin walked away from, so an idle instance is not holding
 *  secrets for handshakes nobody is waiting on. */
function pruneLinkSecrets() {
  const now = Date.now();
  for (const [id, held] of linkSecrets) if (held.expiresAt < now) linkSecrets.delete(id);
}

export const marketplaceService = {
  listPlugins(opts: MarketplaceListQuery) {
    return marketplaceSource.listPlugins(opts);
  },

  /**
   * Connection state, plus where the admin has to go to get a connect code.
   *
   * The URL is served rather than hardcoded in the ACP because the marketplace
   * host is a per-deployment setting (`LICENSE_SERVER_URL`), and a link the
   * browser guessed would be right only for installs pointed at the default
   * one. It carries no credential — it is the storefront's public address.
   */
  async getConnection() {
    return {
      ...(await marketplaceSource.getConnection()),
      accountUrl: marketplaceWebUrl("/account"),
      licencesUrl: marketplaceWebUrl("/account/licences"),
    };
  },

  /**
   * What this site's marketplace account OWNS, cross-referenced with what is
   * actually installed here.
   *
   * The ACP could previously only infer ownership from the entitlement JWT,
   * which lists grants rather than licences: it knows "you may run the Forum
   * plugin" but not how many seats that licence has, how many are spent, when
   * updates run out, or that a purchase made ten minutes ago exists at all. It
   * also says nothing about a licence the account owns and this site has never
   * activated — the exact case an admin moving a plugin between sites is in.
   *
   * `installedVersion`/`updateAvailable` are added here rather than asked of the
   * marketplace: what is installed is local knowledge, and asking a remote
   * service to tell us about our own filesystem is how the two drift.
   */
  async listOwned() {
    const licenses = await marketplaceSource.listOwned();

    const installed = await prisma.installedPlugin.findMany({ select: { id: true, installedVersion: true, status: true } });
    const byId = new Map(installed.map((p) => [p.id, p]));

    // A site wears ONE theme, so "what is installed" is a single manifest rather
    // than a table — and a theme row was reading the plugin table, where its id has
    // never existed. Every owned theme therefore came back installedVersion: null:
    // permanently "Inactive", never offering an update, whatever was actually on the
    // site. The manifest is the only local record a theme leaves.
    const theme = await appearanceService.getInstalledTheme();
    const themeId      = typeof theme?.id === "string" ? theme.id : null;
    const themeVersion = typeof theme?.version === "string" ? theme.version : null;

    return {
      licenses: licenses.map((l) => {
        const isTheme = l.product.kind === "theme";
        // ⚠ Only the theme this site actually wears counts as installed. Matching on
        // kind alone would mark every owned theme installed at the wearing theme's
        // version the moment one of them was imported.
        const localVersion = isTheme
          ? (themeId === l.product.id ? themeVersion : null)
          : (byId.get(l.product.id)?.installedVersion ?? null);
        const local = isTheme ? undefined : byId.get(l.product.id);

        return {
          ...l,
          installedVersion: localVersion,
          // A theme has no enabled/disabled state — it is staged in the appearance
          // draft or it is published, and neither is this field's vocabulary.
          installedStatus:  isTheme ? null : (local?.status ?? null),
          updateAvailable: !!(localVersion && l.product.latestVersion
            && compareSemver(l.product.latestVersion, localVersion) > 0),
        };
      }),
    };
  },

  /** Connect the marketplace account, then best-effort auto-activate its license
   *  (§53: manual key entry is the offline fallback — an account without a usable
   *  license connects fine and activates later via refresh/retry). */
  async connect(authCode: string) {
    const connection = await marketplaceSource.connect(authCode);
    let licenseActivated = false;
    try {
      licenseActivated = await activateFromAccount();
    } catch (err) {
      logger.info({ err }, "Marketplace connected; no license auto-activated");
    }
    return { ...connection, licenseActivated };
  },

  disconnect() {
    return marketplaceSource.disconnect();
  },

  /**
   * Start the one-click link, and hand the browser only what it may hold.
   *
   * The poll secret is the credential that claims the account token, so it
   * stays on the server: the ACP gets the code to display and the URL to open,
   * and polls through this API rather than talking to the marketplace itself.
   * That is also why the ACP never sees an account token at all — the same rule
   * the download gate follows.
   */
  async startLink() {
    pruneLinkSecrets();
    const link = await marketplaceSource.startLink();
    linkSecrets.set(link.linkId, { secret: link.pollSecret, expiresAt: Date.parse(link.expiresAt) });
    return {
      linkId:       link.linkId,
      userCode:     link.userCode,
      approveUrl:   link.approveUrl,
      expiresAt:    link.expiresAt,
      pollInterval: link.pollInterval,
    };
  },

  /**
   * Poll a link this instance started. Approval activates immediately, so the
   * admin's next paint already shows what they own — the whole point of the
   * one-click flow is that connecting and being licensed are one step.
   */
  async pollLink(linkId: string) {
    const held = linkSecrets.get(linkId);
    if (!held || held.expiresAt < Date.now()) {
      linkSecrets.delete(linkId);
      throw new XentiumError({
        code: NEC.LICENSE_ACCOUNT_REQUIRED, httpStatus: 404,
        message: "That connection attempt is no longer in progress. Start a new one.",
      });
    }

    const result = await marketplaceSource.pollLink(linkId, held.secret);
    if (result.status === "pending") return result;

    // Settled either way — the secret is single-use and has no second life.
    linkSecrets.delete(linkId);
    if (result.status !== "approved") return result;

    let licenseActivated = false;
    try {
      licenseActivated = await activateFromAccount();
    } catch (err) {
      logger.info({ err }, "Marketplace linked; no license auto-activated");
    }
    return { ...result, licenseActivated };
  },

  /** The authenticated download gate — verifies account + per-domain ownership and
   *  returns a fresh domain-bound entitlement for this site. */
  async authorizeDownload(pluginId: string, version: string, kind: ProductKind = "plugin") {
    return marketplaceSource.authorizeDownload({
      pluginId,
      version,
      kind,
      siteId:      await getSiteId(),
      domain:      await getSiteDomain(),
      environment: await resolveEnvironment(),
    });
  },

  /**
   * Cache written by the daily update-check job (§16) — updates, critical flags,
   * renewal warnings — reconciled against currently-installed plugins. Null
   * checkedAt = the job has never completed. `acknowledged` = has THIS admin
   * visited /admin/updates since the current pending set appeared (setSince);
   * the ACP-entry dialog uses it to stay visible per-admin until they actually
   * engage — not just dismiss it.
   */
  async getUpdates(userId?: string) {
    const { checkedAt, setSince, updates } = await readReconciledUpdates();

    // No pending updates → nothing to acknowledge. A missing setSince (pre-anchor
    // cache) is treated as unacknowledged so the dialog still nudges until the next
    // update-check writes the anchor.
    let acknowledged = true;
    if (updates.length && userId) {
      acknowledged = setSince
        ? await activityService.hasVisitedSince(userId, "/admin/updates", new Date(setSince))
        : false;
    }
    return { checkedAt, setSince, updates, acknowledged };
  },

  /**
   * Aggregated "admin attention" signals for the frontend navbar ACP badge.
   * Persists (count > 0) until the work is done: pending plugin updates until
   * they're applied, plus the license when it's about to expire (or has). Kept
   * deliberately small + server-side so the badge stays a dumb consumer and new
   * signals (core update, stuck jobs, …) can be OR-ed in here later.
   */
  async getStatusSummary(userId?: string) {
    // Pending plugin updates — reconciled so an uninstalled/already-updated
    // plugin never inflates the badge from a stale cache.
    const { updates } = await readReconciledUpdates();
    const pluginUpdates = updates.length;
    const criticalUpdate = updates.some((u) => u.critical);

    // Entitlement health. NOT "your subscription is ending" — see
    // licenseAttention.ts for why the previous rule was true for every
    // connected install in the field, forever.
    const license = await adminService.getActiveEntitlement();
    const attention = licenseAttention(
      license?.expiresAt ?? null,
      countGrants(license?.entitlementJwt),
    );
    const licenseExpiringSoon = attention.expiringSoon;
    const licenseExpired = attention.expired;
    const licenseDaysLeft = attention.daysLeft;
    const needsAttention = licenseExpiringSoon || licenseExpired;

    // Per-admin acknowledgement for the license-expiry dialog: has THIS admin
    // visited /admin/license since the license entered the warning window
    // (expiresAt − 30d)? That anchor is stable for the term and moves forward on
    // renewal, so the dialog re-nudges each cycle. Same visit-based model as the
    // update dialog (a dismissal never counts; only looking does).
    let licenseAcknowledged = true;
    if (needsAttention && userId && attention.anchor) {
      licenseAcknowledged = await activityService.hasVisitedSince(userId, "/admin/license", attention.anchor);
    }

    return {
      pluginUpdates,
      criticalUpdate,
      licenseExpiringSoon,
      licenseExpired,
      licenseDaysLeft,
      licenseExpiresAt:   license?.expiresAt ? new Date(license.expiresAt).toISOString() : null,
      licenseDomain:      license?.domain ?? null,
      licenseAcknowledged,
      // Badge count: each pending update + the license (once) if it needs attention.
      total: pluginUpdates + (needsAttention ? 1 : 0),
      // Red vs neutral badge.
      urgent: criticalUpdate || needsAttention,
    };
  },

  /**
   * Direct install (§16.2): authorize at the chokepoint, fetch the artifact
   * server-side (the account token never reaches the browser), verify its sha256,
   * then run the SAME intake as a manual upload. Lands installed but DISABLED —
   * enabling stays an explicit admin action. All failures are coded XentiumErrors
   * (ArtifactError for the download phase) — errorMiddleware shapes them.
   */
  async installFromMarketplace(pluginId: string, version: string, userId: string, onProgress?: ProgressFn) {
    let buffer: Buffer;
    try {
      buffer = await downloadAndVerifyArtifact(pluginId, version, "plugin", onProgress);
    } catch (err) {
      if (err instanceof XentiumError) throw err;
      throw new ArtifactError(err instanceof Error ? err.message : "Artifact download failed.", 502);
    }

    // downloadAndVerifyArtifact runs to 75%; the remainder is the intake work.
    // Coarse steps rather than invented precision — extraction and migrations
    // have no meaningful fraction to report, and a bar that stalls at a real
    // number reads better than one that creeps on a fabricated one.
    onProgress?.({ phase: "installing", percent: 80 });
    const manifest = await pluginService.install(buffer, userId);
    onProgress?.({ phase: "finalizing", percent: 95 });
    // A just-bought plugin isn't in the STORED entitlement JWT yet (it only
    // refreshes monthly) — refresh now so Enable works immediately instead
    // of failing NEC-LICENSE-9001 until the daily job. Best-effort.
    await refreshLicense().catch(() => {});
    // Refresh the update cache so a newly-installed (older) build surfaces its
    // available update right away, instead of waiting for the daily job.
    // Fire-and-forget — the admin sees it on their next ACP entry.
    void processUpdateCheck().catch(() => {});
    return { id: manifest.id, name: manifest.name, version: manifest.version };
  },

  /**
   * Install a THEME from the marketplace: the same chokepoint, the same transfer
   * and the same checksum as a plugin — then the ordinary `.nvtheme` import
   * instead of the plugin intake.
   *
   * ⚠ It lands in the DRAFT, not live, because that is what importing a theme has
   * always done and a downloaded theme is exactly the case the staging exists for:
   * a theme rewrites the arrangement of every page at once. Callers must say so —
   * an admin who clicks Install and sees nothing change on the site is looking at
   * correct behaviour they were not told about.
   *
   * Returns the import REPORT, not a bare ok: which templates it applied, which of
   * the admin's own it kept, and what it could not render. That report is the whole
   * reason `themeService.importTheme` answers with more than a boolean, and it is
   * the same thing the manual upload path shows.
   */
  async installThemeFromMarketplace(themeId: string, version: string, userId: string, onProgress?: ProgressFn) {
    // Before the round trip, not instead of it. The marketplace makes the real
    // decision; this only turns its deliberately vague 404 into a sentence naming
    // the theme and where to buy it. It never permits what the gate would refuse.
    await assertThemeDownloadAllowed(themeId);

    let buffer: Buffer;
    try {
      buffer = await downloadAndVerifyArtifact(themeId, version, "theme", onProgress);
    } catch (err) {
      if (err instanceof XentiumError) throw err;
      throw new ArtifactError(err instanceof Error ? err.message : "Artifact download failed.", 502);
    }

    onProgress?.({ phase: "importing", percent: 80 });
    const report = await themeService.importTheme(buffer, userId);

    onProgress?.({ phase: "finalizing", percent: 95 });
    // A theme bought minutes ago is not in the stored entitlement JWT yet — the
    // same reason the plugin path refreshes here. Best-effort: the import has
    // already succeeded and a refresh failure must not undo it.
    await refreshLicense().catch(() => {});

    return {
      id: report.manifest.id, name: report.manifest.name, version: report.manifest.version,
      templates:        report.templates,
      kept:             report.kept,
      unknownBlocks:    report.unknownBlocks,
      unknownTemplates: report.unknownTemplates,
      assetsImported:   report.assetsImported,
      customCssApplied: report.customCssApplied,
      replaced:         report.replaced,
    };
  },

  /** §16.2 update-in-place: download+verify (byte progress), then swap/migrate/
   *  re-enable via the plugin engine. Progress events flow through onProgress;
   *  errors propagate to the caller (the controller turns them into a terminal
   *  stream event — headers are already sent by then). */
  async updateFromMarketplace(pluginId: string, version: string, userId: string, onProgress?: ProgressFn) {
    const buffer = await downloadAndVerifyArtifact(pluginId, version, "plugin", onProgress);
    const manifest = await pluginService.update(buffer, userId, onProgress);
    return { id: manifest.id, name: manifest.name, version: manifest.version };
  },
};

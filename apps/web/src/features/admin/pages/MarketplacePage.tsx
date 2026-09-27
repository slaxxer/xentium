import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faEnvelope, faMagnifyingGlass,
  faChartBar, faShield, faKey, faCheck, faLock,
  faFlask, faPuzzlePiece, faShieldHalved, faPalette, faImage, faTriangleExclamation, faEye,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { api } from "../../../lib/api";
import { Pager } from "../../../components/Pager";
import { runStreamedJob } from "../../../lib/streamProgress";
import { slotRegistry } from "../../../plugins/slotRegistry";
import { themeGaps } from "../../../layout/themeFootprint";
import { themeInstallMessage } from "../hooks/themeInstallResult";
import { offerThemeSwitch, outcomeFromStream } from "../hooks/themeSwitchPrompt";
import { ThemePreview } from "../components/ThemePreview";
import { openPanelDialog } from "../../../lib/dialog";
import { TrustBadge } from "../components/TrustBadge";
import { ExtensionsUpdateBanner } from "../components/ExtensionsUpdateBanner";

type ProductKind = "plugin" | "theme";

interface MarketplacePlugin {
  id:              string;
  kind:            ProductKind;
  name:            string;
  description:     string;
  priceCents:      number;
  /** Null when the listing exists but nothing has been published yet. */
  latestVersion:   string | null;
  vendor:          string;
  licenseRequired: boolean;
  /** How hard we looked before listing it. Absent from an older catalogue page. */
  trustTier?:      "audited" | "reviewed" | "unvetted";
  /** A theme's own screenshot, served BY the marketplace as an absolute URL.
   *  Null for plugins and for themes whose package shipped none. */
  screenshot?:     string | null;
  /** The marketplace's answer, present when an account is connected. It knows
   *  about a purchase made a minute ago; the entitlement JWT only refreshes
   *  daily, so it does not. */
  owned?:          boolean;
  /** A theme's dependency footprint, read off the package at ingest. See
   *  `MarketplaceListing` in @xentium/contracts. */
  usesTemplates?:  string[];
  usesBlocks?:     string[];
  /** Pages the MARKETPLACE has rendered of this theme, and where they live.
   *  Absolute — the marketplace serves them, on its own origin. */
  previewTemplates?: string[];
  previewUrlBase?:   string;
}

// PaginatedResponse<MarketplaceListing> (ADR 0001)
interface MarketplaceResponse {
  data: MarketplacePlugin[];
  meta: { page: number; totalPages: number; total: number };
}

interface MarketplaceConnection {
  connected: boolean;
}

interface InstalledPlugin {
  id:     string;
  status: string;
}

/** A site runs at most ONE theme, so "what is installed" is a single manifest
 *  rather than the list the plugin grid works from. */
interface InstalledTheme {
  manifest: { id: string; name: string; version: string } | null;
}

interface License {
  entitlementJwt: string;
}

// Fallback icon/color map for plugins that don't register web metadata
const ICON_MAP_FALLBACK: Record<string, IconDefinition> = {
  "xentium-messaging":    faEnvelope,
  "xentium-seo-tools":    faMagnifyingGlass,
  "xentium-analytics":    faChartBar,
  "xentium-advanced-mod": faShieldHalved,
  "xentium-2fa":          faShield,
};

const COLOR_MAP_FALLBACK: Record<string, string> = {
  "xentium-messaging":    "var(--c-success)",
  "xentium-seo-tools":    "#f472b6",
  "xentium-analytics":    "#38bdf8",
  "xentium-advanced-mod": "var(--c-danger)",
  "xentium-2fa":          "var(--c-warn)",
};

function getPluginIcon(pluginId: string): IconDefinition {
  return (slotRegistry.getPluginMeta(pluginId)?.icon as IconDefinition | undefined)
    ?? ICON_MAP_FALLBACK[pluginId]
    ?? faPuzzlePiece;
}

function getPluginColor(pluginId: string): string {
  return slotRegistry.getPluginMeta(pluginId)?.accentColor
    ?? COLOR_MAP_FALLBACK[pluginId]
    ?? "var(--c-accent)";
}

/** Grants are signed as objects (`{id, updatesUntil?}`) — see EntitlementGrant.
 *  Only the ids are wanted here. */
function parseEntitlements(jwt: string): string[] {
  try {
    const grants = (JSON.parse(atob(jwt.split(".")[1]!)) as any).entitlements ?? [];
    return grants.map((g: any) => (typeof g === "string" ? g : g?.id)).filter(Boolean);
  } catch { return []; }
}

export function MarketplacePage() {
  const { t } = useTranslation("acp");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // Which half of the catalogue is on screen. Two grids rather than one mixed
  // one: a plugin card asks "is it enabled", a theme card asks "is it the look
  // this site is wearing", and the two questions have no shared answer.
  const [kind, setKind] = useState<ProductKind>("plugin");

  // The catalogue searches server-side, so the term belongs in the request, not
  // in a filter over what happened to arrive. Debounced so typing does not fire
  // a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  // A new term — or a new tab — restarts at page 1. Staying on page 3 of the
  // previous result set shows an empty grid and looks like "no matches", and
  // switching to Themes on page 3 of the plugins is the same bug.
  useEffect(() => { setPage(1); }, [debouncedSearch, kind]);

  // Direct install (§16.2): the server authorizes at the chokepoint, fetches +
  // sha256-verifies the artifact, and runs the normal intake. Lands disabled.
  // Progress streams as ndjson and drives a dialog — the same contract the
  // Updates page uses — so a multi-megabyte download shows real byte progress
  // instead of the button sitting silent until a toast appears at the end.
  const installMutation = useMutation({
    mutationFn: async (p: MarketplacePlugin) => {
      const { ok, final } = await runStreamedJob(
        "/admin/marketplace/install",
        { pluginId: p.id, version: p.latestVersion, kind: p.kind },
        {
          icon:         "update",
          title:        t("marketplace.progressTitle", { name: p.name }),
          startMessage: t("marketplace.phase.starting"),
          phaseLabel:   (phase, message) => {
            const label = t(`marketplace.phase.${phase}`, { defaultValue: t("marketplace.phase.working") });
            return message ? `${label} ${message}` : label;
          },
          // A theme is INSTALLED, not switched to — unless it is an update to the
          // one being worn. The sentence says which; the switch prompt follows.
          // The card warned before the purchase; this is the same fact after it,
          // for the admin who bought anyway or whose plugin was disabled since.
          successMessage: (final) => p.kind === "theme"
            ? themeInstallMessage(t, p.name, final)
            : t("marketplace.progressDone", { name: p.name }),
          failureMessage: (final, err) =>
            (final?.message as string) ??
            (err instanceof Error ? err.message : t("marketplace.progressFailed")),
        },
      );
      if (!ok) throw new Error("install_failed");   // keeps isPending/isError honest
      // Installing is not switching. Asked HERE, inside the mutation, so the
      // invalidation below runs after the answer and picks up a switch too.
      if (p.kind === "theme") await offerThemeSwitch(t, outcomeFromStream(p.id, p.name, final));
      return ok;
    },
    onSuccess: () => {
      // The dialog already reported the outcome; no toast on top of it.
      void queryClient.invalidateQueries({ queryKey: ["acp-installed-plugins"] });
      void queryClient.invalidateQueries({ queryKey: ["acp-marketplace-updates"] });
      // Everything a theme import touches — the same set the Themes page
      // invalidates after a manual upload, because it is the same import.
      void queryClient.invalidateQueries({ queryKey: ["acp-theme-installed"] });
      void queryClient.invalidateQueries({ queryKey: ["acp-layout"] });
      void queryClient.invalidateQueries({ queryKey: ["acp-layout-status"] });
      void queryClient.invalidateQueries({ queryKey: ["acp-layout-templates"] });
      void queryClient.invalidateQueries({ queryKey: ["acp-tokens"] });
    },
    // Failure is shown in the dialog too, so nothing to add here.
    onError: () => {},
  });

  const { data: market }    = useQuery<MarketplaceResponse>({
    queryKey: ["acp-marketplace", kind, page, debouncedSearch],
    queryFn:  () => api.get(`/admin/marketplace/plugins?kind=${kind}&page=${page}${debouncedSearch ? `&q=${encodeURIComponent(debouncedSearch)}` : ""}`),
    placeholderData: (prev) => prev,
  });
  // Only while the Themes tab is open: on the plugins tab it is a request whose
  // answer nothing on screen would use.
  const { data: theme }     = useQuery<InstalledTheme>({
    queryKey: ["acp-theme-installed"],
    queryFn:  () => api.get("/admin/themes/installed"),
    enabled:  kind === "theme",
  });
  const { data: installed } = useQuery<InstalledPlugin[]>({ queryKey: ["acp-installed-plugins"], queryFn: () => api.get("/plugins") });
  const { data: license }   = useQuery<License | null>({ queryKey: ["acp-license"], queryFn: () => api.get("/admin/license") });
  const { data: conn }      = useQuery<MarketplaceConnection>({ queryKey: ["acp-marketplace-connection"], queryFn: () => api.get("/admin/marketplace/connection") });

  const entitlements = license ? parseEntitlements(license.entitlementJwt) : [];
  const installedMap = Object.fromEntries((installed ?? []).map((p) => [p.id, p.status]));

  // No client-side filter: the server already answered this exact query. The
  // old in-memory filter searched only the fetched page, so a plugin on page 2
  // reported "no results" for its own name.
  const plugins = market?.data ?? [];

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.extensions")}</div>
          <h1 className="acp-page-title">{t("nav.marketplace")}</h1>
        </div>
      </div>

      <ExtensionsUpdateBanner />

      {/* Account connection notice (ADR 0001) */}
      {!conn?.connected && (
        <div style={{ background:"color-mix(in srgb, var(--c-warn) 12%, transparent)", border:"1px solid color-mix(in srgb, var(--c-warn) 30%, transparent)", borderRadius:"var(--radius-md)", padding:"12px 18px", marginBottom:20, display:"flex", alignItems:"center", gap:10, fontSize:"var(--fs-sm)", color:"var(--c-warn)" }}>
          <FontAwesomeIcon icon={faFlask} />
          <span>
            <Trans ns="acp" i18nKey="marketplace.notConnected" components={[
              <button key="0" type="button" onClick={() => navigate("/admin/license")} style={{ background:"none", border:"none", padding:0, color:"inherit", fontWeight:700, textDecoration:"underline", cursor:"pointer" }} />,
            ]} />
          </span>
        </div>
      )}

      {/* License banner */}
      <div style={{ background: license ? "var(--c-accent-soft)" : "var(--c-surface)", border:`1px solid ${license ? "var(--c-accent-glow)" : "var(--c-border)"}`, borderRadius:"var(--radius-md)", padding:"14px 20px", marginBottom:24, display:"flex", alignItems:"center", gap:12 }}>
        <FontAwesomeIcon icon={faKey} style={{ fontSize:"var(--fs-lg)", color: license ? "var(--c-accent)" : "var(--c-fg-muted)" }} />
        <div style={{ flex:1 }}>
          {license ? (
            <>
              <div style={{ fontSize:"var(--fs-md)", fontWeight:700, color:"var(--c-fg)" }}>{t("marketplace.licenseActive")}</div>
              <div style={{ fontSize:"var(--fs-sm)", color:"var(--c-fg-muted)" }}>
                {entitlements.length ? t("marketplace.entitlementsList", { list: entitlements.map((e) => e.replace(/^(plugin|theme)\./, "")).join(", ") }) : t("marketplace.noEntitlements")}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize:"var(--fs-md)", fontWeight:700, color:"var(--c-fg)" }}>{t("marketplace.noLicense")}</div>
              <div style={{ fontSize:"var(--fs-sm)", color:"var(--c-fg-muted)" }}>{t("marketplace.activateHint")}</div>
            </>
          )}
        </div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => navigate("/admin/license")}>
          {license ? t("marketplace.manage") : t("marketplace.activate")}
        </button>
      </div>

      {/* Two halves of one catalogue. The core's tab bar, not a bespoke control —
          the ACP has exactly one of these and this page is not the exception. */}
      <div className="acp-tab-bar" style={{ marginBottom: 20 }}>
        {(["plugin", "theme"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`acp-tab${kind === k ? " acp-tab--active" : ""}`}
            onClick={() => setKind(k)}
          >
            <FontAwesomeIcon icon={k === "theme" ? faPalette : faPuzzlePiece} />{" "}
            {t(`marketplace.tab.${k}`)}
          </button>
        ))}
      </div>

      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <input
          className="acp-input"
          placeholder={t(kind === "theme" ? "marketplace.searchThemesPlaceholder" : "marketplace.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width:280 }}
        />
      </div>

      {/* Said once above the grid rather than on every card: installing a theme
          applies it immediately, and the admin has somewhere to go to manage it. */}
      {kind === "theme" && (
        <p style={{ fontSize:"var(--fs-sm)", color:"var(--c-fg-subtle)", margin:"-8px 0 18px", maxWidth:"80ch" }}>
          {t("marketplace.themeDraftNote")}{" "}
          <button type="button" onClick={() => navigate("/admin/themes")}
            style={{ background:"none", border:"none", padding:0, color:"var(--c-accent)", fontWeight:700, textDecoration:"underline", cursor:"pointer", font:"inherit" }}>
            {t("marketplace.themeGoManage")}
          </button>
        </p>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))", gap:16 }}>
        {plugins.map((p) => {
          const isTheme   = p.kind === "theme";
          const icon      = isTheme ? faPalette : getPluginIcon(p.id);
          const color     = isTheme ? "var(--c-accent)" : getPluginColor(p.id);
          // A site wears one theme, so "installed" is an identity check against the
          // one manifest — not a lookup in the plugin map, which has no theme in it.
          const instStatus = isTheme
            ? (theme?.manifest?.id === p.id ? "enabled" : undefined)
            : installedMap[p.id];
          // Ownership from the marketplace wins when it answered; the local
          // entitlement JWT is the offline fallback. A plugin bought two
          // minutes ago is owned but not yet in any entitlement.
          // ⚠ Keyed `<kind>.<id>` — the marketplace has signed both halves since the
          // catalogue learned to sell themes. Hardcoding `plugin.` here made every
          // owned THEME read as unowned whenever the catalogue did not answer
          // `owned` (offline, or no account connected), which offered "Buy" for
          // something already paid for.
          const entitled  = p.owned ?? entitlements.includes(`${p.kind}.${p.id}`);
          const locked    = p.licenseRequired && !entitled;
          // A free plugin needs no entitlement — gating it behind one offered
          // "Buy" for something that costs nothing and installs fine.
          const installable = (entitled || !p.licenseRequired) && !!p.latestVersion;
          // Only a theme carries a footprint; `themeGaps` answers null for anything
          // without one, including a theme listed before footprints existed.
          const gaps = isTheme ? themeGaps(p) : null;

          return (
            <div key={p.id} className="acp-card" style={{ padding:22, position:"relative", opacity: locked ? 0.8 : 1, overflow:"hidden" }}>
              {locked && (
                <div style={{ position:"absolute", top:14, right:14, zIndex:1 }}>
                  <FontAwesomeIcon icon={faLock} style={{ color:"var(--c-fg-muted)", fontSize:"var(--fs-md)" }} />
                </div>
              )}

              {/* A theme is bought for how it looks, so its screenshot leads the
                  card. A theme whose package shipped none gets a plain placeholder
                  rather than nothing — a grid where some cards have a picture and
                  others start with text reads as a loading failure. */}
              {isTheme && (
                p.screenshot ? (
                  <img
                    src={p.screenshot}
                    alt=""
                    loading="lazy"
                    // ⚠ `maxWidth: none` is load-bearing: the app's global `img`
                    // rule caps every image at `max-width: 100%`, which clamps a
                    // full-bleed width straight back to the padded content box —
                    // silently, and only visibly as an image that is inset on one
                    // side. The negative margins alone do not survive it.
                    style={{ display:"block", width:"calc(100% + 44px)", maxWidth:"none", margin:"-22px -22px 14px", aspectRatio:"16 / 10", objectFit:"cover", background:"var(--c-surface)" }}
                  />
                ) : (
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"center", width:"calc(100% + 44px)", margin:"-22px -22px 14px", aspectRatio:"16 / 10", background:"var(--c-surface)", borderBottom:"1px solid var(--c-border)", color:"var(--c-fg-subtle)", fontSize:"1.375rem" }}>
                    <FontAwesomeIcon icon={faImage} />
                  </div>
                )
              )}

              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:12 }}>
                <div style={{ width:44, height:44, background:`${color}15`, border:`1px solid ${color}30`, borderRadius:"var(--radius-md)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"var(--fs-xl)", color }}>
                  <FontAwesomeIcon icon={icon} />
                </div>
                <div style={{ fontSize:"var(--fs-lg)", fontWeight:800, color:"var(--c-fg)", textAlign:"right" }}>
                  {p.priceCents === 0 ? t("marketplace.free") : `$${(p.priceCents / 100).toFixed(0)}`}
                  {p.priceCents > 0 && <span style={{ fontSize:"var(--fs-xs)", fontWeight:400, color:"var(--c-fg-muted)" }}>{t("marketplace.perYear")}</span>}
                </div>
              </div>

              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:6 }}>
                <span style={{ fontSize:"var(--fs-base)", fontWeight:800, color:"var(--c-fg)" }}>{p.name}</span>
                {/* Before the money, not after it. How hard we looked is part of
                    what a buyer is deciding on, and a theme has no code for us to
                    have looked at. */}
                {!isTheme && p.trustTier && <TrustBadge tier={p.trustTier} mode="tier" />}
              </div>
              <div style={{ fontSize:"var(--fs-sm)", color:"var(--c-fg-muted)", lineHeight:1.6, marginBottom:16 }}>{p.description}</div>

              {/* On the CARD, beside the price — a theme's missing pieces are part
                  of what it costs, and a warning shown after the purchase is not
                  a warning. The types are named because that is the true thing we
                  can say; see `themeGaps`. */}
              {gaps && (
                <div
                  style={{
                    display:"flex", gap:8, alignItems:"flex-start", marginBottom:16, padding:"9px 11px",
                    borderRadius:"var(--radius-md)", background:"color-mix(in srgb, var(--c-warn) 12%, transparent)",
                    color:"var(--c-fg)", fontSize:"var(--fs-xs)", lineHeight:1.5,
                  }}
                >
                  <FontAwesomeIcon icon={faTriangleExclamation} style={{ color:"var(--c-warn)", marginTop:2 }} />
                  <div>
                    <div style={{ fontWeight:700 }}>
                      {t("marketplace.themeGapsTitle", { count: gaps.blocks.length + gaps.templates.length })}
                    </div>
                    <div style={{ color:"var(--c-fg-muted)", wordBreak:"break-word" }}>
                      {[...gaps.templates, ...gaps.blocks].join(", ")}
                    </div>
                    <div style={{ color:"var(--c-fg-muted)", marginTop:3 }}>{t("marketplace.themeGapsHint")}</div>
                  </div>
                </div>
              )}

              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {/* Beside the install action, never instead of it. Installing a
                    theme restages every page at once, and until this existed the
                    only way to see one was to do it — on a change that has no undo
                    (a theme has no runtime; nothing can un-give the package). */}
                {isTheme && p.previewUrlBase && p.previewTemplates?.length ? (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => void openPanelDialog({
                      // An ALERT, not a confirm: there is nothing here to agree to,
                      // and a Cancel beside a Close asks the admin which of two
                      // identical outcomes they meant.
                      kind:  "alert",
                      icon:  "info",
                      title: t("marketplace.previewTitle", { name: p.name }),
                      confirmText: t("marketplace.previewClose"),
                      bodyNode: (
                        <ThemePreview
                          name={p.name}
                          base={p.previewUrlBase!}
                          templates={p.previewTemplates!}
                        />
                      ),
                    })}
                  >
                    <FontAwesomeIcon icon={faEye} style={{ marginRight: 6 }} />
                    {t("marketplace.preview")}
                  </button>
                ) : null}
                {instStatus === "enabled" ? (
                  <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:100, fontSize:"var(--fs-2xs)", fontWeight:700, background:"color-mix(in srgb, var(--c-success) 15%, transparent)", color:"var(--c-success)" }}>
                    {/* For a theme this says "installed", not "enabled": a theme
                        has no enabled state, and the library may hold several while
                        exactly one is active — "enabled" would claim this is the one
                        the site is wearing, which is a different question. */}
                    <FontAwesomeIcon icon={faCheck} /> {t(isTheme ? "marketplace.themeInstalled" : "marketplace.enabled")}
                  </span>
                ) : instStatus ? (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => navigate("/admin/installed")}>
                    {t("marketplace.goManage")}
                  </button>
                ) : installable ? (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    style={{ color:"var(--c-accent)", borderColor:"var(--c-accent-glow)", background:"var(--c-accent-soft)" }}
                    disabled={installMutation.isPending}
                    onClick={() => installMutation.mutate(p)}
                  >
                    {installMutation.isPending && installMutation.variables?.id === p.id
                      ? t("marketplace.installing")
                      : t("marketplace.install")}
                  </button>
                ) : locked ? (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => navigate("/admin/license")}>
                    {t("marketplace.activateToInstall")}
                  </button>
                ) : (
                  <button type="button" className="btn-ghost btn-sm">
                    {t("marketplace.buy")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Core's one pagination bar. It renders nothing at a single page, so a
          small catalogue looks exactly as it did before. */}
      {market?.meta && (
        <Pager
          page={market.meta.page}
          totalPages={market.meta.totalPages}
          onPage={setPage}
          label={t("marketplace.pagination", {
            page: market.meta.page, totalPages: market.meta.totalPages, total: market.meta.total,
          })}
          style={{ borderTop: "none" }}
        />
      )}
    </div>
  );
}

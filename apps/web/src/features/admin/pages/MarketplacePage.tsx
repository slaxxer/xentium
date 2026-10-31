import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faEnvelope, faMagnifyingGlass,
  faChartBar, faShield, faKey, faCheck,
  faFlask, faPuzzlePiece, faShieldHalved, faPalette, faImage, faTriangleExclamation, faEye,
  faDownload, faCircleNotch, faChevronDown, faChevronUp, faArrowUpRightFromSquare,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { Pager } from "../../../components/Pager";
import { runStreamedJob } from "../../../lib/streamProgress";
import { slotRegistry } from "../../../plugins/slotRegistry";
import { themeGaps } from "../../../layout/themeFootprint";
import { themeInstallMessage } from "../hooks/themeInstallResult";
import { offerThemeSwitch, outcomeFromStream } from "../hooks/themeSwitchPrompt";
import { ThemePreview } from "../components/ThemePreview";
import { openPanelDialog } from "../../../lib/dialog";
import { ExtensionsUpdateBanner } from "../components/ExtensionsUpdateBanner";
import { Button } from "../../../components/AcpControls";
import { bundledIcon } from "../../../lib/iconCatalogue";
import { parseIconToken } from "@xentium/contracts";
import "./MarketplacePage.scss";

type ProductKind = "plugin" | "theme";
type Filter = "all" | "enabled" | "available" | "free";
const FILTERS: Filter[] = ["all", "enabled", "available", "free"];
/** What a card's footer offers, in one word. */
type CardState = "enabled" | "installed" | "installable" | "busy" | "connect" | "buy" | "unreleased";

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
  /** The listing's icon-picker name and tint, as the store shows them. */
  icon?:             string | null;
  accentColor?:      string | null;
  /** Its page in the store, for "Buy". */
  storeUrl?:         string;
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

/** The listing's own icon when this site can draw it, else what the plugin registered. */
function listingIcon(p: { id: string; kind: ProductKind; icon?: string | null }): IconDefinition {
  const token = p.icon ? parseIconToken(p.icon) : null;
  return (token && bundledIcon(token.name)) ?? (p.kind === "theme" ? faPalette : getPluginIcon(p.id));
}

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
  // `?kind=theme` opens on themes — the Themes page links here for more of them.
  const [kind, setKind] = useState<ProductKind>(() =>
    new URLSearchParams(window.location.search).get("kind") === "theme" ? "theme" : "plugin");

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

  // "Activate" on a card whose plugin is installed but switched off: the same call
  // as the switch on the Installed page (it asks for a code when the site wants one).
  const enableMutation = useMutation({
    mutationFn: (p: MarketplacePlugin) => api.post(`/plugins/${encodeURIComponent(p.id)}/enable`, {}),
    onSuccess: (_r, p) => {
      toast.success(t("marketplace.enabledToast", { name: p.name }));
      void queryClient.invalidateQueries({ queryKey: ["acp-installed-plugins"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const [filter, setFilter] = useState<Filter>("all");
  const [showGrants, setShowGrants] = useState(false);

  // A page of 100: the status filters and their counts work on what was fetched, so
  // a page has to hold the catalogue (it does, by a wide margin). The pager stays for
  // the day it does not.
  const { data: market }    = useQuery<MarketplaceResponse>({
    queryKey: ["acp-marketplace", kind, page, debouncedSearch],
    queryFn:  () => api.get(`/admin/marketplace/plugins?kind=${kind}&page=${page}&limit=100${debouncedSearch ? `&q=${encodeURIComponent(debouncedSearch)}` : ""}`),
    placeholderData: (prev) => prev,
  });
  // How many of each kind, for the tabs. One row each: only `meta.total` is read.
  const { data: kindTotals } = useQuery({
    queryKey: ["acp-marketplace-totals"],
    queryFn: async () => {
      const [pl, th] = await Promise.all((["plugin", "theme"] as const).map((k) =>
        api.get<MarketplaceResponse>(`/admin/marketplace/plugins?kind=${k}&limit=1`)));
      return { plugin: pl?.meta.total ?? 0, theme: th?.meta.total ?? 0 };
    },
    staleTime: 60_000,
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

  // No client-side SEARCH: the server already answered this exact query. The old
  // in-memory search covered only the fetched page, so a plugin on page 2 reported
  // "no results" for its own name. The status filters below are client-side and
  // count what was fetched (a page holds the whole catalogue, see the query).
  const listings = market?.data ?? [];

  const model = (p: MarketplacePlugin) => {
    const isTheme = p.kind === "theme";
    // A site wears one theme, so "installed" is an identity check against the one
    // manifest, not a lookup in the plugin map, which has no theme in it.
    const instStatus = isTheme ? (theme?.manifest?.id === p.id ? "enabled" : undefined) : installedMap[p.id];
    // Ownership from the marketplace wins when it answered; the local entitlement
    // JWT is the offline fallback (a plugin bought two minutes ago is owned but not
    // yet signed). ⚠ Keyed `<kind>.<id>`: hardcoding `plugin.` made every owned
    // THEME read as unowned whenever the catalogue did not answer `owned`.
    const entitled = p.owned ?? entitlements.includes(`${p.kind}.${p.id}`);
    const paid = p.licenseRequired && p.priceCents > 0;
    // A free plugin needs no entitlement: gating it offered "Buy" for something
    // that costs nothing and installs fine.
    const installable = (entitled || !p.licenseRequired) && !!p.latestVersion;
    const busy = installMutation.isPending && installMutation.variables?.id === p.id;
    const state: CardState =
        instStatus === "enabled" ? "enabled"
      : instStatus ? "installed"
      : busy ? "busy"
      : installable ? "installable"
      : !p.latestVersion ? "unreleased"
      : !conn?.connected ? "connect"
      : "buy";
    return { ...p, isTheme, instStatus, entitled, paid, state, free: !p.licenseRequired || p.priceCents === 0 };
  };
  const all = listings.map(model);
  const matches = (c: ReturnType<typeof model>, f: Filter) =>
    f === "all" || (f === "enabled" && c.state === "enabled") || (f === "available" && c.state !== "enabled") || (f === "free" && c.free);
  const cards = all.filter((c) => matches(c, filter));

  // The licence strip: how many of this kind's paid listings the site may install,
  // and which ones (by name where the catalogue knows it).
  const paidHere = all.filter((c) => c.paid);
  const licensedHere = paidHere.filter((c) => c.entitled).length;
  const nameOf = Object.fromEntries(all.map((c) => [`${c.kind}.${c.id}`, c.name]));
  const grants = entitlements.map((id) => nameOf[id] ?? id.replace(/^(plugin|theme)\./, ""));

  const price = (cents: number) => `$${(cents / 100).toFixed(0)}`;

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.extensions")}</div>
          <h1 className="acp-page-title">{t("nav.marketplace")}</h1>
          <p className="mkt-lede">{t("marketplace.lede")}</p>
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

      {/* Licence strip: the state, how much of this half of the catalogue it covers,
          and (folded away) exactly what it grants. */}
      <section className={`mkt-lic${license ? "" : " is-off"}`}>
        <div className="mkt-lic__row">
          <div className="mkt-lic__icon"><FontAwesomeIcon icon={faKey} /></div>
          <div className="mkt-lic__text">
            <div className="mkt-lic__title"><span className="mkt-lic__dot" />{t(license ? "marketplace.licenseActive" : "marketplace.noLicense")}</div>
            <div className="mkt-lic__sub">
              {!license ? t("marketplace.activateHint")
                : paidHere.length ? t(`marketplace.licensedSummary.${kind}`, { owned: licensedHere, total: paidHere.length })
                : t("marketplace.noEntitlements")}
            </div>
          </div>
          {license && grants.length > 0 && (
            <Button variant="ghost" className="mkt-lic__toggle" aria-expanded={showGrants} onClick={() => setShowGrants((v) => !v)}>
              {t(showGrants ? "marketplace.hideEntitlements" : "marketplace.showEntitlements")}
              <FontAwesomeIcon icon={showGrants ? faChevronUp : faChevronDown} />
            </Button>
          )}
          <Button variant="ghost" onClick={() => navigate("/admin/license")}>
            {license ? t("marketplace.manage") : t("marketplace.activate")}
          </Button>
        </div>
        {license && showGrants && grants.length > 0 && (
          <div className="mkt-lic__chips">
            {grants.map((g) => <span key={g} className="mkt-lic__chip"><FontAwesomeIcon icon={faCheck} />{g}</span>)}
          </div>
        )}
      </section>

      {/* One toolbar: which half of the catalogue, a server-side search, and the
          status filters with what each would show. */}
      <div className="mkt-bar">
        <div className="mkt-kinds" role="tablist" aria-label={t("marketplace.kindsLabel")}>
          {(["plugin", "theme"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>
              <FontAwesomeIcon icon={k === "theme" ? faPalette : faPuzzlePiece} />
              {t(`marketplace.tab.${k}`)}
              {kindTotals && <span className="mkt-kinds__n">{kindTotals[k]}</span>}
            </button>
          ))}
        </div>
        <label className="mkt-search">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="mkt-search__ic" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(kind === "theme" ? "marketplace.searchThemesPlaceholder" : "marketplace.searchPlaceholder")}
            aria-label={t(kind === "theme" ? "marketplace.searchThemesPlaceholder" : "marketplace.searchPlaceholder")}
          />
        </label>
        <span className="mkt-bar__grow" />
        <div className="mkt-filters" role="tablist" aria-label={t("marketplace.filterLabel")}>
          {FILTERS.map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "is-on" : ""} onClick={() => setFilter(f)}>
              {t(`marketplace.filter.${f}`)}<span className="mkt-filters__n">{all.filter((c) => matches(c, f)).length}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Said once above the grid rather than on every card: installing a theme
          applies it immediately, and the admin has somewhere to go to manage it. */}
      {kind === "theme" && (
        <p className="mkt-note">
          {t("marketplace.themeDraftNote")}{" "}
          <button type="button" onClick={() => navigate("/admin/themes")}>{t("marketplace.themeGoManage")}</button>
        </p>
      )}

      {market && !cards.length ? (
        <div className="mkt-empty">
          <FontAwesomeIcon icon={faMagnifyingGlass} />
          <span className="mkt-empty__title">{t("marketplace.emptyTitle")}</span>
          <span>{t("marketplace.emptyHint")}</span>
        </div>
      ) : (
        <div className="mkt-grid">
          {cards.map((c) => {
            // Only a theme carries a footprint; `themeGaps` answers null for anything
            // without one, including a theme listed before footprints existed.
            const gaps = c.isTheme ? themeGaps(c) : null;
            const tint = c.accentColor ?? (c.isTheme ? undefined : getPluginColor(c.id));
            return (
              <article key={c.id} className="mkt-card" style={tint ? ({ "--mkt-tint": tint } as React.CSSProperties) : undefined}>
                {/* A theme is bought for how it looks, so its screenshot leads the
                    card; one whose package shipped none gets a plain placeholder. */}
                {c.isTheme && (c.screenshot
                  ? <img className="mkt-card__shot" src={c.screenshot} alt="" loading="lazy" />
                  : <div className="mkt-card__shot is-empty"><FontAwesomeIcon icon={faImage} /></div>)}

                <div className="mkt-card__head">
                  <div className="mkt-card__icon"><FontAwesomeIcon icon={listingIcon(c)} /></div>
                  <div className="mkt-card__titles">
                    <div className="mkt-card__name">{c.name}</div>
                    {/* How hard we looked is part of what a buyer decides on; a theme
                        has no code for us to have looked at. */}
                    {!c.isTheme && c.trustTier && (
                      <div className={`mkt-card__trust is-${c.trustTier}`}>
                        <FontAwesomeIcon icon={faShieldHalved} />{t(`trust.tier.${c.trustTier}`)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mkt-card__desc">{c.description}</div>

                {/* Before the money: a theme's missing pieces are part of what it
                    costs, and a warning after the purchase is not a warning. */}
                {gaps && (
                  <div className="mkt-card__gaps">
                    <FontAwesomeIcon icon={faTriangleExclamation} />
                    <div>
                      <b>{t("marketplace.themeGapsTitle", { count: gaps.blocks.length + gaps.templates.length })}</b>
                      <span>{[...gaps.templates, ...gaps.blocks].join(", ")}</span>
                      <span>{t("marketplace.themeGapsHint")}</span>
                    </div>
                  </div>
                )}

                <div className="mkt-card__foot">
                  <div className="mkt-card__price">
                    {c.free ? <span className="mkt-card__label">{t("marketplace.free")}</span>
                      : c.entitled ? <><span className="mkt-card__label">{t("marketplace.licensed")}</span><span className="mkt-card__small">{price(c.priceCents)}{t("marketplace.perYear")}</span></>
                      : <span className="mkt-card__amount">{price(c.priceCents)}<span className="mkt-card__per">{t("marketplace.perYear")}</span></span>}
                  </div>
                  <div className="mkt-card__actions">
                    {/* Beside the install action, never instead of it: installing a
                        theme restages every page, and there is no undo. */}
                    {c.isTheme && c.previewUrlBase && c.previewTemplates?.length ? (
                      <Button variant="ghost" icon={faEye} onClick={() => void openPanelDialog({
                        kind: "alert", icon: "info",
                        title: t("marketplace.previewTitle", { name: c.name }),
                        confirmText: t("marketplace.previewClose"),
                        bodyNode: <ThemePreview name={c.name} base={c.previewUrlBase!} templates={c.previewTemplates!} />,
                      })}>{t("marketplace.preview")}</Button>
                    ) : null}
                    {c.state === "enabled" ? (
                      // For a theme this says it is the one being worn: a theme has
                      // no enabled state of its own.
                      <span className="mkt-card__state"><FontAwesomeIcon icon={faCheck} />{t(c.isTheme ? "marketplace.themeActive" : "marketplace.enabled")}</span>
                    ) : c.state === "installed" ? (
                      c.instStatus === "disabled"
                        ? <Button disabled={enableMutation.isPending} onClick={() => enableMutation.mutate(c)}>
                            {enableMutation.isPending && enableMutation.variables?.id === c.id ? t("marketplace.enabling") : t("marketplace.enable")}
                          </Button>
                        : <Button variant="ghost" onClick={() => navigate("/admin/installed")}>{t("marketplace.goManage")}</Button>
                    ) : c.state === "busy" ? (
                      <span className="mkt-card__busy"><FontAwesomeIcon icon={faCircleNotch} spin />{t("marketplace.installing")}</span>
                    ) : c.state === "installable" ? (
                      <Button variant="ghost" className="mkt-install" icon={faDownload} disabled={installMutation.isPending} onClick={() => installMutation.mutate(c)}>
                        {t("marketplace.install")}
                      </Button>
                    ) : c.state === "connect" ? (
                      <Button variant="ghost" onClick={() => navigate("/admin/license")}>{t("marketplace.activateToInstall")}</Button>
                    ) : c.state === "buy" ? (
                      <Button icon={faArrowUpRightFromSquare} disabled={!c.storeUrl}
                        onClick={() => c.storeUrl && window.open(c.storeUrl, "_blank", "noopener")}>
                        {t("marketplace.buy")}
                      </Button>
                    ) : (
                      <span className="mkt-card__muted">{t("marketplace.unreleased")}</span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Core's one pagination bar. It renders nothing at a single page. */}
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

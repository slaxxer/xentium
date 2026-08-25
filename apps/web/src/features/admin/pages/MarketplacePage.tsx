import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faEnvelope, faMagnifyingGlass,
  faChartBar, faShield, faKey, faCheck, faLock,
  faFlask, faPuzzlePiece, faShieldHalved,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { api } from "../../../lib/api";
import { Pager } from "../../../components/Pager";
import { runStreamedJob } from "../../../lib/streamProgress";
import { slotRegistry } from "../../../plugins/slotRegistry";
import { ExtensionsUpdateBanner } from "../components/ExtensionsUpdateBanner";

interface MarketplacePlugin {
  id:              string;
  name:            string;
  description:     string;
  priceCents:      number;
  /** Null when the listing exists but nothing has been published yet. */
  latestVersion:   string | null;
  vendor:          string;
  licenseRequired: boolean;
  /** The marketplace's answer, present when an account is connected. It knows
   *  about a purchase made a minute ago; the entitlement JWT only refreshes
   *  daily, so it does not. */
  owned?:          boolean;
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

interface License {
  entitlementJwt: string;
}

// Fallback icon/color map for plugins that don't register web metadata
const ICON_MAP_FALLBACK: Record<string, IconDefinition> = {
  "nodevo-messaging":    faEnvelope,
  "nodevo-seo-tools":    faMagnifyingGlass,
  "nodevo-analytics":    faChartBar,
  "nodevo-advanced-mod": faShieldHalved,
  "nodevo-2fa":          faShield,
};

const COLOR_MAP_FALLBACK: Record<string, string> = {
  "nodevo-messaging":    "var(--c-success)",
  "nodevo-seo-tools":    "#f472b6",
  "nodevo-analytics":    "#38bdf8",
  "nodevo-advanced-mod": "var(--c-danger)",
  "nodevo-2fa":          "var(--c-warn)",
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

  // The catalogue searches server-side, so the term belongs in the request, not
  // in a filter over what happened to arrive. Debounced so typing does not fire
  // a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  // A new term restarts at page 1 — staying on page 3 of the previous result
  // set shows an empty grid and looks like "no matches".
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  // Direct install (§16.2): the server authorizes at the chokepoint, fetches +
  // sha256-verifies the artifact, and runs the normal intake. Lands disabled.
  // Progress streams as ndjson and drives a dialog — the same contract the
  // Updates page uses — so a multi-megabyte download shows real byte progress
  // instead of the button sitting silent until a toast appears at the end.
  const installMutation = useMutation({
    mutationFn: async (p: MarketplacePlugin) => {
      const { ok } = await runStreamedJob(
        "/admin/marketplace/install",
        { pluginId: p.id, version: p.latestVersion },
        {
          icon:         "update",
          title:        t("marketplace.progressTitle", { name: p.name }),
          startMessage: t("marketplace.phase.starting"),
          phaseLabel:   (phase, message) => {
            const label = t(`marketplace.phase.${phase}`, { defaultValue: t("marketplace.phase.working") });
            return message ? `${label} ${message}` : label;
          },
          successMessage: () => t("marketplace.progressDone", { name: p.name }),
          failureMessage: (final, err) =>
            (final?.message as string) ??
            (err instanceof Error ? err.message : t("marketplace.progressFailed")),
        },
      );
      if (!ok) throw new Error("install_failed");   // keeps isPending/isError honest
      return ok;
    },
    onSuccess: () => {
      // The dialog already reported the outcome; no toast on top of it.
      void queryClient.invalidateQueries({ queryKey: ["acp-installed-plugins"] });
      void queryClient.invalidateQueries({ queryKey: ["acp-marketplace-updates"] });
    },
    // Failure is shown in the dialog too, so nothing to add here.
    onError: () => {},
  });

  const { data: market }    = useQuery<MarketplaceResponse>({
    queryKey: ["acp-marketplace", page, debouncedSearch],
    queryFn:  () => api.get(`/admin/marketplace/plugins?page=${page}${debouncedSearch ? `&q=${encodeURIComponent(debouncedSearch)}` : ""}`),
    placeholderData: (prev) => prev,
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
        <div style={{ background:"color-mix(in srgb, var(--c-warn) 12%, transparent)", border:"1px solid color-mix(in srgb, var(--c-warn) 30%, transparent)", borderRadius:"var(--radius-md)", padding:"12px 18px", marginBottom:20, display:"flex", alignItems:"center", gap:10, fontSize:13, color:"var(--c-warn)" }}>
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
        <FontAwesomeIcon icon={faKey} style={{ fontSize:18, color: license ? "var(--c-accent)" : "var(--c-fg-muted)" }} />
        <div style={{ flex:1 }}>
          {license ? (
            <>
              <div style={{ fontSize:14, fontWeight:700, color:"var(--c-fg)" }}>{t("marketplace.licenseActive")}</div>
              <div style={{ fontSize:13, color:"var(--c-fg-muted)" }}>
                {entitlements.length ? t("marketplace.entitlementsList", { list: entitlements.map((e) => e.replace("plugin.", "")).join(", ") }) : t("marketplace.noEntitlements")}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize:14, fontWeight:700, color:"var(--c-fg)" }}>{t("marketplace.noLicense")}</div>
              <div style={{ fontSize:13, color:"var(--c-fg-muted)" }}>{t("marketplace.activateHint")}</div>
            </>
          )}
        </div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => navigate("/admin/license")}>
          {license ? t("marketplace.manage") : t("marketplace.activate")}
        </button>
      </div>

      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <input
          className="acp-input"
          placeholder={t("marketplace.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width:280 }}
        />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))", gap:16 }}>
        {plugins.map((p) => {
          const icon      = getPluginIcon(p.id);
          const color     = getPluginColor(p.id);
          const instStatus = installedMap[p.id];
          // Ownership from the marketplace wins when it answered; the local
          // entitlement JWT is the offline fallback. A plugin bought two
          // minutes ago is owned but not yet in any entitlement.
          const entitled  = p.owned ?? entitlements.includes(`plugin.${p.id}`);
          const locked    = p.licenseRequired && !entitled;
          // A free plugin needs no entitlement — gating it behind one offered
          // "Buy" for something that costs nothing and installs fine.
          const installable = (entitled || !p.licenseRequired) && !!p.latestVersion;

          return (
            <div key={p.id} className="acp-card" style={{ padding:22, position:"relative", opacity: locked ? 0.8 : 1 }}>
              {locked && (
                <div style={{ position:"absolute", top:14, right:14 }}>
                  <FontAwesomeIcon icon={faLock} style={{ color:"var(--c-fg-muted)", fontSize:14 }} />
                </div>
              )}
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:12 }}>
                <div style={{ width:44, height:44, background:`${color}15`, border:`1px solid ${color}30`, borderRadius:"var(--radius-md)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, color }}>
                  <FontAwesomeIcon icon={icon} />
                </div>
                <div style={{ fontSize:18, fontWeight:800, color:"var(--c-fg)", textAlign:"right" }}>
                  {p.priceCents === 0 ? t("marketplace.free") : `$${(p.priceCents / 100).toFixed(0)}`}
                  {p.priceCents > 0 && <span style={{ fontSize:12, fontWeight:400, color:"var(--c-fg-muted)" }}>{t("marketplace.perYear")}</span>}
                </div>
              </div>

              <div style={{ fontSize:15, fontWeight:800, color:"var(--c-fg)", marginBottom:6 }}>{p.name}</div>
              <div style={{ fontSize:13, color:"var(--c-fg-muted)", lineHeight:1.6, marginBottom:16 }}>{p.description}</div>

              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {instStatus === "enabled" ? (
                  <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:100, fontSize:11, fontWeight:700, background:"color-mix(in srgb, var(--c-success) 15%, transparent)", color:"var(--c-success)" }}>
                    <FontAwesomeIcon icon={faCheck} /> {t("marketplace.enabled")}
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

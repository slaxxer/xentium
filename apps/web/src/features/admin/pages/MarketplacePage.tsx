import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faEnvelope, faMagnifyingGlass,
  faChartBar, faShield, faKey, faCheck, faLock,
  faFlask, faPuzzlePiece, faShieldHalved,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { api } from "../../../lib/api";
import { slotRegistry } from "../../../plugins/slotRegistry";

interface MarketplacePlugin {
  id:              string;
  name:            string;
  description:     string;
  priceCents:      number;
  latestVersion:   string;
  vendor:          string;
  licenseRequired: boolean;
}

// PaginatedResponse<MarketplaceListing> (ADR 0001)
interface MarketplaceResponse {
  data: MarketplacePlugin[];
  meta: { total: number };
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

function parseEntitlements(jwt: string): string[] {
  try { return (JSON.parse(atob(jwt.split(".")[1]!)) as any).entitlements ?? []; }
  catch { return []; }
}

export function MarketplacePage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data: market }    = useQuery<MarketplaceResponse>({ queryKey: ["acp-marketplace"], queryFn: () => api.get("/admin/marketplace/plugins") });
  const { data: installed } = useQuery<InstalledPlugin[]>({ queryKey: ["acp-installed-plugins"], queryFn: () => api.get("/plugins") });
  const { data: license }   = useQuery<License | null>({ queryKey: ["acp-license"], queryFn: () => api.get("/admin/license") });
  const { data: conn }      = useQuery<MarketplaceConnection>({ queryKey: ["acp-marketplace-connection"], queryFn: () => api.get("/admin/marketplace/connection") });

  const entitlements = license ? parseEntitlements(license.entitlementJwt) : [];
  const installedMap = Object.fromEntries((installed ?? []).map((p) => [p.id, p.status]));

  const plugins = (market?.data ?? []).filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">Extensions</div>
          <h1 className="acp-page-title">Marketplace</h1>
        </div>
      </div>

      {/* Account connection notice (ADR 0001) */}
      {!conn?.connected && (
        <div style={{ background:"color-mix(in srgb, var(--c-warn) 12%, transparent)", border:"1px solid color-mix(in srgb, var(--c-warn) 30%, transparent)", borderRadius:"var(--radius-md)", padding:"12px 18px", marginBottom:20, display:"flex", alignItems:"center", gap:10, fontSize:13, color:"var(--c-warn)" }}>
          <FontAwesomeIcon icon={faFlask} />
          <span>No marketplace account connected. Connect on the <button type="button" onClick={() => navigate("/admin/license")} style={{ background:"none", border:"none", padding:0, color:"inherit", fontWeight:700, textDecoration:"underline", cursor:"pointer" }}>License</button> page to install licensed plugins.</span>
        </div>
      )}

      {/* License banner */}
      <div style={{ background: license ? "var(--c-accent-soft)" : "var(--c-surface)", border:`1px solid ${license ? "var(--c-accent-glow)" : "var(--c-border)"}`, borderRadius:"var(--radius-md)", padding:"14px 20px", marginBottom:24, display:"flex", alignItems:"center", gap:12 }}>
        <FontAwesomeIcon icon={faKey} style={{ fontSize:18, color: license ? "var(--c-accent)" : "var(--c-fg-muted)" }} />
        <div style={{ flex:1 }}>
          {license ? (
            <>
              <div style={{ fontSize:14, fontWeight:700, color:"var(--c-fg)" }}>License Active</div>
              <div style={{ fontSize:13, color:"var(--c-fg-muted)" }}>
                {entitlements.length ? `Entitlements: ${entitlements.map((e) => e.replace("plugin.", "")).join(", ")}` : "No entitlements"}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize:14, fontWeight:700, color:"var(--c-fg)" }}>No active license</div>
              <div style={{ fontSize:13, color:"var(--c-fg-muted)" }}>Activate a license to unlock official plugins.</div>
            </>
          )}
        </div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => navigate("/admin/license")}>
          {license ? "Manage License" : "Activate License"}
        </button>
      </div>

      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <input
          className="acp-input"
          placeholder="Search plugins…"
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
          const entitled  = entitlements.includes(`plugin.${p.id}`);
          const locked    = p.licenseRequired && !entitled;

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
                  {p.priceCents === 0 ? "Free" : `$${(p.priceCents / 100).toFixed(0)}`}
                  {p.priceCents > 0 && <span style={{ fontSize:12, fontWeight:400, color:"var(--c-fg-muted)" }}>/yr</span>}
                </div>
              </div>

              <div style={{ fontSize:15, fontWeight:800, color:"var(--c-fg)", marginBottom:6 }}>{p.name}</div>
              <div style={{ fontSize:13, color:"var(--c-fg-muted)", lineHeight:1.6, marginBottom:16 }}>{p.description}</div>

              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {instStatus === "enabled" ? (
                  <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:100, fontSize:11, fontWeight:700, background:"color-mix(in srgb, var(--c-success) 15%, transparent)", color:"var(--c-success)" }}>
                    <FontAwesomeIcon icon={faCheck} /> Enabled
                  </span>
                ) : instStatus ? (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => navigate("/admin/installed")}>
                    Installed — Go to manage
                  </button>
                ) : entitled ? (
                  <button type="button" className="btn-ghost btn-sm" style={{ color:"var(--c-accent)", borderColor:"var(--c-accent-glow)", background:"var(--c-accent-soft)" }} onClick={() => navigate("/admin/upload")}>
                    Install
                  </button>
                ) : locked ? (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => navigate("/admin/license")}>
                    Activate license to install
                  </button>
                ) : (
                  <button type="button" className="btn-ghost btn-sm">
                    Buy → nodevo.io
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

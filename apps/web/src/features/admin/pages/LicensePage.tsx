import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faKey, faCheck, faRotate, faCircleExclamation, faPlug, faLinkSlash } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { ExtensionsUpdateBanner } from "../components/ExtensionsUpdateBanner";

interface License {
  id:             string;
  licenseKey:     string;
  siteId:         string;
  status:         string;
  domain:         string | null;
  environment:    string | null;
  activatedAt:    string;
  expiresAt:      string | null;
  refreshAfter:   string | null;
  entitlementJwt: string;
}

interface MarketplaceConnection {
  sourceId:    string;
  connected:   boolean;
  accountRef:  string | null;
  connectedAt: string | null;
}

function parseEntitlements(jwt: string): string[] {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]!));
    return payload.entitlements ?? [];
  } catch { return []; }
}

function StatusDot({ color }: { color: string }) {
  return <span style={{ width:8, height:8, borderRadius:"50%", background:color, display:"inline-block", flexShrink:0 }} />;
}

export function LicensePage() {
  const { t } = useTranslation("acp");
  const qc       = useQueryClient();
  const [authCode, setAuthCode] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);

  const { data: license, isLoading } = useQuery<License | null>({
    queryKey: ["acp-license"],
    queryFn:  () => api.get("/admin/license"),
  });

  const { data: conn } = useQuery<MarketplaceConnection>({
    queryKey: ["acp-marketplace-connection"],
    queryFn:  () => api.get("/admin/marketplace/connection"),
  });

  const connectMut = useMutation({
    mutationFn: () => api.post("/admin/marketplace/connection", { authCode: authCode.trim() }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["acp-marketplace-connection"] }); setAuthCode(""); setConnectError(null); swalToast(t("license.toastConnected"), "success"); },
    onError:    (e: any) => setConnectError(e?.data?.message ?? apiErrorMessage(e)),
  });

  const disconnectMut = useMutation({
    mutationFn: () => api.delete("/admin/marketplace/connection"),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ["acp-marketplace-connection"] });
      // Disconnecting deactivates account-activated licenses server-side.
      qc.invalidateQueries({ queryKey: ["acp-license"] });
      swalToast(t("license.toastDisconnected"), "success");
    },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  const handleDisconnect = async () => {
    const ok = await swalConfirm(
      t("license.disconnectTitle"),
      t("license.disconnectText"),
      t("license.disconnect"),
    );
    if (ok) disconnectMut.mutate();
  };

  const refreshMut = useMutation({
    mutationFn: () => api.post("/admin/license/refresh", {}),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["acp-license"] }); swalToast(t("license.toastRefreshed"), "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  const entitlements = license ? parseEntitlements(license.entitlementJwt) : [];

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.extensions")}</div>
          <h1 className="acp-page-title">{t("nav.license")}</h1>
        </div>
      </div>

      <ExtensionsUpdateBanner />

      {/* Marketplace account — the primary, recommended path (ADR 0001) */}
      <div className="acp-card" style={{ padding:"24px", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
          <FontAwesomeIcon icon={faPlug} style={{ color:"var(--c-accent)" }} />
          <div style={{ fontSize:15, fontWeight:800, color:"var(--c-fg)" }}>{t("license.accountTitle")}</div>
          <span style={{ marginLeft:"auto", fontSize:11, fontWeight:700, padding:"2px 9px", borderRadius:100,
            background: conn?.connected ? "color-mix(in srgb, var(--c-success) 15%, transparent)" : "var(--c-surface)",
            color: conn?.connected ? "var(--c-success)" : "var(--c-fg-muted)", border:"1px solid var(--c-border)" }}>
            {conn?.connected ? t("license.connectedBadge") : t("license.notConnectedBadge")}
          </span>
        </div>
        <div style={{ fontSize:13, color:"var(--c-fg-muted)", marginBottom:16 }}>
          {t("license.accountDesc")}
        </div>

        {conn?.connected ? (
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ flex:1, display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div style={{ background:"var(--c-surface)", border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", padding:"12px 14px" }}>
                <div style={{ fontSize:11, color:"var(--c-fg-muted)", marginBottom:3, textTransform:"uppercase", fontWeight:700, letterSpacing:"0.06em" }}>{t("license.fieldAccount")}</div>
                <div style={{ fontSize:13, fontWeight:600, color:"var(--c-fg)", fontFamily:"monospace", wordBreak:"break-all" }}>{conn.accountRef ?? "—"}</div>
              </div>
              <div style={{ background:"var(--c-surface)", border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", padding:"12px 14px" }}>
                <div style={{ fontSize:11, color:"var(--c-fg-muted)", marginBottom:3, textTransform:"uppercase", fontWeight:700, letterSpacing:"0.06em" }}>{t("license.fieldConnected")}</div>
                <div style={{ fontSize:13, fontWeight:600, color:"var(--c-fg)" }}>{conn.connectedAt ? new Date(conn.connectedAt).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }) : "—"}</div>
              </div>
            </div>
            <button type="button" className="btn-danger btn-sm" onClick={handleDisconnect} disabled={disconnectMut.isPending}>
              <FontAwesomeIcon icon={faLinkSlash} style={{ marginRight:5 }} /> {t("license.disconnect")}
            </button>
          </div>
        ) : (
          <>
            <div style={{ display:"flex", gap:10, marginBottom: connectError ? 10 : 0 }}>
              <input
                className="acp-input"
                value={authCode}
                onChange={(e) => { setAuthCode(e.target.value); setConnectError(null); }}
                placeholder={t("license.authPlaceholder")}
                style={{ flex:1 }}
                onKeyDown={(e) => { if (e.key === "Enter" && authCode.trim()) connectMut.mutate(); }}
              />
              <button type="button" className="btn-primary btn-sm" disabled={!authCode.trim() || connectMut.isPending} onClick={() => connectMut.mutate()}>
                <FontAwesomeIcon icon={faPlug} style={{ marginRight:5 }} />
                {connectMut.isPending ? t("license.connecting") : t("license.connect")}
              </button>
            </div>
            {connectError && (
              <div style={{ padding:"10px 14px", background:"color-mix(in srgb, var(--c-danger) 10%, transparent)", border:"1px solid color-mix(in srgb, var(--c-danger) 30%, transparent)", borderRadius:"var(--radius-sm)", fontSize:13, color:"var(--c-danger)", display:"flex", gap:8, alignItems:"flex-start" }}>
                <FontAwesomeIcon icon={faCircleExclamation} style={{ marginTop:2, flexShrink:0 }} />
                {connectError}
              </div>
            )}
          </>
        )}
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">{t("license.loading")}</div>
      ) : license ? (
        <div className="acp-card" style={{ padding:"24px", marginBottom:20 }}>
          <div style={{ fontSize:16, fontWeight:800, color:"var(--c-fg)", marginBottom:8 }}>{t("license.activeTitle")}</div>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
            <StatusDot color={license.status === "active" ? "var(--c-success)" : "var(--c-warn)"} />
            <span style={{ fontSize:14, color: license.status === "active" ? "var(--c-success)" : "var(--c-warn)", fontWeight:600 }}>
              {license.status === "active" ? t("license.statusActive") : license.status}
              {license.expiresAt ? ` ${t("license.expires", { date: new Date(license.expiresAt).toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" }) })}` : ""}
            </span>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
            {([
              [t("license.fieldKey"),         license.licenseKey],
              [t("license.fieldSiteId"),      license.siteId],
              [t("license.fieldDomain"),      license.domain ?? "—"],
              [t("license.fieldEnvironment"), license.environment ?? "—"],
              [t("license.fieldActivated"),   new Date(license.activatedAt).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })],
              [t("license.fieldRefreshAfter"), license.refreshAfter ? new Date(license.refreshAfter).toLocaleDateString() : "—"],
            ] as [string, string][]).map(([l, v]) => (
              <div key={l} style={{ background:"var(--c-surface)", border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", padding:"12px 14px" }}>
                <div style={{ fontSize:11, color:"var(--c-fg-muted)", marginBottom:3, textTransform:"uppercase", fontWeight:700, letterSpacing:"0.06em" }}>{l}</div>
                <div style={{ fontSize:13, fontWeight:600, color:"var(--c-fg)", fontFamily:"monospace", wordBreak:"break-all" }}>{v}</div>
              </div>
            ))}
          </div>

          {entitlements.length > 0 && (
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"var(--c-fg-muted)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>{t("license.entitlements")}</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {entitlements.map((e) => (
                  <span key={e} style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:100, fontSize:11, fontWeight:700, background:"color-mix(in srgb, var(--c-success) 15%, transparent)", color:"var(--c-success)" }}>
                    <FontAwesomeIcon icon={faCheck} /> {e.replace("plugin.", "")}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ display:"flex", gap:8 }}>
            <button type="button" className="btn-ghost btn-sm" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
              <FontAwesomeIcon icon={faRotate} style={{ marginRight:5 }} />
              {refreshMut.isPending ? t("license.refreshing") : t("license.refresh")}
            </button>
          </div>
        </div>
      ) : (
        <div className="acp-card" style={{ padding:"24px", marginBottom:20, textAlign:"center" }}>
          <FontAwesomeIcon icon={faKey} style={{ fontSize:28, color:"var(--c-fg-muted)", marginBottom:8 }} />
          <div style={{ fontSize:14, fontWeight:700, color:"var(--c-fg)", marginBottom:4 }}>{t("license.noLicenseTitle")}</div>
          <div style={{ fontSize:13, color:"var(--c-fg-muted)" }}>{t("license.noLicenseHint")}</div>
          {conn?.connected && (
            <button type="button" className="btn-primary btn-sm" style={{ marginTop:14 }} onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
              <FontAwesomeIcon icon={faRotate} style={{ marginRight:5 }} />
              {refreshMut.isPending ? t("license.refreshing") : t("license.activateFromAccount")}
            </button>
          )}
        </div>
      )}

    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faKey, faCheck, faRotate, faTrash, faCircleExclamation, faPlug, faLinkSlash, faGlobe } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";

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
  const qc       = useQueryClient();
  const [key,   setKey]   = useState("");
  const [error, setError] = useState<string | null>(null);
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
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["acp-marketplace-connection"] }); setAuthCode(""); setConnectError(null); swalToast("Marketplace account connected.", "success"); },
    onError:    (e: any) => setConnectError(e?.data?.message ?? apiErrorMessage(e)),
  });

  const disconnectMut = useMutation({
    mutationFn: () => api.delete("/admin/marketplace/connection"),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["acp-marketplace-connection"] }); swalToast("Marketplace account disconnected.", "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  const handleDisconnect = async () => {
    const ok = await swalConfirm(
      "Disconnect marketplace account?",
      "Installed plugins keep running. You'll need to reconnect to install or update licensed plugins.",
      "Disconnect",
    );
    if (ok) disconnectMut.mutate();
  };

  const activateMut = useMutation({
    mutationFn: () => api.post("/admin/license/activate", { licenseKey: key.trim() }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["acp-license"] }); setKey(""); setError(null); swalToast("License activated.", "success"); },
    onError:    (e: any) => setError(e?.data?.message ?? apiErrorMessage(e)),
  });

  const refreshMut = useMutation({
    mutationFn: () => api.post("/admin/license/refresh", {}),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["acp-license"] }); swalToast("Entitlements refreshed.", "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  const deactivateMut = useMutation({
    mutationFn: () => api.delete("/admin/license"),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["acp-license"] }); swalToast("License deactivated.", "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  const handleDeactivate = async () => {
    const ok = await swalConfirm(
      "Deactivate license?",
      "Licensed plugins will continue running but cannot be re-enabled after disabling.",
      "Deactivate",
    );
    if (ok) deactivateMut.mutate();
  };

  const entitlements = license ? parseEntitlements(license.entitlementJwt) : [];

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">Extensions</div>
          <h1 className="acp-page-title">License</h1>
        </div>
      </div>

      {/* Marketplace account — the primary, recommended path (ADR 0001) */}
      <div className="acp-card" style={{ padding:"24px", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
          <FontAwesomeIcon icon={faPlug} style={{ color:"var(--c-accent)" }} />
          <div style={{ fontSize:15, fontWeight:800, color:"var(--c-fg)" }}>Marketplace Account</div>
          <span style={{ marginLeft:"auto", fontSize:11, fontWeight:700, padding:"2px 9px", borderRadius:100,
            background: conn?.connected ? "color-mix(in srgb, var(--c-success) 15%, transparent)" : "var(--c-surface)",
            color: conn?.connected ? "var(--c-success)" : "var(--c-fg-muted)", border:"1px solid var(--c-border)" }}>
            {conn?.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <div style={{ fontSize:13, color:"var(--c-fg-muted)", marginBottom:16 }}>
          Connect your nodevo.io account to install and update licensed plugins. Purchases are bound to this
          site's domain — installs are authorized at download.
        </div>

        {conn?.connected ? (
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ flex:1, display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div style={{ background:"var(--c-surface)", border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", padding:"12px 14px" }}>
                <div style={{ fontSize:11, color:"var(--c-fg-muted)", marginBottom:3, textTransform:"uppercase", fontWeight:700, letterSpacing:"0.06em" }}>Account</div>
                <div style={{ fontSize:13, fontWeight:600, color:"var(--c-fg)", fontFamily:"monospace", wordBreak:"break-all" }}>{conn.accountRef ?? "—"}</div>
              </div>
              <div style={{ background:"var(--c-surface)", border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", padding:"12px 14px" }}>
                <div style={{ fontSize:11, color:"var(--c-fg-muted)", marginBottom:3, textTransform:"uppercase", fontWeight:700, letterSpacing:"0.06em" }}>Connected</div>
                <div style={{ fontSize:13, fontWeight:600, color:"var(--c-fg)" }}>{conn.connectedAt ? new Date(conn.connectedAt).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }) : "—"}</div>
              </div>
            </div>
            <button type="button" className="btn-danger btn-sm" onClick={handleDisconnect} disabled={disconnectMut.isPending}>
              <FontAwesomeIcon icon={faLinkSlash} style={{ marginRight:5 }} /> Disconnect
            </button>
          </div>
        ) : (
          <>
            <div style={{ display:"flex", gap:10, marginBottom: connectError ? 10 : 0 }}>
              <input
                className="acp-input"
                value={authCode}
                onChange={(e) => { setAuthCode(e.target.value); setConnectError(null); }}
                placeholder="Paste your authorization code"
                style={{ flex:1 }}
                onKeyDown={(e) => { if (e.key === "Enter" && authCode.trim()) connectMut.mutate(); }}
              />
              <button type="button" className="btn-primary btn-sm" disabled={!authCode.trim() || connectMut.isPending} onClick={() => connectMut.mutate()}>
                <FontAwesomeIcon icon={faPlug} style={{ marginRight:5 }} />
                {connectMut.isPending ? "Connecting…" : "Connect"}
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
        <div className="acp-card acp-empty">Loading…</div>
      ) : license ? (
        <div className="acp-card" style={{ padding:"24px", marginBottom:20 }}>
          <div style={{ fontSize:16, fontWeight:800, color:"var(--c-fg)", marginBottom:8 }}>Active License</div>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
            <StatusDot color={license.status === "active" ? "var(--c-success)" : "var(--c-warn)"} />
            <span style={{ fontSize:14, color: license.status === "active" ? "var(--c-success)" : "var(--c-warn)", fontWeight:600 }}>
              {license.status === "active" ? "Active" : license.status}
              {license.expiresAt ? ` · Expires ${new Date(license.expiresAt).toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" })}` : ""}
            </span>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
            {([
              ["License key", license.licenseKey],
              ["Site ID",     license.siteId],
              ["Domain",      license.domain ?? "—"],
              ["Environment", license.environment ?? "—"],
              ["Activated",   new Date(license.activatedAt).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })],
              ["Refresh after", license.refreshAfter ? new Date(license.refreshAfter).toLocaleDateString() : "—"],
            ] as [string, string][]).map(([l, v]) => (
              <div key={l} style={{ background:"var(--c-surface)", border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", padding:"12px 14px" }}>
                <div style={{ fontSize:11, color:"var(--c-fg-muted)", marginBottom:3, textTransform:"uppercase", fontWeight:700, letterSpacing:"0.06em" }}>{l}</div>
                <div style={{ fontSize:13, fontWeight:600, color:"var(--c-fg)", fontFamily:"monospace", wordBreak:"break-all" }}>{v}</div>
              </div>
            ))}
          </div>

          {entitlements.length > 0 && (
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"var(--c-fg-muted)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Entitlements</div>
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
              {refreshMut.isPending ? "Refreshing…" : "Refresh entitlements"}
            </button>
            <button type="button" className="btn-danger btn-sm" onClick={handleDeactivate} disabled={deactivateMut.isPending}>
              <FontAwesomeIcon icon={faTrash} style={{ marginRight:5 }} /> Deactivate
            </button>
          </div>
        </div>
      ) : (
        <div className="acp-card" style={{ padding:"24px", marginBottom:20, textAlign:"center" }}>
          <FontAwesomeIcon icon={faKey} style={{ fontSize:28, color:"var(--c-fg-muted)", marginBottom:8 }} />
          <div style={{ fontSize:14, fontWeight:700, color:"var(--c-fg)", marginBottom:4 }}>No active license</div>
          <div style={{ fontSize:13, color:"var(--c-fg-muted)" }}>Enter a license key below to activate.</div>
        </div>
      )}

      {/* Manual key — offline / fallback activation (ADR 0001) */}
      <div className="acp-card" style={{ padding:"24px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
          <FontAwesomeIcon icon={faGlobe} style={{ color:"var(--c-fg-muted)", fontSize:13 }} />
          <div style={{ fontSize:15, fontWeight:800, color:"var(--c-fg)" }}>
            {license ? "Add / Replace License Key" : "Offline activation (license key)"}
          </div>
        </div>
        <div style={{ fontSize:13, color:"var(--c-fg-muted)", marginBottom:16 }}>
          Fallback for air-gapped installs — connecting your account above is the recommended path.
          Purchase a license at nodevo.io, then enter the key below.
        </div>
        <div style={{ display:"flex", gap:10, marginBottom: error ? 10 : 0 }}>
          <input
            className="acp-input"
            value={key}
            onChange={(e) => { setKey(e.target.value); setError(null); }}
            placeholder="NDV-XXXX-XXXX-XXXX"
            style={{ fontFamily:"monospace", letterSpacing:"0.05em", flex:1 }}
            onKeyDown={(e) => { if (e.key === "Enter" && key.trim()) activateMut.mutate(); }}
          />
          <button type="button" className="btn-primary btn-sm" disabled={!key.trim() || activateMut.isPending} onClick={() => activateMut.mutate()}>
            <FontAwesomeIcon icon={faKey} style={{ marginRight:5 }} />
            {activateMut.isPending ? "Activating…" : "Activate"}
          </button>
        </div>
        {error && (
          <div style={{ padding:"10px 14px", background:"color-mix(in srgb, var(--c-danger) 10%, transparent)", border:"1px solid color-mix(in srgb, var(--c-danger) 30%, transparent)", borderRadius:"var(--radius-sm)", fontSize:13, color:"var(--c-danger)", display:"flex", gap:8, alignItems:"flex-start" }}>
            <FontAwesomeIcon icon={faCircleExclamation} style={{ marginTop:2, flexShrink:0 }} />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

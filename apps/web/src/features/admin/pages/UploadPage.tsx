import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBox, faFolderOpen, faCheck, faCircleExclamation, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage } from "../../../lib/swal";

const STEP_KEYS = ["upload", "validate", "install"] as const;

interface ValidationResult {
  id:               string;
  name:             string;
  version:          string;
  vendor:           string;
  licenseRequired:  boolean;
  permissions:      string[];
  migrations:       string[];
  alreadyInstalled: boolean;
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  const color = ok ? "var(--c-success)" : "var(--c-danger)";
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid var(--c-border)" }}>
      <span style={{ fontSize:13, color:"var(--c-fg-muted)" }}>{label}</span>
      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
        <span style={{ fontSize:13, color }}>{value}</span>
        <FontAwesomeIcon icon={ok ? faCheck : faCircleExclamation} style={{ color, fontSize:12 }} />
      </div>
    </div>
  );
}

export function UploadPage() {
  const { t } = useTranslation("acp");
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const fileRef   = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file,     setFile]     = useState<File | null>(null);
  const [step,     setStep]     = useState(0);
  const [result,   setResult]   = useState<ValidationResult | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  const validateMut = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      return api.post<ValidationResult>("/plugins/validate", fd);
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      setStep(1);
    },
    onError: (e: any) => {
      setError(e?.data?.message ?? apiErrorMessage(e));
    },
  });

  const installMut = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      return api.post("/plugins/upload", fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-installed-plugins"] });
      setStep(2);
    },
    onError: (e: any) => {
      setError(e?.data?.message ?? apiErrorMessage(e));
      swalToast(e?.data?.message ?? t("upload.installFailed"), "error");
    },
  });

  const handleFile = (f: File) => {
    setFile(f);
    setResult(null);
    setError(null);
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.extensions")}</div>
          <h1 className="acp-page-title">{t("upload.title")}</h1>
        </div>
      </div>

      <div className="acp-card" style={{ padding: 32 }}>
        {/* Step indicators */}
        <div style={{ display:"flex", alignItems:"center", gap:0, marginBottom:28 }}>
          {STEP_KEYS.map((_s, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", flex: i < STEP_KEYS.length - 1 ? 1 : undefined }}>
              <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0, background: i < step ? "var(--c-success)" : i === step ? "var(--c-accent)" : "var(--c-border)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color: i <= step ? "#fff" : "var(--c-fg-muted)" }}>
                {i < step ? <FontAwesomeIcon icon={faCheck} /> : i + 1}
              </div>
              {i < STEP_KEYS.length - 1 && (
                <div style={{ flex:1, height:2, background: i < step ? "var(--c-success)" : "var(--c-border)", margin:"0 6px" }} />
              )}
            </div>
          ))}
        </div>

        {/* Step 0 — Upload */}
        {step === 0 && (
          <div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              onClick={() => fileRef.current?.click()}
              style={{ border:`2px dashed ${dragging ? "var(--c-accent)" : "var(--c-border)"}`, borderRadius:"var(--radius-md)", padding:"48px 32px", textAlign:"center", background: dragging ? "var(--c-accent-soft)" : "transparent", transition:"all 0.2s", marginBottom:20, cursor:"pointer" }}
            >
              <FontAwesomeIcon icon={faBox} style={{ fontSize:36, color:"var(--c-fg-muted)", marginBottom:12, display:"block" }} />
              <div style={{ fontSize:16, fontWeight:700, color:"var(--c-fg)", marginBottom:6 }}>
                {file ? file.name : t("upload.drop")}
              </div>
              <div style={{ fontSize:13, color:"var(--c-fg-muted)", marginBottom:16 }}>{t("upload.orClick")}</div>
              <button type="button" className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
                <FontAwesomeIcon icon={faFolderOpen} style={{ marginRight:5 }} /> {t("upload.browse")}
              </button>
            </div>

            <input ref={fileRef} type="file" accept=".nvplugin,.zip" style={{ display:"none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

            <div style={{ background:"var(--c-surface)", border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", padding:"14px 16px", fontSize:13, color:"var(--c-fg-muted)", marginBottom: file ? 14 : 0 }}>
              <div style={{ fontWeight:700, color:"var(--c-fg-muted)", marginBottom:6 }}>{t("upload.reqTitle")}</div>
              <div>• {t("upload.req1")}</div>
              <div>• {t("upload.req2")}</div>
              <div>• {t("upload.req3")}</div>
              <div>• {t("upload.req4")}</div>
            </div>

            {error && (
              <div style={{ marginTop:12, padding:"12px 14px", background:"color-mix(in srgb, var(--c-danger) 10%, transparent)", border:"1px solid color-mix(in srgb, var(--c-danger) 30%, transparent)", borderRadius:"var(--radius-sm)", fontSize:13, color:"var(--c-danger)", display:"flex", gap:8, alignItems:"flex-start" }}>
                <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginTop:2, flexShrink:0 }} />
                {error}
              </div>
            )}

            {file && (
              <div style={{ marginTop:14 }}>
                <button type="button" className="btn-primary btn-sm" onClick={() => validateMut.mutate(file)} disabled={validateMut.isPending}>
                  {validateMut.isPending ? t("upload.validating") : t("upload.validateBtn")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 1 — Validation results */}
        {step === 1 && result && (
          <div>
            <div style={{ fontWeight:700, color:"var(--c-fg)", marginBottom:16 }}>{t("upload.resultsTitle")}</div>
            <StatusRow label={t("upload.rowId")}          value={result.id}                                  ok={true} />
            <StatusRow label={t("upload.rowName")}        value={`${result.name} v${result.version}`}        ok={true} />
            <StatusRow label={t("upload.rowVendor")}      value={result.vendor}                              ok={true} />
            <StatusRow label={t("upload.rowLicense")}     value={result.licenseRequired ? t("upload.yes") : t("upload.no")} ok={!result.licenseRequired} />
            <StatusRow label={t("upload.rowPermissions")} value={result.permissions.length ? result.permissions.join(", ") : t("upload.none")} ok={true} />
            <StatusRow label={t("upload.rowMigrations")}  value={result.migrations.length ? t("upload.migrationsCount", { count: result.migrations.length }) : t("upload.none")} ok={true} />
            <StatusRow label={t("upload.rowInstalled")}   value={result.alreadyInstalled ? t("upload.yesUpdate") : t("upload.no")} ok={!result.alreadyInstalled} />

            {result.alreadyInstalled && (
              <div style={{ marginTop:12, padding:"10px 14px", background:"color-mix(in srgb, var(--c-warn) 10%, transparent)", border:"1px solid color-mix(in srgb, var(--c-warn) 30%, transparent)", borderRadius:"var(--radius-sm)", fontSize:13, color:"var(--c-warn)" }}>
                {t("upload.alreadyWarning")}
              </div>
            )}

            <div style={{ marginTop:20, display:"flex", gap:8 }}>
              <button type="button" className="btn-primary btn-sm" onClick={() => installMut.mutate()} disabled={installMut.isPending || result.alreadyInstalled}>
                {installMut.isPending ? t("upload.installing") : t("upload.installBtn")}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => { setStep(0); setError(null); }}>{t("upload.back")}</button>
            </div>
          </div>
        )}

        {/* Step 2 — Done */}
        {step === 2 && (
          <div style={{ textAlign:"center", padding:"20px 0" }}>
            <FontAwesomeIcon icon={faCheck} style={{ fontSize:48, color:"var(--c-success)", marginBottom:16 }} />
            <div style={{ fontSize:18, fontWeight:800, color:"var(--c-fg)", marginBottom:8 }}>{t("upload.doneTitle")}</div>
            <p style={{ fontSize:14, color:"var(--c-fg-muted)", marginBottom:24 }}>
              {t("upload.doneText")}
            </p>
            <button type="button" className="btn-primary btn-sm" onClick={() => navigate("/admin/installed")}>
              {t("upload.goInstalled")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

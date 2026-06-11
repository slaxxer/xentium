import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBox, faFolderOpen, faCheck, faCircleExclamation, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage } from "../../../lib/swal";

const STEPS = ["Upload", "Validate", "Install"];

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
      swalToast(e?.data?.message ?? "Installation failed.", "error");
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
          <div className="acp-page-sub">Extensions</div>
          <h1 className="acp-page-title">Upload Plugin</h1>
        </div>
      </div>

      <div className="acp-card" style={{ padding: 32 }}>
        {/* Step indicators */}
        <div style={{ display:"flex", alignItems:"center", gap:0, marginBottom:28 }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", flex: i < STEPS.length - 1 ? 1 : undefined }}>
              <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0, background: i < step ? "var(--c-success)" : i === step ? "var(--c-accent)" : "var(--c-border)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color: i <= step ? "#fff" : "var(--c-fg-muted)" }}>
                {i < step ? <FontAwesomeIcon icon={faCheck} /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
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
                {file ? file.name : "Drop your .nvplugin file here"}
              </div>
              <div style={{ fontSize:13, color:"var(--c-fg-muted)", marginBottom:16 }}>or click to browse</div>
              <button type="button" className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
                <FontAwesomeIcon icon={faFolderOpen} style={{ marginRight:5 }} /> Browse file
              </button>
            </div>

            <input ref={fileRef} type="file" accept=".nvplugin,.zip" style={{ display:"none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

            <div style={{ background:"var(--c-surface)", border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", padding:"14px 16px", fontSize:13, color:"var(--c-fg-muted)", marginBottom: file ? 14 : 0 }}>
              <div style={{ fontWeight:700, color:"var(--c-fg-muted)", marginBottom:6 }}>Requirements</div>
              <div>• File must be a valid .nvplugin package (ZIP)</div>
              <div>• Must include a manifest.json with id, name, version, vendor</div>
              <div>• Migration files must use DDL statements only</div>
              <div>• Every .up.sql must have a matching .down.sql</div>
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
                  {validateMut.isPending ? "Validating…" : "Validate Plugin →"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 1 — Validation results */}
        {step === 1 && result && (
          <div>
            <div style={{ fontWeight:700, color:"var(--c-fg)", marginBottom:16 }}>Validation Results</div>
            <StatusRow label="Plugin ID"          value={result.id}                                  ok={true} />
            <StatusRow label="Name"               value={`${result.name} v${result.version}`}        ok={true} />
            <StatusRow label="Vendor"             value={result.vendor}                              ok={true} />
            <StatusRow label="License required"   value={result.licenseRequired ? "Yes" : "No"}      ok={!result.licenseRequired} />
            <StatusRow label="Permissions"        value={result.permissions.length ? result.permissions.join(", ") : "None"} ok={true} />
            <StatusRow label="Migrations"         value={result.migrations.length ? `${result.migrations.length} migration(s)` : "None"} ok={true} />
            <StatusRow label="Already installed"  value={result.alreadyInstalled ? "Yes — update" : "No"} ok={!result.alreadyInstalled} />

            {result.alreadyInstalled && (
              <div style={{ marginTop:12, padding:"10px 14px", background:"color-mix(in srgb, var(--c-warn) 10%, transparent)", border:"1px solid color-mix(in srgb, var(--c-warn) 30%, transparent)", borderRadius:"var(--radius-sm)", fontSize:13, color:"var(--c-warn)" }}>
                This plugin is already installed. Installing will be rejected — uninstall it first.
              </div>
            )}

            <div style={{ marginTop:20, display:"flex", gap:8 }}>
              <button type="button" className="btn-primary btn-sm" onClick={() => installMut.mutate()} disabled={installMut.isPending || result.alreadyInstalled}>
                {installMut.isPending ? "Installing…" : "Install Plugin"}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => { setStep(0); setError(null); }}>Back</button>
            </div>
          </div>
        )}

        {/* Step 2 — Done */}
        {step === 2 && (
          <div style={{ textAlign:"center", padding:"20px 0" }}>
            <FontAwesomeIcon icon={faCheck} style={{ fontSize:48, color:"var(--c-success)", marginBottom:16 }} />
            <div style={{ fontSize:18, fontWeight:800, color:"var(--c-fg)", marginBottom:8 }}>Plugin Installed</div>
            <p style={{ fontSize:14, color:"var(--c-fg-muted)", marginBottom:24 }}>
              The plugin is installed and ready to enable.
            </p>
            <button type="button" className="btn-primary btn-sm" onClick={() => navigate("/admin/installed")}>
              Go to Installed
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

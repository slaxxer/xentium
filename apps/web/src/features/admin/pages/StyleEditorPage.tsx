import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUpload, faXmark, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage } from "../../../lib/swal";
import { useAutosave } from "../../../hooks/useAutosave";
import { AutosaveStatus } from "../../../components/AutosaveStatus";

interface StyleDraft {
  tokens: Record<Mode, TokenMap>;
  fontFamily: string;
  fontWeight: string;
  fontSize: string;
}

// ── Token definitions ─────────────────────────────────────────────────────────

type TokenMap = Record<string, string>;
type Mode     = "light" | "dark";
type CtrlType = "color" | "range";
interface Ctrl { l: string; t: CtrlType; cssVar: string; min?: number; max?: number; unit?: string }

const DEFAULTS: Record<Mode, TokenMap> = {
  light: {
    "--c-bg":       "#f5f5fb",
    "--c-surface":  "#ffffff",
    "--c-card":     "#ffffff",
    "--c-accent":   "#6d5cf0",
    "--c-accent2":  "#8b78f5",
    "--c-fg":       "#15152b",
    "--c-fg-muted": "#5b5b7a",
    "--c-fg-hover": "#6d5cf0",
    "--c-bg-hover": "#f0effb",
    "--c-border":   "#e7e7f1",
    "--c-success":  "#16a37b",
    "--c-warn":     "#d98a04",
    "--c-danger":   "#dc4c4c",
    "--card-radius":"14px",
    "--btn-radius": "8px",
  },
  dark: {
    "--c-bg":       "#080812",
    "--c-surface":  "#0f0f1e",
    "--c-card":     "#13132a",
    "--c-accent":   "#7c6af7",
    "--c-accent2":  "#a78bfa",
    "--c-fg":       "#eeeef8",
    "--c-fg-muted": "#8080b0",
    "--c-fg-hover": "#a78bfa",
    "--c-bg-hover": "#1a1a35",
    "--c-border":   "#1e1e3a",
    "--c-success":  "#34d399",
    "--c-warn":     "#fbbf24",
    "--c-danger":   "#f87171",
    "--card-radius":"14px",
    "--btn-radius": "8px",
  },
};

const REGIONS: { id: string; label: string; controls: Ctrl[] }[] = [
  { id:"palette",  label:"Colour Palette", controls:[
    { l:"Background",      t:"color", cssVar:"--c-bg"       },
    { l:"Surface",         t:"color", cssVar:"--c-surface"   },
    { l:"Card",            t:"color", cssVar:"--c-card"      },
    { l:"Accent",          t:"color", cssVar:"--c-accent"    },
    { l:"Accent 2",        t:"color", cssVar:"--c-accent2"   },
    { l:"Border",          t:"color", cssVar:"--c-border"    },
  ]},
  { id:"text",     label:"Text & Fonts",   controls:[
    { l:"Primary text",    t:"color", cssVar:"--c-fg"        },
    { l:"Muted text",      t:"color", cssVar:"--c-fg-muted"   },
    { l:"Text / link hover",t:"color",cssVar:"--c-fg-hover"  },
    { l:"Hover background",t:"color", cssVar:"--c-bg-hover"  },
  ]},
  { id:"feedback", label:"Feedback",       controls:[
    { l:"Success",         t:"color", cssVar:"--c-success"   },
    { l:"Warning",         t:"color", cssVar:"--c-warn"      },
    { l:"Danger",          t:"color", cssVar:"--c-danger"    },
  ]},
  { id:"shapes",   label:"Shapes",         controls:[
    { l:"Card radius",     t:"range", cssVar:"--card-radius", min:0, max:28, unit:"px" },
    { l:"Button radius",   t:"range", cssVar:"--btn-radius",  min:0, max:24, unit:"px" },
  ]},
  { id:"branding", label:"Branding",       controls:[] },
];

const FONTS = [
  "Raleway",
  "Montserrat",
  "Poppins",
  "Open Sans",
  "Ubuntu",
  "Roboto",
] as const;

const FONT_WEIGHTS = ["300","400","500","600","700","800"] as const;

const FONT_SETTING_KEY   = "appearance.font.family";
const FSIZE_SETTING_KEY  = "appearance.font.size";
const FWEIGHT_SETTING_KEY= "appearance.font.weight";

function numVal(v: string | undefined, fallback: number): number {
  const n = parseFloat(v ?? "");
  return isNaN(n) ? fallback : n;
}

function safeHex(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

function reloadTokenStyle() {
  fetch("/api/appearance/css")
    .then((r) => (r.ok ? r.text() : ""))
    .then((css) => {
      let el = document.getElementById("nodevo-custom-tokens") as HTMLStyleElement | null;
      if (!el) { el = document.createElement("style"); el.id = "nodevo-custom-tokens"; document.head.appendChild(el); }
      el.textContent = css;
    }).catch(() => {});
}

// ── Component ─────────────────────────────────────────────────────────────────

export function StyleEditorPage() {
  const qc = useQueryClient();
  const [mode,     setMode]     = useState<Mode>("light");
  const [regionId, setRegionId] = useState(REGIONS[0]!.id);

  const [tokens, setTokens] = useState<Record<Mode, TokenMap> | null>(null);
  const initialised = useRef(false);

  // ── Font & size settings ──────────────────────────────────────────────────
  const [fontFamily, setFontFamily] = useState<string>(FONTS[0]);
  const [fontWeight, setFontWeight] = useState<string>("400");
  const [fontSize,   setFontSize]   = useState<string>("16");

  // Autosave baseline. `savedSnap` = the last persisted draft; set once tokens +
  // fonts have loaded, and updated on every save/reset so autosave never loops
  // or re-saves an unchanged value.
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [savedSnap, setSavedSnap]     = useState<StyleDraft | undefined>(undefined);
  const draft: StyleDraft = { tokens: tokens ?? DEFAULTS, fontFamily, fontWeight, fontSize };
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // ── Branding ──────────────────────────────────────────────────────────────
  const { data: branding, refetch: refetchBranding } = useQuery<{
    navbarUrl: string | null; iconUrl: string | null; logoText: string | null;
  }>({ queryKey: ["acp-branding"], queryFn: () => api.get("/appearance/branding") });

  const [logoText, setLogoText] = useState("");
  useEffect(() => { if (branding !== undefined) setLogoText(branding?.logoText ?? ""); }, [branding?.logoText]); // eslint-disable-line

  const saveLogoTextMut = useMutation({
    mutationFn: () => api.put("/appearance/branding/text", { text: logoText }),
    onSuccess:  () => { refetchBranding(); qc.invalidateQueries({ queryKey: ["pub-branding"] }); swalToast("Logo text saved.", "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  const uploadBrandingMut = useMutation({
    mutationFn: ({ variant, file }: { variant: "navbar" | "icon"; file: File }) => {
      const fd = new FormData(); fd.append("file", file);
      return api.post(`/appearance/branding/${variant}`, fd);
    },
    onSuccess: () => { refetchBranding(); qc.invalidateQueries({ queryKey: ["pub-branding"] }); swalToast("Uploaded.", "success"); },
    onError:   (e) => swalToast(apiErrorMessage(e)),
  });

  const deleteBrandingMut = useMutation({
    mutationFn: (variant: "navbar" | "icon") => api.delete(`/appearance/branding/${variant}`),
    onSuccess:  () => { refetchBranding(); qc.invalidateQueries({ queryKey: ["pub-branding"] }); swalToast("Removed.", "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  // ── Token data ────────────────────────────────────────────────────────────
  const { data: saved, isLoading } = useQuery<Record<Mode, TokenMap>>({
    queryKey: ["acp-tokens"],
    queryFn:  () => api.get("/appearance/tokens"),
  });

  useEffect(() => {
    if (saved && !initialised.current) {
      initialised.current = true;
      setTokens({ light: { ...DEFAULTS.light, ...saved.light }, dark: { ...DEFAULTS.dark, ...saved.dark } });
    }
  }, [saved]);

  // Load font settings via GET /admin/settings/:key (now supported)
  useEffect(() => {
    Promise.all([
      api.get<{value?:unknown}>(`/admin/settings/${FONT_SETTING_KEY}`).catch(() => null),
      api.get<{value?:unknown}>(`/admin/settings/${FSIZE_SETTING_KEY}`).catch(() => null),
      api.get<{value?:unknown}>(`/admin/settings/${FWEIGHT_SETTING_KEY}`).catch(() => null),
    ]).then(([fam, sz, wt]) => {
      const f = (fam as any)?.value; if (f && FONTS.includes(f as any)) setFontFamily(f);
      const s = (sz  as any)?.value; if (s) setFontSize(String(s));
      const w = (wt  as any)?.value; if (w) setFontWeight(String(w));
    }).catch(() => {}).finally(() => setFontsLoaded(true));
  }, []); // eslint-disable-line

  // Capture the autosave baseline once tokens + fonts have both loaded.
  useEffect(() => {
    if (tokens && fontsLoaded && !savedSnap) {
      setSavedSnap({ tokens, fontFamily, fontWeight, fontSize });
    }
  }, [tokens, fontsLoaded]); // eslint-disable-line

  // Single save that persists BOTH tokens AND font settings, then reloads CSS
  const saveMut = useMutation({
    mutationFn: async () => {
      await Promise.all([
        api.put("/appearance/tokens", tokens),
        api.put(`/admin/settings/${FONT_SETTING_KEY}`,    { value: fontFamily }),
        api.put(`/admin/settings/${FSIZE_SETTING_KEY}`,   { value: fontSize   }),
        api.put(`/admin/settings/${FWEIGHT_SETTING_KEY}`, { value: fontWeight }),
      ]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-style-history"] });
      reloadTokenStyle();
      setSavedSnap(draftRef.current); // baseline now matches what was persisted
      swalToast("Styles saved and applied.", "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const resetMut = useMutation({
    mutationFn: async () => {
      await Promise.all([
        api.put("/appearance/tokens", DEFAULTS),
        api.put(`/admin/settings/${FONT_SETTING_KEY}`,    { value: FONTS[0] }),
        api.put(`/admin/settings/${FSIZE_SETTING_KEY}`,   { value: "16"     }),
        api.put(`/admin/settings/${FWEIGHT_SETTING_KEY}`, { value: "400"    }),
      ]);
    },
    onSuccess: () => {
      setTokens({ light: { ...DEFAULTS.light }, dark: { ...DEFAULTS.dark } });
      setFontFamily(FONTS[0]);
      setFontSize("16");
      setFontWeight("400");
      reloadTokenStyle();
      // Baseline = defaults, so the autosave effect doesn't re-save them.
      setSavedSnap({ tokens: { light: { ...DEFAULTS.light }, dark: { ...DEFAULTS.dark } }, fontFamily: FONTS[0], fontSize: "16", fontWeight: "400" });
      swalToast("Styles reset to defaults.", "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  // Debounced autosave (longer delay — token saves snapshot style history).
  useAutosave({ value: draft, savedValue: savedSnap, onSave: () => saveMut.mutate(), delay: 1200 });

  if (isLoading || !tokens) return <div className="acp-card acp-empty">Loading…</div>;

  const modeTokens: TokenMap = tokens[mode] ?? {};
  function update(cssVar: string, value: string) {
    setTokens((prev) => prev ? { ...prev, [mode]: { ...prev[mode], [cssVar]: value } } : prev);
  }

  const region = REGIONS.find((r) => r.id === regionId) ?? REGIONS[0]!;
  const previewVars = Object.fromEntries(Object.entries(modeTokens)) as React.CSSProperties;

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">Appearance</div>
          <h1 className="acp-page-title">Style Editor</h1>
        </div>
        <div style={{ display:"flex", gap:12, alignItems:"center" }}>
          <button type="button" className="btn-ghost btn-sm"
            disabled={resetMut.isPending || saveMut.isPending}
            onClick={() => resetMut.mutate()}
          >
            <FontAwesomeIcon icon={faRotateLeft} style={{ marginRight:5 }} /> Reset
          </button>
          <AutosaveStatus saving={saveMut.isPending} />
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"220px 1fr", gap:20 }}>

        {/* Sidebar */}
        <div className="acp-card" style={{ padding:16, alignSelf:"start" }}>
          <div className="acp-label">Mode</div>
          <div style={{ display:"flex", gap:6, marginBottom:20 }}>
            {(["light","dark"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} style={{
                flex:1, padding:"7px", borderRadius:"var(--radius-sm)", fontSize:12,
                fontWeight:700, cursor:"pointer", fontFamily:"inherit", textTransform:"capitalize",
                background: mode===m ? "var(--c-accent)" : "var(--c-card)",
                color:      mode===m ? "#fff"            : "var(--c-fg-muted)",
                border:    `1px solid ${mode===m ? "var(--c-accent)" : "var(--c-border)"}`,
              }}>
                {m === "light" ? "☀️ Light" : "🌙 Dark"}
              </button>
            ))}
          </div>

          <div className="acp-label">Section</div>
          {REGIONS.map((r) => (
            <button key={r.id} type="button" onClick={() => setRegionId(r.id)} style={{
              display:"block", width:"100%", textAlign:"left",
              padding:"8px 12px", borderRadius:"var(--radius-sm)",
              fontSize:13, fontWeight: regionId===r.id ? 700 : 500,
              cursor:"pointer", fontFamily:"inherit", marginBottom:2,
              background: regionId===r.id ? "var(--c-accent-soft)" : "transparent",
              color:      regionId===r.id ? "var(--c-accent)"       : "var(--c-fg-muted)",
              border:     `1px solid ${regionId===r.id ? "var(--c-accent-glow)" : "transparent"}`,
            }}>
              {regionId===r.id ? "▸ " : ""}{r.label}
            </button>
          ))}
        </div>

        {/* Right panel */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

          {/* ── Branding section ─────────────────────────────────────────── */}
          {regionId === "branding" ? (
            <div className="acp-card" style={{ padding:24 }}>
              <div style={{ fontSize:15, fontWeight:800, color:"var(--c-fg)", marginBottom:4 }}>Branding</div>
              <p style={{ fontSize:13, color:"var(--c-fg-muted)", marginBottom:20 }}>
                Upload a logo image or use a text fallback. The site icon is used as the favicon.
              </p>

              <div style={{ marginBottom:20 }}>
                <div className="acp-label">Logo Text (fallback when no image is set)</div>
                <div style={{ display:"flex", gap:8 }}>
                  <input className="acp-input" value={logoText} onChange={(e) => setLogoText(e.target.value)} placeholder="nodevo" style={{ flex:1 }} />
                  <button type="button" className="btn-primary btn-sm" onClick={() => saveLogoTextMut.mutate()} disabled={saveLogoTextMut.isPending}>
                    Save
                  </button>
                </div>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
                <BrandingSlot
                  label="Navbar Logo"
                  hint="PNG, SVG or WebP · max 2 MB · recommended 160×40 px"
                  currentUrl={branding?.navbarUrl ?? null}
                  accept="image/png,image/svg+xml,image/webp"
                  onUpload={(f) => uploadBrandingMut.mutate({ variant:"navbar", file:f })}
                  onDelete={() => deleteBrandingMut.mutate("navbar")}
                  busy={uploadBrandingMut.isPending || deleteBrandingMut.isPending}
                />
                <BrandingSlot
                  label="Favicon / Site Icon"
                  hint="PNG, ICO or SVG · max 2 MB · recommended 64×64 px"
                  currentUrl={branding?.iconUrl ?? null}
                  accept="image/png,image/x-icon,image/svg+xml"
                  onUpload={(f) => uploadBrandingMut.mutate({ variant:"icon", file:f })}
                  onDelete={() => deleteBrandingMut.mutate("icon")}
                  busy={uploadBrandingMut.isPending || deleteBrandingMut.isPending}
                  square
                />
              </div>
            </div>

          ) : (
            <>
              {/* ── Token controls ─────────────────────────────────────────── */}
              <div className="acp-card" style={{ padding:24 }}>
                <div style={{ fontSize:15, fontWeight:800, color:"var(--c-fg)", marginBottom:20 }}>
                  {region.label}
                  <span style={{ color:"var(--c-fg-muted)", fontSize:13, fontWeight:400, marginLeft:8 }}>
                    · {mode} mode
                  </span>
                </div>

                {/* Font controls inside Text section */}
                {region.id === "text" && (
                  <>
                    <div style={{ marginBottom:20 }}>
                      <div className="acp-label">Font Family</div>
                      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                        <select className="acp-select" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} style={{ flex:1 }}>
                          {FONTS.map((f) => (
                            <option key={f} value={f} style={{ fontFamily:f }}>{f}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div style={{ marginBottom:20 }}>
                      <div className="acp-label">Font Weight</div>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        {FONT_WEIGHTS.map((w) => (
                          <button key={w} type="button" onClick={() => setFontWeight(w)} style={{
                            padding:"5px 12px", borderRadius:"var(--radius-sm)", fontSize:12,
                            fontWeight: parseInt(w) as React.CSSProperties["fontWeight"],
                            cursor:"pointer", fontFamily:"inherit",
                            background: fontWeight===w ? "var(--c-accent-soft)" : "var(--c-card)",
                            color:      fontWeight===w ? "var(--c-accent)"       : "var(--c-fg-muted)",
                            border:    `1px solid ${fontWeight===w ? "var(--c-accent-glow)" : "var(--c-border)"}`,
                          }}>
                            {w}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginBottom:20 }}>
                      <div className="acp-label">Base Font Size</div>
                      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                        <input type="range" min={12} max={20} value={parseInt(fontSize)||16}
                          onChange={(e) => setFontSize(e.target.value)}
                          style={{ flex:1, accentColor:"var(--c-accent)" }} />
                        <span style={{ fontSize:12, color:"var(--c-fg-muted)", minWidth:36 }}>{fontSize}px</span>
                      </div>
                    </div>
                    <div style={{ height:1, background:"var(--c-border)", marginBottom:20 }} />
                  </>
                )}

                {/* Colour / range controls */}
                {region.controls.map((ctrl) => {
                  const val = modeTokens[ctrl.cssVar] ?? "";
                  return (
                    <div key={ctrl.cssVar} style={{ marginBottom:20 }}>
                      <div className="acp-label">{ctrl.l}</div>
                      {ctrl.t === "color" && (
                        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                          <input type="color" value={safeHex(val,"#000000")} onChange={(e) => update(ctrl.cssVar, e.target.value)}
                            style={{ width:40, height:36, border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", cursor:"pointer", padding:2, background:"transparent", flexShrink:0 }} />
                          <input className="acp-input" value={val} onChange={(e) => update(ctrl.cssVar, e.target.value)}
                            style={{ width:140, fontFamily:"monospace", fontSize:13 }} placeholder="#rrggbb" />
                        </div>
                      )}
                      {ctrl.t === "range" && (() => {
                        const n = numVal(val, ctrl.min ?? 0);
                        return (
                          <div>
                            <input type="range" min={ctrl.min} max={ctrl.max} value={n}
                              onChange={(e) => update(ctrl.cssVar, `${e.target.value}${ctrl.unit ?? ""}`)}
                              style={{ width:"100%", accentColor:"var(--c-accent)", marginBottom:4 }} />
                            <div style={{ fontSize:12, color:"var(--c-fg-muted)" }}>{n}{ctrl.unit ?? ""}</div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>

              {/* Live preview */}
              <div className="acp-card" style={{ padding:20 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"var(--c-fg-muted)", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:14 }}>
                  Live Preview
                </div>
                <div style={{ ...previewVars, padding:20, borderRadius:"var(--radius-sm)", border:"1px solid var(--c-border)", background:"var(--c-bg)" }}>
                  <div style={{ background:"var(--c-card)", borderRadius:"var(--card-radius)", padding:16, marginBottom:12, border:"1px solid var(--c-border)" }}>
                    <div style={{ fontSize:18, fontWeight:800, color:"var(--c-fg)", marginBottom:8 }}>Article Title Preview</div>
                    <div style={{ fontSize:13, color:"var(--c-fg-muted)", lineHeight:1.7 }}>
                      This is how your content will look with the current style settings.
                    </div>
                    <div style={{ display:"flex", gap:8, marginTop:12 }}>
                      <div style={{ background:"var(--c-accent)", color:"#fff", padding:"6px 14px", borderRadius:"var(--btn-radius)", fontSize:12, fontWeight:700 }}>Primary</div>
                      <div style={{ border:"1px solid var(--c-border)", color:"var(--c-fg-muted)", padding:"6px 14px", borderRadius:"var(--btn-radius)", fontSize:12 }}>Ghost</div>
                      <div style={{ padding:"6px 14px", borderRadius:"var(--btn-radius)", fontSize:12, background:"var(--c-bg-hover)", color:"var(--c-fg-hover)" }}>Hover</div>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <span style={{ background:"var(--c-success)", color:"#fff", padding:"2px 8px", borderRadius:100, fontSize:11, fontWeight:700 }}>success</span>
                    <span style={{ background:"var(--c-warn)",    color:"#fff", padding:"2px 8px", borderRadius:100, fontSize:11, fontWeight:700 }}>warn</span>
                    <span style={{ background:"var(--c-danger)",  color:"#fff", padding:"2px 8px", borderRadius:100, fontSize:11, fontWeight:700 }}>danger</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── BrandingSlot ──────────────────────────────────────────────────────────────

function BrandingSlot({ label, hint, currentUrl, accept, onUpload, onDelete, busy, square }: {
  label: string; hint: string; currentUrl: string | null;
  accept: string; onUpload: (f: File) => void; onDelete: () => void;
  busy: boolean; square?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewH = square ? 64 : 40;

  return (
    <div>
      <div className="acp-label">{label}</div>
      <div style={{ background:"var(--c-surface)", border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", padding:16, display:"flex", flexDirection:"column", gap:12 }}>
        <div style={{ height:previewH+16, display:"flex", alignItems:"center", justifyContent:"center", background:"var(--c-bg)", borderRadius:"var(--radius-sm)", border:"1px solid var(--c-border)" }}>
          {currentUrl
            ? <img src={currentUrl} alt={label} style={{ maxHeight:previewH, maxWidth:"100%", objectFit:"contain" }} />
            : <span style={{ fontSize:11, color:"var(--c-fg-muted)" }}>No image set</span>
          }
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button type="button" className="btn-ghost btn-sm" style={{ flex:1 }} disabled={busy} onClick={() => inputRef.current?.click()}>
            <FontAwesomeIcon icon={faUpload} style={{ marginRight:5 }} /> Upload
          </button>
          {currentUrl && (
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onDelete}
              style={{ color:"var(--c-danger)", borderColor:"color-mix(in srgb,var(--c-danger) 35%,transparent)" }}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </div>
        <div style={{ fontSize:11, color:"var(--c-fg-muted)" }}>{hint}</div>
        <input ref={inputRef} type="file" accept={accept} style={{ display:"none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
      </div>
    </div>
  );
}

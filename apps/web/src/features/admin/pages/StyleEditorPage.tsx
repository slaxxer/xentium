import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUpload, faXmark, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { useAutosave } from "../../../hooks/useAutosave";
import { AutosaveStatus } from "../../../components/AutosaveStatus";
import { refreshTokenCss } from "../../../lib/liveStyle";
import { useTheme } from "../../../hooks/useTheme";
import { HEARTH_DEFAULT_TOKENS } from "@nodevo/contracts";

const CUSTOM_CSS_PREVIEW_ID = "nodevo-custom-css-preview";

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

// Hearth core values — single shared copy in @nodevo/contracts (also used by the
// API), mirroring apps/web/src/styles/tokens.scss. These are only the editor's
// display defaults; a true Reset clears the server overrides so the app inherits
// tokens.scss directly.
const DEFAULTS: Record<Mode, TokenMap> = HEARTH_DEFAULT_TOKENS;

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
    { l:"Subtle text",     t:"color", cssVar:"--c-fg-subtle"  },
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
  { id:"customcss",label:"Custom CSS",      controls:[] },
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
const LIVE_REFRESH_KEY   = "appearance.live_refresh_seconds";

function numVal(v: string | undefined, fallback: number): number {
  const n = parseFloat(v ?? "");
  return isNaN(n) ? fallback : n;
}

function safeHex(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

// Pull `--var: value` overrides out of any `:root { … }` / `html { … }` blocks in a
// raw custom-CSS blob, so the token Live Preview can layer them over the palette
// (custom CSS wins) — matching how the scoped custom CSS overrides tokens on the page.
function extractRootVars(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const blockRe = /(?::root|html)[^{}]*\{([^}]*)\}/g;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(css))) {
    const declRe = /(--[\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g;
    let d: RegExpExecArray | null;
    while ((d = declRe.exec(block[1]!))) out[d[1]!] = d[2]!.trim();
  }
  return out;
}

function reloadTokenStyle() {
  // Bust the browser HTTP cache — /api/appearance/css is sent with
  // `Cache-Control: max-age=60`, so a plain fetch right after a save returns the
  // stale (pre-save) CSS for up to a minute. `no-store` + a cache-busting query
  // force a fresh copy so edits apply instantly.
  fetch(`/api/appearance/css?t=${Date.now()}`, { cache: "no-store" })
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
  // Start on the theme the admin is actually viewing, so "what you edit" matches
  // "what you see" without forcibly switching their theme.
  const [mode,     setMode]     = useState<Mode>(
    () => (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
  );
  const [regionId, setRegionId] = useState(REGIONS[0]!.id);
  // Custom CSS edits the theme the admin is actually VIEWING (reactive), so
  // "on light theme → editing light, seen live" always holds. Switch theme via the
  // top-bar toggle to edit the other one.
  const { theme: viewedTheme } = useTheme();

  const [tokens, setTokens] = useState<Record<Mode, TokenMap> | null>(null);
  const initialised = useRef(false);

  // ── Font & size settings ──────────────────────────────────────────────────
  const [fontFamily, setFontFamily] = useState<string>(FONTS[0]);
  const [fontWeight, setFontWeight] = useState<string>("400");
  const [fontSize,   setFontSize]   = useState<string>("16");

  // ── Live-sync interval (independent of the token autosave) ──────────────────
  const [liveRefresh, setLiveRefresh] = useState<string>("5");
  const saveLiveRefreshMut = useMutation({
    mutationFn: (seconds: number) => api.put(`/admin/settings/${LIVE_REFRESH_KEY}`, { value: seconds }),
    onSuccess:  () => swalToast("Live refresh interval saved.", "success"),
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });
  const commitLiveRefresh = () => {
    const n = Math.min(60, Math.max(2, Math.round(Number(liveRefresh) || 5)));
    setLiveRefresh(String(n));
    saveLiveRefreshMut.mutate(n);
  };

  // ── Custom CSS console (per theme: light / dark) ────────────────────────────
  const [customCss, setCustomCss]           = useState<Record<Mode, string>>({ light: "", dark: "" });
  const [customCssSaved, setCustomCssSaved] = useState<Record<Mode, string>>({ light: "", dark: "" });
  const activeCss = customCss[viewedTheme];
  const customDirty = customCss.light !== customCssSaved.light || customCss.dark !== customCssSaved.dark;

  useEffect(() => {
    api.get<{ light?: string; dark?: string }>("/appearance/custom-css")
      .then((r) => {
        const next = { light: r?.light ?? "", dark: r?.dark ?? "" };
        setCustomCss(next); setCustomCssSaved(next);
      })
      .catch(() => {});
  }, []);

  // Real-time preview of the ACTIVE theme: scope it server-side (same transform as
  // the served stylesheet) and layer it over the token tag. Runs on EVERY region so
  // custom CSS is a live preview everywhere in the editor, not only the Custom CSS
  // tab — and so palette edits show through the custom overrides. Debounced.
  useEffect(() => {
    const id = setTimeout(() => {
      api.post<{ css: string }>("/appearance/custom-css/preview", { css: activeCss, theme: viewedTheme })
        .then((r) => {
          let el = document.getElementById(CUSTOM_CSS_PREVIEW_ID) as HTMLStyleElement | null;
          if (!el) { el = document.createElement("style"); el.id = CUSTOM_CSS_PREVIEW_ID; document.head.appendChild(el); }
          el.textContent = r?.css ?? "";
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [activeCss, viewedTheme]);

  // Drop the preview tag on unmount so unsaved edits don't linger site-wide.
  useEffect(() => () => { document.getElementById(CUSTOM_CSS_PREVIEW_ID)?.remove(); }, []);

  const saveCustomCssMut = useMutation({
    mutationFn: () => api.put("/appearance/custom-css", { light: customCss.light, dark: customCss.dark }),
    onSuccess: async () => {
      setCustomCssSaved(customCss);
      // Pull the freshly-served CSS into the global token tag, then drop the
      // preview layer so the persisted copy is the single source of truth.
      await refreshTokenCss();
      document.getElementById(CUSTOM_CSS_PREVIEW_ID)?.remove();
      swalToast("Custom CSS applied site-wide.", "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

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
      api.get<{value?:unknown}>(`/admin/settings/${LIVE_REFRESH_KEY}`).catch(() => null),
    ]).then(([fam, sz, wt, lr]) => {
      const f = (fam as any)?.value; if (f && FONTS.includes(f as any)) setFontFamily(f);
      const s = (sz  as any)?.value; if (s) setFontSize(String(s));
      const w = (wt  as any)?.value; if (w) setFontWeight(String(w));
      const r = (lr  as any)?.value; if (r) setLiveRefresh(String(r));
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
    // Clear ALL appearance overrides server-side so the app inherits the bundled
    // core (tokens.scss + fonts), instead of painting a stale defaults snapshot.
    mutationFn: () => api.post("/appearance/reset", {}),
    onSuccess: async () => {
      setTokens({ light: { ...DEFAULTS.light }, dark: { ...DEFAULTS.dark } });
      setFontFamily(FONTS[0]);
      setFontSize("16");
      setFontWeight("400");
      setCustomCss({ light: "", dark: "" });
      setCustomCssSaved({ light: "", dark: "" });
      document.getElementById(CUSTOM_CSS_PREVIEW_ID)?.remove();
      await refreshTokenCss();
      // Baseline = current display, so the autosave effect doesn't re-save (which
      // would recreate overrides and undo the inherit).
      setSavedSnap({ tokens: { light: { ...DEFAULTS.light }, dark: { ...DEFAULTS.dark } }, fontFamily: FONTS[0], fontSize: "16", fontWeight: "400" });
      swalToast("Appearance reset — inheriting the core design.", "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const handleReset = async () => {
    const ok = await swalConfirm(
      "Reset appearance to the core design?",
      "Restores the default theme tokens and fonts, and clears your custom CSS for both light and dark. This cannot be undone.",
      "Reset",
    );
    if (ok) resetMut.mutate();
  };

  // Debounced autosave (longer delay — token saves snapshot style history).
  useAutosave({ value: draft, savedValue: savedSnap, onSave: () => saveMut.mutate(), delay: 1200 });

  if (isLoading || !tokens) return <div className="acp-card acp-empty">Loading…</div>;

  const modeTokens: TokenMap = tokens[mode] ?? {};
  function update(cssVar: string, value: string) {
    setTokens((prev) => prev ? { ...prev, [mode]: { ...prev[mode], [cssVar]: value } } : prev);
  }

  const region = REGIONS.find((r) => r.id === regionId) ?? REGIONS[0]!;
  // Live Preview = tokens for this mode, with any custom-CSS :root overrides layered
  // on top so the preview reflects what custom CSS does to the palette.
  const previewVars = {
    ...modeTokens,
    ...extractRootVars(customCss[mode]),
  } as React.CSSProperties;

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
            onClick={handleReset}
          >
            <FontAwesomeIcon icon={faRotateLeft} style={{ marginRight:5 }} /> Reset
          </button>
          <AutosaveStatus saving={saveMut.isPending} />
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"220px 1fr", gap:20 }}>

        {/* Sidebar */}
        <div className="acp-card" style={{ padding:16, alignSelf:"start" }}>
          {/* Mode toggle drives the TOKEN editor. Custom CSS follows the viewed
              theme instead, so hide this there to avoid two competing switches. */}
          {regionId !== "customcss" && (
            <>
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
            </>
          )}

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

          <div style={{ borderTop:"1px solid var(--c-border)", marginTop:16, paddingTop:16 }}>
            <div className="acp-label">Live sync interval</div>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <input
                className="acp-input" type="number" min={2} max={60}
                value={liveRefresh}
                onChange={(e) => setLiveRefresh(e.target.value)}
                onBlur={commitLiveRefresh}
                style={{ width:72 }}
              />
              <span style={{ fontSize:12, color:"var(--c-fg-muted)" }}>seconds</span>
            </div>
            <p style={{ fontSize:11, color:"var(--c-fg-muted)", marginTop:6, lineHeight:1.4 }}>
              How fast saved theme changes reach every open browser. Lower = snappier, more requests.
            </p>
          </div>
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

          ) : regionId === "customcss" ? (
            <div className="acp-card" style={{ padding:24 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, marginBottom:4 }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:800, color:"var(--c-fg)", marginBottom:4 }}>
                    Custom CSS
                    <span style={{ color:"var(--c-accent)", fontSize:13, fontWeight:700, marginLeft:8, textTransform:"capitalize" }}>
                      · {viewedTheme} theme
                    </span>
                  </div>
                  <p style={{ fontSize:13, color:"var(--c-fg-muted)", margin:0, maxWidth:560 }}>
                    Raw CSS for the <strong>{viewedTheme}</strong> theme — the one you're viewing — scoped &amp; applied
                    after the tokens so it overrides any rule (cards, asides, articles…). Switch your theme with the
                    top-bar toggle to edit the other one. Edits preview live; <strong>Apply &amp; Save</strong> stores
                    both themes and pushes them to every visitor.
                  </p>
                </div>
                <button
                  type="button" className="btn-primary btn-sm"
                  onClick={() => saveCustomCssMut.mutate()}
                  disabled={saveCustomCssMut.isPending || !customDirty}
                >
                  {saveCustomCssMut.isPending ? "Saving…" : "Apply & Save"}
                </button>
              </div>

              <textarea
                value={activeCss}
                spellCheck={false}
                onChange={(e) => setCustomCss((p) => ({ ...p, [viewedTheme]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const el = e.currentTarget;
                    const s = el.selectionStart, end = el.selectionEnd;
                    const next = activeCss.slice(0, s) + "  " + activeCss.slice(end);
                    setCustomCss((p) => ({ ...p, [viewedTheme]: next }));
                    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
                  }
                }}
                placeholder={".acp-card {\n  background: #101018;\n}\n\narticle, aside {\n  border-radius: 18px;\n}"}
                style={{
                  width:"100%", minHeight:360, marginTop:16, boxSizing:"border-box",
                  fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  fontSize:13, lineHeight:1.6, tabSize:2,
                  background:"var(--c-bg)", color:"var(--c-fg)",
                  border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)",
                  padding:"14px 16px", resize:"vertical", outline:"none",
                }}
              />
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:8, fontSize:11, color:"var(--c-fg-muted)" }}>
                <span>{customDirty ? "Unsaved changes — previewing live" : "Saved"}</span>
                <span>{activeCss.length.toLocaleString()} / 100,000 chars</span>
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
                      <div style={{ padding:"6px 14px", borderRadius:"var(--btn-radius)", fontSize:12, background:"var(--c-bg-hover)", color:"var(--c-accent)" }}>Hover</div>
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

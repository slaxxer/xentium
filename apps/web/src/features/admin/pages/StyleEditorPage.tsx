import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUpload, faXmark, faRotateLeft, faRotateRight, faTriangleExclamation, faCloudArrowUp } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import { useAutosave } from "../../../hooks/useAutosave";
import { AutosaveStatus } from "../../../components/AutosaveStatus";
import { refreshTokenCss } from "../../../lib/liveStyle";
import { useTheme } from "../../../hooks/useTheme";
import {
  HEARTH_DEFAULT_TOKENS,
  TOKEN_REGISTRY,
  TOKEN_BY_VAR,
  SCOPE_SELECTOR,
  type TokenMap,
  type ScopedTokens,
  type ScopedTokenSet,
  type ThemeScope,
  type TokenDef,
  type TokenGroup,
} from "@nodevo/contracts";

const CUSTOM_CSS_PREVIEW_ID = "nodevo-custom-css-preview";

type Mode = "light" | "dark";

interface StyleDraft {
  tokens: ScopedTokenSet;
  fontFamily: string;
  fontWeight: string;
  fontSize: string;
}

// ── Defaults / display resolution ───────────────────────────────────────────────
// Hearth core values — single shared copy in @nodevo/contracts (also used by the
// API), mirroring apps/web/src/styles/tokens.scss. These are the editor's *display*
// defaults; a true Reset clears the server overrides so the app inherits tokens.scss.
const DEFAULTS = HEARTH_DEFAULT_TOKENS;

// Registry tokens with no HEARTH default and no inheritsFrom (radius long-hands)
// fall back to these so the slider shows the right starting position.
const RADIUS_FALLBACK: Record<string, number> = {
  "--btn-radius": 10, "--card-radius": 18, "--input-radius": 14, "--menu-radius": 14,
};

// ── Semantic sections (not in TOKEN_REGISTRY — they ARE the palette base) ────────
interface ColorRow { l: string; cssVar: string }
const PALETTE_ROWS: ColorRow[] = [
  { l: "styleEditor.rowBg", cssVar: "--c-bg" },
  { l: "styleEditor.rowSurface", cssVar: "--c-surface" },
  { l: "styleEditor.rowCard", cssVar: "--c-card" },
  { l: "styleEditor.rowAccent", cssVar: "--c-accent" },
  { l: "styleEditor.rowAccent2", cssVar: "--c-accent2" },
  { l: "styleEditor.rowBorder", cssVar: "--c-border" },
];
const TEXT_ROWS: ColorRow[] = [
  { l: "styleEditor.rowFg", cssVar: "--c-fg" },
  { l: "styleEditor.rowMuted", cssVar: "--c-fg-muted" },
  { l: "styleEditor.rowSubtle", cssVar: "--c-fg-subtle" },
  { l: "styleEditor.rowHoverBg", cssVar: "--c-bg-hover" },
];
const FEEDBACK_ROWS: ColorRow[] = [
  { l: "styleEditor.rowSuccess", cssVar: "--c-success" },
  { l: "styleEditor.rowWarn", cssVar: "--c-warn" },
  { l: "styleEditor.rowDanger", cssVar: "--c-danger" },
  { l: "styleEditor.rowInfo", cssVar: "--c-info" },
  { l: "styleEditor.rowUpdate", cssVar: "--c-update" },
];

// ── Section list (the ADR-0003 "backbone") ──────────────────────────────────────
type SectionKind = "palette" | "text" | "feedback" | "region" | "component" | "branding" | "customcss";
interface Section { id: string; label: string; kind: SectionKind; group?: TokenGroup }
const SECTION_GROUPS: { heading: string; items: Section[] }[] = [
  { heading: "styleEditor.grpPalette", items: [
    { id: "palette",  label: "styleEditor.secPalette", kind: "palette" },
    { id: "text",     label: "styleEditor.secText",   kind: "text" },
    { id: "feedback", label: "styleEditor.secFeedback",        kind: "feedback" },
  ]},
  { heading: "styleEditor.grpRegions", items: [
    { id: "navbar",  label: "styleEditor.secNavbar",  kind: "region", group: "navbar" },
    { id: "content", label: "styleEditor.secContent", kind: "region", group: "content" },
    { id: "footer",  label: "styleEditor.secFooter",  kind: "region", group: "footer" },
    { id: "aside",   label: "styleEditor.secAside",   kind: "region", group: "aside" },
  ]},
  { heading: "styleEditor.grpComponents", items: [
    { id: "button", label: "styleEditor.secButton", kind: "component", group: "button" },
    { id: "card",   label: "styleEditor.secCard",   kind: "component", group: "card" },
    { id: "field",  label: "styleEditor.secField",  kind: "component", group: "field" },
    { id: "menu",   label: "styleEditor.secMenu",   kind: "component", group: "menu" },
    { id: "segment", label: "styleEditor.secSegment", kind: "component", group: "segment" },
  ]},
  { heading: "styleEditor.grpSite", items: [
    { id: "branding",  label: "styleEditor.secBranding",   kind: "branding" },
    { id: "customcss", label: "styleEditor.secCustomCss", kind: "customcss" },
  ]},
];
const ALL_SECTIONS = SECTION_GROUPS.flatMap((g) => g.items);

// 3b — "preview state" forces a state on the specimen so token states you can't
// hover-click (menu hover bg, field focus border) are editable. Only the states
// that have registry tokens are offered.
type PreviewState = "base" | "hover" | "focus";
const PREVIEW_STATES: { id: PreviewState; label: string }[] = [
  { id: "base",  label: "styleEditor.stBase" },
  { id: "hover", label: "styleEditor.stHover" },
  { id: "focus", label: "styleEditor.stFocus" },
];

// Scope picker options for component sections (region surface tokens are global-only).
//
// The variant scopes are here because a variant IS a scope (ADR-0005): the Layout
// Editor's Style panel edits a curated six tokens per variant, and this is where the
// rest — button, field, menu, radius — can be re-scoped to one. Without them a theme
// author could apply a look to a block and then not fully define it.
const SCOPE_OPTIONS: { id: ThemeScope; label: string }[] = [
  { id: "global",  label: "styleEditor.scopeAll" },
  { id: "navbar",  label: "styleEditor.secNavbar" },
  { id: "content", label: "styleEditor.secContent" },
  { id: "footer",  label: "styleEditor.secFooter" },
  { id: "aside",   label: "styleEditor.secAside" },
  { id: "variant.surface", label: "layoutEditor.variant.surface" },
  { id: "variant.muted",   label: "layoutEditor.variant.muted" },
  { id: "variant.accent",  label: "layoutEditor.variant.accent" },
  { id: "variant.plain",   label: "layoutEditor.variant.plain" },
];

const FONTS = ["Poppins", "Nunito", "Montserrat", "Open Sans", "Ubuntu"] as const;
const FONT_WEIGHTS = ["300", "400", "500", "600", "700", "800"] as const;

const FONT_SETTING_KEY    = "appearance.font.family";
const FSIZE_SETTING_KEY   = "appearance.font.size";
const FWEIGHT_SETTING_KEY = "appearance.font.weight";

const SHADOW_PRESETS: { id: string; label: string; value: string }[] = [
  { id: "none",   label: "styleEditor.shNone",   value: "none" },
  { id: "soft",   label: "styleEditor.shSoft",   value: "var(--shadow-card)" },
  { id: "strong", label: "styleEditor.shStrong", value: "var(--shadow-pop)" },
];

function numVal(v: string | undefined, fallback: number): number {
  const n = parseFloat(v ?? "");
  return isNaN(n) ? fallback : n;
}
function safeHex(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

/**
 * The value a token shows when it is NOT explicitly overridden — its inherited value.
 *
 * Three layers, nearest first: the installed THEME's value for this scope, then the
 * admin's own global override, then the bundled default; failing all of those, the
 * registry's `inheritsFrom` chain down to a palette token.
 *
 * The theme layer is why "Inherited" is honest on a site with a theme installed: the
 * served stylesheet is the theme merged under the admin's overrides, so a token the admin
 * has not touched shows the theme's colour — and clearing an override falls back to it
 * rather than to stock Nodevo.
 */
function inheritedValue(
  cssVar: string, mode: Mode, globalBucket: TokenMap, themeBuckets: ScopedTokens, scope: ThemeScope,
): string {
  const fromTheme = themeBuckets[scope]?.[cssVar] ?? themeBuckets.global?.[cssVar];
  if (fromTheme !== undefined) return fromTheme;
  const def = (DEFAULTS[mode] as TokenMap)[cssVar];
  if (def !== undefined) return globalBucket[cssVar] ?? def;
  const reg: TokenDef | undefined = TOKEN_BY_VAR[cssVar];
  if (reg?.inheritsFrom) return inheritedValue(reg.inheritsFrom, mode, globalBucket, themeBuckets, scope);
  if (RADIUS_FALLBACK[cssVar] !== undefined) return `${RADIUS_FALLBACK[cssVar]}px`;
  return "";
}

// Pull `--var: value` overrides out of `:root {}` / `html {}` blocks in raw custom
// CSS so the live preview can layer them over the tokens (custom CSS wins).
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

// ── Component ─────────────────────────────────────────────────────────────────

export function StyleEditorPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(
    () => (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
  );
  const [sectionId, setSectionId] = useState(ALL_SECTIONS[0]!.id);
  const [scope, setScope] = useState<ThemeScope>("global");
  const [previewState, setPreviewState] = useState<PreviewState>("base");
  const { theme: viewedTheme } = useTheme();

  const [tokens, setTokens] = useState<ScopedTokenSet | null>(null);
  const initialised = useRef(false);

  const [fontFamily, setFontFamily] = useState<string>(FONTS[0]);
  const [fontWeight, setFontWeight] = useState<string>("400");
  const [fontSize,   setFontSize]   = useState<string>("16");

  // ── Custom CSS console (per theme) ──────────────────────────────────────────
  const [customCss, setCustomCss]           = useState<Record<Mode, string>>({ light: "", dark: "" });
  const [customCssSaved, setCustomCssSaved] = useState<Record<Mode, string>>({ light: "", dark: "" });
  const activeCss = customCss[viewedTheme];
  const customDirty = customCss.light !== customCssSaved.light || customCss.dark !== customCssSaved.dark;

  useEffect(() => {
    api.get<{ light?: string; dark?: string }>("/appearance/custom-css")
      .then((r) => { const next = { light: r?.light ?? "", dark: r?.dark ?? "" }; setCustomCss(next); setCustomCssSaved(next); })
      .catch(() => {});
  }, []);

  const [cssPreview, setCssPreview] = useState("");
  useEffect(() => {
    const id = setTimeout(() => {
      api.post<{ css: string }>("/appearance/custom-css/preview", { css: activeCss, theme: viewedTheme })
        .then((r) => setCssPreview(r?.css ?? ""))
        .catch(() => setCssPreview(""));
    }, 300);
    return () => clearTimeout(id);
  }, [activeCss, viewedTheme]);

  const saveCustomCssMut = useMutation({
    mutationFn: () => api.put("/appearance/custom-css", { light: customCss.light, dark: customCss.dark }),
    onSuccess: async () => {
      setCustomCssSaved(customCss);
      await refreshTokenCss();
      document.getElementById(CUSTOM_CSS_PREVIEW_ID)?.remove();
      swalToast(t("styleEditor.toastCss"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  // ── Autosave baseline ───────────────────────────────────────────────────────
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [savedSnap, setSavedSnap]     = useState<StyleDraft | undefined>(undefined);
  const draft: StyleDraft = { tokens: tokens ?? { light: {}, dark: {} }, fontFamily, fontWeight, fontSize };
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // ── Branding ──────────────────────────────────────────────────────────────
  const { data: branding, refetch: refetchBranding } = useQuery<{
    navbarUrl: string | null; iconUrl: string | null; logoText: string | null;
  }>({ queryKey: ["acp-branding"], queryFn: () => api.get("/appearance/branding") });

  const [logoText, setLogoText] = useState("");
  useEffect(() => { if (branding !== undefined) setLogoText(branding?.logoText ?? ""); }, [branding?.logoText]);

  const saveLogoTextMut = useMutation({
    mutationFn: () => api.put("/appearance/branding/text", { text: logoText }),
    onSuccess:  () => { refetchBranding(); qc.invalidateQueries({ queryKey: ["pub-branding"] }); swalToast(t("styleEditor.toastLogoText"), "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });
  const uploadBrandingMut = useMutation({
    mutationFn: ({ variant, file }: { variant: "navbar" | "icon"; file: File }) => {
      const fd = new FormData(); fd.append("file", file);
      return api.post(`/appearance/branding/${variant}`, fd);
    },
    onSuccess: () => { refetchBranding(); qc.invalidateQueries({ queryKey: ["pub-branding"] }); swalToast(t("styleEditor.toastUploaded"), "success"); },
    onError:   (e) => swalToast(apiErrorMessage(e)),
  });
  const deleteBrandingMut = useMutation({
    mutationFn: (variant: "navbar" | "icon") => api.delete(`/appearance/branding/${variant}`),
    onSuccess:  () => { refetchBranding(); qc.invalidateQueries({ queryKey: ["pub-branding"] }); swalToast(t("styleEditor.toastRemoved"), "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  // ── Token data (sparse scoped overrides) ────────────────────────────────────
  const { data: saved, isLoading } = useQuery<ScopedTokenSet & {
    theme?: ScopedTokenSet;
    installedTheme?: { name?: string; version?: string } | null;
  }>({
    queryKey: ["acp-tokens"],
    queryFn:  () => api.get("/appearance/tokens"),
  });
  // NOT merged into `tokens`: the editor writes back what it holds, so folding the theme
  // in would turn every theme value into an admin override and destroy the inheritance.
  const themeTokens = saved?.theme;
  useEffect(() => {
    if (saved && !initialised.current) {
      initialised.current = true;
      // Stored sparse exactly as saved — do NOT merge defaults, or every token would
      // become an "override" and inheritance/sparse-storage would break.
      setTokens({ light: saved.light ?? {}, dark: saved.dark ?? {} });
    }
  }, [saved]);

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
  }, []);

  useEffect(() => {
    if (tokens && fontsLoaded && !savedSnap) setSavedSnap({ tokens, fontFamily, fontWeight, fontSize });
  }, [tokens, fontsLoaded]);

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
      qc.invalidateQueries({ queryKey: ["acp-draft-status"] });
      // No global injection here: the draft is previewed only in the scoped preview
      // iframe (previewCss). Injecting into the ACP's own <head> would restyle the
      // ACP you're working in with unpublished changes. The ACP keeps showing the
      // published theme until Publish (which calls refreshTokenCss).
      setSavedSnap(draftRef.current);
      swalToast(t("styleEditor.toastDraft"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  // Staged-publish: edits above are saved as a draft. Publishing (here or via the
  // scheduled "Publish appearance changes" job) promotes the draft to the live site.
  const { data: draftStatus } = useQuery<{ pending: boolean }>({
    queryKey: ["acp-draft-status"],
    queryFn:  () => api.get("/appearance/draft-status"),
    refetchInterval: 15_000,
  });
  const publishMut = useMutation({
    mutationFn: () => api.post("/appearance/publish", {}),
    onSuccess: async () => {
      await refreshTokenCss();
      qc.invalidateQueries({ queryKey: ["acp-draft-status"] });
      qc.invalidateQueries({ queryKey: ["acp-style-history"] });
      swalToast(t("styleEditor.toastPublished"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const resetMut = useMutation({
    mutationFn: () => api.post("/appearance/reset", {}),
    onSuccess: async () => {
      const empty: ScopedTokenSet = { light: {}, dark: {} };
      setTokens(empty);
      setFontFamily(FONTS[0]); setFontSize("16"); setFontWeight("400");
      setCustomCss({ light: "", dark: "" }); setCustomCssSaved({ light: "", dark: "" });
      document.getElementById(CUSTOM_CSS_PREVIEW_ID)?.remove();
      await refreshTokenCss();
      setSavedSnap({ tokens: empty, fontFamily: FONTS[0], fontSize: "16", fontWeight: "400" });
      swalToast(t("styleEditor.toastReset"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });
  const handleReset = async () => {
    const ok = await swalConfirm(
      t("styleEditor.resetTitle"),
      t("styleEditor.resetText"),
      t("styleEditor.reset"),
    );
    if (ok) resetMut.mutate();
  };

  useAutosave({ value: draft, savedValue: savedSnap, onSave: () => saveMut.mutate(), delay: 1200 });

  if (isLoading || !tokens) return <div className="acp-card acp-empty">{t("styleEditor.loading")}</div>;

  const section = ALL_SECTIONS.find((s) => s.id === sectionId) ?? ALL_SECTIONS[0]!;
  const globalBucket = tokens[mode].global ?? {};
  /** What the installed theme defines — the layer under the admin's own edits. */
  const themeBuckets: ScopedTokens = themeTokens?.[mode] ?? {};

  // The scope a section edits: regions + palette → global; components → the picker.
  const effScope: ThemeScope = section.kind === "component" ? scope : "global";

  function selectSection(id: string) {
    setSectionId(id);
    const next = ALL_SECTIONS.find((s) => s.id === id);
    if (next?.kind !== "component") setScope("global"); // reset picker off component sections
  }

  // 3b — a click in the preview iframe picks a surface. `group` is the clicked
  // surface's data-component/data-region (which doubles as a section id); `pickScope`
  // is the enclosing region so clicking a button *in the navbar* preselects scope Navbar.
  function handlePick(group: string, pickScope: string) {
    const sec = ALL_SECTIONS.find((s) => s.id === group);
    if (!sec) return;
    setSectionId(group);
    if (sec.kind === "component" && SCOPE_OPTIONS.some((o) => o.id === pickScope)) setScope(pickScope as ThemeScope);
    else setScope("global");
  }

  function bucketHas(s: ThemeScope, cssVar: string): boolean {
    return !!(tokens![mode][s] && cssVar in tokens![mode][s]!);
  }
  function setOverride(s: ThemeScope, cssVar: string, value: string) {
    setTokens((prev) => {
      if (!prev) return prev;
      const buckets = { ...prev[mode] };
      buckets[s] = { ...(buckets[s] ?? {}), [cssVar]: value };
      return { ...prev, [mode]: buckets };
    });
  }
  function clearOverride(s: ThemeScope, cssVar: string) {
    setTokens((prev) => {
      if (!prev) return prev;
      const buckets = { ...prev[mode] };
      const b = { ...(buckets[s] ?? {}) };
      delete b[cssVar];
      if (Object.keys(b).length) buckets[s] = b; else delete buckets[s];
      return { ...prev, [mode]: buckets };
    });
  }

  // Resolved value + override state for a token at the active scope.
  function display(cssVar: string): { value: string; overridden: boolean } {
    if (bucketHas(effScope, cssVar)) return { value: tokens![mode][effScope]![cssVar]!, overridden: true };
    // A component token in a region scope falls back to its global override, then base.
    if (effScope !== "global" && cssVar in globalBucket) return { value: globalBucket[cssVar]!, overridden: false };
    return { value: inheritedValue(cssVar, mode, globalBucket, themeBuckets, effScope), overridden: false };
  }

  // ── Live preview CSS (scoped, mirrors the served stylesheet) ─────────────────
  const previewCss = (() => {
    // Theme first, admin on top — the same order `buildCSS` serves, so the preview cannot
    // show a site that has no theme installed when it does.
    const themeScoped: ScopedTokens = themeTokens?.[mode] ?? {};
    const scoped: ScopedTokens = { ...themeScoped, ...tokens[mode] };
    for (const key of Object.keys(themeScoped)) {
      if (tokens[mode][key]) scoped[key] = { ...themeScoped[key], ...tokens[mode][key] };
    }
    const globalVars = { ...(scoped.global ?? {}), ...extractRootVars(customCss[mode]) };
    const blocks: string[] = [];
    const gDecls = [
      ...Object.entries(globalVars).map(([k, v]) => `  ${k}: ${v} !important;`),
      `  --ff-sans: "${fontFamily}", system-ui, sans-serif !important;`,
      `  --font-body: "${fontFamily}", system-ui, sans-serif !important;`,
      `  --font-display: "${fontFamily}", system-ui, sans-serif !important;`,
    ].join("\n");
    blocks.push(`:root {\n${gDecls}\n}`);
    // The ACP pins fonts to Poppins on <body> (body.nv-acp), which sits closer
    // in the var cascade than :root — re-override there so the font preview
    // stays visible inside the editor. Site-wide = body AND headings.
    blocks.push(`body.nv-acp {\n  --ff-sans: "${fontFamily}", system-ui, sans-serif !important;\n  --font-display: "${fontFamily}", system-ui, sans-serif !important;\n}`);
    for (const [s, map] of Object.entries(scoped)) {
      if (s === "global" || !map) continue;
      const sel = SCOPE_SELECTOR[s as ThemeScope];
      if (!sel) continue;
      const decls = Object.entries(map).map(([k, v]) => `  ${k}: ${v} !important;`).join("\n");
      if (decls.trim()) blocks.push(`${sel} {\n${decls}\n}`);
    }
    blocks.push(`html { font-size: ${fontSize}px !important; }`);
    return blocks.join("\n");
  })();

  // Rows for the active section.
  const registryRows: TokenDef[] = section.group
    ? TOKEN_REGISTRY.filter((t) => t.group === section.group && t.editable)
    : [];

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.appearance")}</div>
          <h1 className="acp-page-title">{t("nav.styleEditor")}</h1>
        </div>
        <div style={{ display:"flex", gap:12, alignItems:"center" }}>
          {draftStatus?.pending && (
            <span style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"3px 10px", borderRadius:100, fontSize:12, fontWeight:700, background:"var(--c-warn-soft, rgba(245,158,11,.14))", color:"var(--c-warn)" }}>
              <FontAwesomeIcon icon={faTriangleExclamation} /> {t("styleEditor.unpublished")}
            </span>
          )}
          <button type="button" className="btn-ghost btn-sm" disabled={resetMut.isPending || saveMut.isPending} onClick={handleReset}>
            <FontAwesomeIcon icon={faRotateLeft} style={{ marginRight:5 }} /> {t("styleEditor.reset")}
          </button>
          <AutosaveStatus saving={saveMut.isPending} />
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={publishMut.isPending || !draftStatus?.pending}
            onClick={() => publishMut.mutate()}
            title={t("styleEditor.publishHint")}
          >
            <FontAwesomeIcon icon={faCloudArrowUp} style={{ marginRight:5 }} />
            {publishMut.isPending ? t("styleEditor.publishing") : t("styleEditor.publishNow")}
          </button>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"232px 1fr", gap:20 }}>

        {/* Sidebar */}
        <div className="acp-card" style={{ padding:16, alignSelf:"start" }}>
          {section.kind !== "customcss" && (
            <>
              <div className="acp-label">{t("styleEditor.modeLabel")}</div>
              <div style={{ display:"flex", gap:6, marginBottom:20 }}>
                {(["light","dark"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)} style={{
                    flex:1, padding:"7px", borderRadius:"var(--radius-sm)", fontSize:12, fontWeight:700,
                    cursor:"pointer", fontFamily:"inherit", textTransform:"capitalize",
                    background: mode===m ? "var(--c-accent)" : "var(--c-card)",
                    color:      mode===m ? "#fff"            : "var(--c-fg-muted)",
                    border:    `1px solid ${mode===m ? "var(--c-accent)" : "var(--c-border)"}`,
                  }}>
                    {m === "light" ? t("styleEditor.modeLight") : t("styleEditor.modeDark")}
                  </button>
                ))}
              </div>
            </>
          )}

          {SECTION_GROUPS.map((grp) => (
            <div key={grp.heading} style={{ marginBottom:10 }}>
              <div className="acp-label" style={{ fontSize:10, letterSpacing:"0.06em", opacity:0.7 }}>{t(grp.heading)}</div>
              {grp.items.map((s) => (
                <button key={s.id} type="button" onClick={() => selectSection(s.id)} style={{
                  display:"block", width:"100%", textAlign:"left", padding:"8px 12px",
                  borderRadius:"var(--radius-sm)", fontSize:13, fontWeight: sectionId===s.id ? 700 : 500,
                  cursor:"pointer", fontFamily:"inherit", marginBottom:2,
                  background: sectionId===s.id ? "var(--c-accent-soft)" : "transparent",
                  color:      sectionId===s.id ? "var(--c-accent)"       : "var(--c-fg-muted)",
                  border:     `1px solid ${sectionId===s.id ? "var(--c-accent-glow)" : "transparent"}`,
                }}>
                  {sectionId===s.id ? "▸ " : ""}{t(s.label)}
                </button>
              ))}
            </div>
          ))}

        </div>

        {/* Editor column (top-right of the grid; preview moves to a full-width row below) */}
        <div style={{ minWidth:0, display:"flex", flexDirection:"column", gap:16 }}>

          {section.kind === "branding" ? (
            <div className="acp-card" style={{ padding:24 }}>
              <div style={{ fontSize:15, fontWeight:800, color:"var(--c-fg)", marginBottom:4 }}>{t("styleEditor.secBranding")}</div>
              <p style={{ fontSize:13, color:"var(--c-fg-muted)", marginBottom:20 }}>
                {t("styleEditor.brandingIntro")}
              </p>
              <div style={{ marginBottom:20 }}>
                <div className="acp-label">{t("styleEditor.logoText")}</div>
                <div style={{ display:"flex", gap:8 }}>
                  <input className="acp-input" value={logoText} onChange={(e) => setLogoText(e.target.value)} placeholder={t("styleEditor.logoPlaceholder")} style={{ flex:1 }} />
                  <button type="button" className="btn-primary btn-sm" onClick={() => saveLogoTextMut.mutate()} disabled={saveLogoTextMut.isPending}>{t("styleEditor.save")}</button>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
                <BrandingSlot label={t("styleEditor.navbarLogo")} hint={t("styleEditor.navbarLogoHint")}
                  currentUrl={branding?.navbarUrl ?? null} accept="image/png,image/svg+xml,image/webp"
                  onUpload={(f) => uploadBrandingMut.mutate({ variant:"navbar", file:f })}
                  onDelete={() => deleteBrandingMut.mutate("navbar")}
                  busy={uploadBrandingMut.isPending || deleteBrandingMut.isPending} />
                <BrandingSlot label={t("styleEditor.favicon")} hint={t("styleEditor.faviconHint")}
                  currentUrl={branding?.iconUrl ?? null} accept="image/png,image/x-icon,image/svg+xml"
                  onUpload={(f) => uploadBrandingMut.mutate({ variant:"icon", file:f })}
                  onDelete={() => deleteBrandingMut.mutate("icon")}
                  busy={uploadBrandingMut.isPending || deleteBrandingMut.isPending} square />
              </div>
            </div>

          ) : section.kind === "customcss" ? (
            <div className="acp-card" style={{ padding:24 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, marginBottom:4 }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:800, color:"var(--c-fg)", marginBottom:4 }}>
                    {t("styleEditor.secCustomCss")}
                    <span style={{ color:"var(--c-accent)", fontSize:13, fontWeight:700, marginLeft:8 }}>· {t("styleEditor.themeSuffix", { theme: t("styleEditor.mode_" + viewedTheme) })}</span>
                  </div>
                  <p style={{ fontSize:13, color:"var(--c-fg-muted)", margin:0, maxWidth:560 }}>
                    {t("styleEditor.cssIntro")}
                  </p>
                </div>
                <button type="button" className="btn-primary btn-sm" onClick={() => saveCustomCssMut.mutate()} disabled={saveCustomCssMut.isPending || !customDirty}>
                  {saveCustomCssMut.isPending ? t("styleEditor.saving") : t("styleEditor.applySave")}
                </button>
              </div>
              <textarea value={activeCss} spellCheck={false}
                onChange={(e) => setCustomCss((p) => ({ ...p, [viewedTheme]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const el = e.currentTarget; const s = el.selectionStart, end = el.selectionEnd;
                    const next = activeCss.slice(0, s) + "  " + activeCss.slice(end);
                    setCustomCss((p) => ({ ...p, [viewedTheme]: next }));
                    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
                  }
                }}
                placeholder={".acp-card {\n  background: #101018;\n}\n\narticle, aside {\n  border-radius: 18px;\n}"}
                style={{
                  width:"100%", minHeight:360, marginTop:16, boxSizing:"border-box",
                  fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  fontSize:13, lineHeight:1.6, tabSize:2, background:"var(--c-bg)", color:"var(--c-fg)",
                  border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", padding:"14px 16px", resize:"vertical", outline:"none",
                }} />
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:8, fontSize:11, color:"var(--c-fg-muted)" }}>
                <span>{customDirty ? t("styleEditor.unsaved") : t("styleEditor.saved")}</span>
                <span>{t("styleEditor.charCount", { count: activeCss.length.toLocaleString() })}</span>
              </div>
            </div>

          ) : (
            <div className="acp-card" style={{ padding:24 }}>
              <div style={{ fontSize:15, fontWeight:800, color:"var(--c-fg)", marginBottom:4 }}>
                {t(section.label)}
                <span style={{ color:"var(--c-fg-muted)", fontSize:13, fontWeight:400, marginLeft:8 }}>· {t("styleEditor.modeMode", { mode: t("styleEditor.mode_" + mode) })}</span>
              </div>

              {/* Scope picker — component sections only (region surfaces are global). */}
              {section.kind === "component" && (
                <div style={{ margin:"14px 0 18px" }}>
                  <div className="acp-label">{t("styleEditor.applyTo")}</div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {SCOPE_OPTIONS.map((o) => (
                      <button key={o.id} type="button" onClick={() => setScope(o.id)} style={{
                        padding:"5px 12px", borderRadius:"var(--radius-pill)", fontSize:12, fontWeight:700,
                        cursor:"pointer", fontFamily:"inherit",
                        background: scope===o.id ? "var(--c-accent-soft)" : "var(--c-card)",
                        color:      scope===o.id ? "var(--c-accent)"       : "var(--c-fg-muted)",
                        border:    `1px solid ${scope===o.id ? "var(--c-accent-glow)" : "var(--c-border)"}`,
                      }}>{t(o.label)}</button>
                    ))}
                  </div>
                  <p style={{ fontSize:11, color:"var(--c-fg-muted)", marginTop:6, lineHeight:1.4 }}>
                    {scope === "global"
                      ? t("styleEditor.editEvery")
                      : t("styleEditor.editOnly", { region: t(SCOPE_OPTIONS.find((o)=>o.id===scope)?.label ?? "") })}
                  </p>
                </div>
              )}

              {section.kind === "text" && (
                <FontControls fontFamily={fontFamily} setFontFamily={setFontFamily} fontWeight={fontWeight} setFontWeight={setFontWeight} fontSize={fontSize} setFontSize={setFontSize} />
              )}

              {/* Semantic palette rows (not in registry) */}
              {(section.kind === "palette" || section.kind === "text" || section.kind === "feedback") &&
                (section.id === "palette" ? PALETTE_ROWS : section.id === "text" ? TEXT_ROWS : FEEDBACK_ROWS).map((row) => {
                  const d = display(row.cssVar);
                  return <ColorControl key={row.cssVar} label={t(row.l)} value={d.value} overridden={d.overridden}
                    onChange={(v) => setOverride("global", row.cssVar, v)} onReset={() => clearOverride("global", row.cssVar)} />;
                })}

              {/* Feedback colors drive the toast system — fire live samples to preview */}
              {section.kind === "feedback" && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--c-border)" }}>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => {
                    toast.success(t("styleEditor.sampleSuccess"));
                    toast.info(t("styleEditor.sampleInfo"));
                    toast.warning(t("styleEditor.sampleWarning"));
                    toast.error(t("styleEditor.sampleError"));
                  }}>
                    {t("styleEditor.previewToasts")}
                  </button>
                  <div style={{ fontSize: 11, color: "var(--c-fg-subtle)", marginTop: 6 }}>
                    {t("styleEditor.toastsUse")}
                  </div>
                </div>
              )}

              {/* Registry-driven region / component rows */}
              {registryRows.map((tok) => {
                const d = display(tok.var);
                const onChange = (v: string) => setOverride(effScope, tok.var, v);
                const onReset  = () => clearOverride(effScope, tok.var);
                if (tok.control === "radius")
                  return <RadiusControl key={tok.var} label={tok.label} value={d.value} overridden={d.overridden} onChange={onChange} onReset={onReset} />;
                if (tok.control === "shadow")
                  return <ShadowControl key={tok.var} label={tok.label} value={d.value} overridden={d.overridden} onChange={onChange} onReset={onReset} />;
                return <ColorControl key={tok.var} label={tok.label} value={d.value} overridden={d.overridden} onChange={onChange} onReset={onReset} />;
              })}
            </div>
          )}
          {/* Live preview stacks below the editor (within the editor column, so it
              aligns under the editor and not under the Mode sidebar). It spans the
              full editor-column width so the real navbar shows all its tabs. */}
          {section.kind !== "branding" && (
            <PreviewFrame
              mode={mode}
              css={previewCss}
              extraCss={cssPreview}
              activeGroup={section.group}
              editingLabel={t(section.label)}
              editingKind={section.kind}
              scopeLabel={section.kind === "component" && scope !== "global"
                ? t(SCOPE_OPTIONS.find((o) => o.id === scope)?.label ?? "")
                : null}
              previewState={previewState}
              setPreviewState={setPreviewState}
              onPick={handlePick}
            />
          )}
        </div>{/* editor column + preview */}
      </div>{/* grid: Mode | Editor */}
    </div>
  );
}

// ── Row controls ────────────────────────────────────────────────────────────────

function RowShell({ label, overridden, onReset, children }: { label: string; overridden: boolean; onReset: () => void; children: React.ReactNode }) {
  const { t } = useTranslation("acp");
  return (
    <div style={{ marginBottom:18 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
        <span className="acp-label" style={{ margin:0 }}>{label}</span>
        {overridden
          ? <button type="button" onClick={onReset} title={t("styleEditor.revertTitle")}
              style={{ fontSize:11, fontWeight:700, color:"var(--c-accent)", background:"none", border:"none", cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4 }}>
              <FontAwesomeIcon icon={faRotateRight} /> {t("styleEditor.reset")}
            </button>
          : <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase", color:"var(--c-fg-subtle)" }}>{t("styleEditor.inherited")}</span>}
      </div>
      {children}
    </div>
  );
}

function ColorControl({ label, value, overridden, onChange, onReset }: { label: string; value: string; overridden: boolean; onChange: (v:string)=>void; onReset: ()=>void }) {
  return (
    <RowShell label={label} overridden={overridden} onReset={onReset}>
      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        <input type="color" value={safeHex(value, "#888888")} onChange={(e) => onChange(e.target.value)}
          style={{ width:40, height:36, border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", cursor:"pointer", padding:2, background:"transparent", flexShrink:0, opacity: overridden ? 1 : 0.85 }} />
        <input className="acp-input" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ width:160, fontFamily:"monospace", fontSize:13 }} placeholder="#rrggbb" />
      </div>
    </RowShell>
  );
}

function RadiusControl({ label, value, overridden, onChange, onReset }: { label: string; value: string; overridden: boolean; onChange: (v:string)=>void; onReset: ()=>void }) {
  const n = numVal(value, 0);
  return (
    <RowShell label={label} overridden={overridden} onReset={onReset}>
      <input type="range" min={0} max={28} value={n} onChange={(e) => onChange(`${e.target.value}px`)}
        style={{ width:"100%", accentColor:"var(--c-accent)", marginBottom:4, opacity: overridden ? 1 : 0.85 }} />
      <div style={{ fontSize:12, color:"var(--c-fg-muted)" }}>{n}px</div>
    </RowShell>
  );
}

function ShadowControl({ label, value, overridden, onChange, onReset }: { label: string; value: string; overridden: boolean; onChange: (v:string)=>void; onReset: ()=>void }) {
  const { t } = useTranslation("acp");
  const preset = SHADOW_PRESETS.find((p) => p.value === value);
  const isCustom = overridden && !preset;
  return (
    <RowShell label={label} overridden={overridden} onReset={onReset}>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom: isCustom ? 8 : 0 }}>
        {SHADOW_PRESETS.map((p) => {
          const on = overridden && preset?.id === p.id;
          return (
            <button key={p.id} type="button" onClick={() => onChange(p.value)} style={{
              padding:"5px 12px", borderRadius:"var(--radius-sm)", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
              background: on ? "var(--c-accent-soft)" : "var(--c-card)",
              color:      on ? "var(--c-accent)"       : "var(--c-fg-muted)",
              border:    `1px solid ${on ? "var(--c-accent-glow)" : "var(--c-border)"}`,
            }}>{t(p.label)}</button>
          );
        })}
      </div>
      {isCustom && (
        <input className="acp-input" value={value} onChange={(e) => onChange(e.target.value)} style={{ width:"100%", fontFamily:"monospace", fontSize:12 }} />
      )}
    </RowShell>
  );
}

// ── Font controls (Text section) ──────────────────────────────────────────────

function FontControls({ fontFamily, setFontFamily, fontWeight, setFontWeight, fontSize, setFontSize }: {
  fontFamily: string; setFontFamily: (v:string)=>void; fontWeight: string; setFontWeight: (v:string)=>void; fontSize: string; setFontSize: (v:string)=>void;
}) {
  const { t } = useTranslation("acp");
  return (
    <>
      <div style={{ marginBottom:20 }}>
        <div className="acp-label">{t("styleEditor.fontFamily")}</div>
        <select className="acp-select" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} style={{ width:"100%" }}>
          {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily:f }}>{f}</option>)}
        </select>
      </div>
      <div style={{ marginBottom:20 }}>
        <div className="acp-label">{t("styleEditor.fontWeight")}</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {FONT_WEIGHTS.map((w) => (
            <button key={w} type="button" onClick={() => setFontWeight(w)} style={{
              padding:"5px 12px", borderRadius:"var(--radius-sm)", fontSize:12, fontWeight: parseInt(w) as React.CSSProperties["fontWeight"],
              cursor:"pointer", fontFamily:"inherit",
              background: fontWeight===w ? "var(--c-accent-soft)" : "var(--c-card)",
              color:      fontWeight===w ? "var(--c-accent)"       : "var(--c-fg-muted)",
              border:    `1px solid ${fontWeight===w ? "var(--c-accent-glow)" : "var(--c-border)"}`,
            }}>{w}</button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom:20 }}>
        <div className="acp-label">{t("styleEditor.fontSize")}</div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <input type="range" min={12} max={20} value={parseInt(fontSize)||16} onChange={(e) => setFontSize(e.target.value)} style={{ flex:1, accentColor:"var(--c-accent)" }} />
          <span style={{ fontSize:12, color:"var(--c-fg-muted)", minWidth:36 }}>{fontSize}px</span>
        </div>
      </div>
      <div style={{ height:1, background:"var(--c-border)", marginBottom:20 }} />
    </>
  );
}

// ── PreviewFrame ──────────────────────────────────────────────────────────────
// Loads the specimen route in a same-origin iframe and injects the draft scoped CSS
// (+ server-scoped custom CSS) so unsaved edits paint live across the real navbar,
// content, footer and component specimens — including per-region component overrides.
//
// 3b — two-way selection:
//  • Click a surface in the iframe → onPick(group, region). The listener is CAPTURE
//    phase on the iframe document, which fires before ThemePreview's `.app-layout`
//    click-suppressor (document is the outermost capture target), so we read the
//    target while navigation stays suppressed.
//  • Selecting a section here outlines + scrolls its representative [data-group].
//  • The preview-state toggle forces hover/focus on the specimen via injected CSS so
//    state-only tokens (menu hover bg, field focus border) are editable.

const REGION_IDS = ["navbar", "content", "footer", "aside"];

function PreviewFrame({ mode, css, extraCss, activeGroup, editingLabel, editingKind, scopeLabel, previewState, setPreviewState, onPick }: {
  mode: Mode; css: string; extraCss: string; activeGroup?: string;
  editingLabel: string; editingKind: SectionKind; scopeLabel: string | null;
  previewState: PreviewState; setPreviewState: (s: PreviewState) => void;
  onPick: (group: string, scope: string) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const onPickRef = useRef(onPick); onPickRef.current = onPick;
  const prevGroup = useRef<string | undefined>(undefined);

  // Inject token + overlay styles whenever inputs change; scroll to the active group
  // only when it actually changes (not on every keystroke edit).
  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const apply = () => {
      const doc = iframe.contentDocument;
      if (!doc || !doc.head) return;
      doc.documentElement.setAttribute("data-theme", mode);

      let tok = doc.getElementById("nodevo-preview-tokens") as HTMLStyleElement | null;
      if (!tok) { tok = doc.createElement("style"); tok.id = "nodevo-preview-tokens"; doc.head.appendChild(tok); }
      tok.textContent = `${css}\n${extraCss}`;

      let ov = doc.getElementById("nodevo-preview-overlay") as HTMLStyleElement | null;
      if (!ov) { ov = doc.createElement("style"); ov.id = "nodevo-preview-overlay"; doc.head.appendChild(ov); }
      const rules: string[] = [];
      if (activeGroup) rules.push(`[data-group="${activeGroup}"]{outline:2px solid var(--c-accent);outline-offset:3px;border-radius:4px;}`);
      if (previewState === "hover") rules.push(`.tp-menu__item{background:var(--menu-item-hover-bg)!important;}`);
      if (previewState === "focus") rules.push(`.tp-field{border-color:var(--input-border-focus)!important;box-shadow:0 0 0 3px var(--c-accent-soft)!important;}`);
      ov.textContent = rules.join("\n");

      if (activeGroup && activeGroup !== prevGroup.current) {
        doc.querySelector(`[data-group="${activeGroup}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      prevGroup.current = activeGroup;
    };
    apply();
    iframe.addEventListener("load", apply);
    return () => iframe.removeEventListener("load", apply);
  }, [mode, css, extraCss, activeGroup, previewState]);

  // Capture-phase click-to-select on the iframe document (attached once per load).
  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let boundDoc: Document | null = null;
    const handler = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest) return;
      const reg = t.closest("[data-region]");
      const regionId = reg?.getAttribute("data-region") ?? "global";
      const scope = REGION_IDS.includes(regionId) ? regionId : "global";
      const comp = t.closest("[data-component]");
      if (comp) { onPickRef.current(comp.getAttribute("data-component")!, scope); return; }
      // A real (untagged) native form control is a Field — e.g. the live navbar's
      // search box. Map it to the Field component scoped to its region, instead of
      // falling through and selecting the enclosing region.
      if (t.closest("input, select, textarea")) { onPickRef.current("field", scope); return; }
      if (reg) onPickRef.current(regionId, "global");
    };
    const attach = () => {
      const doc = iframe.contentDocument;
      if (!doc || doc === boundDoc) return;
      boundDoc?.removeEventListener("click", handler, true);
      doc.addEventListener("click", handler, true);
      boundDoc = doc;
    };
    attach();
    iframe.addEventListener("load", attach);
    return () => {
      iframe.removeEventListener("load", attach);
      boundDoc?.removeEventListener("click", handler, true);
    };
  }, []);

  const { t } = useTranslation("acp");
  const kindLabel: Record<SectionKind, string> = {
    palette: "styleEditor.kPalette", text: "styleEditor.kPalette", feedback: "styleEditor.kPalette",
    region: "styleEditor.kRegion", component: "styleEditor.kComponent", branding: "styleEditor.secBranding", customcss: "styleEditor.secCustomCss",
  };

  return (
    <div style={{ width: "100%" }}>
      {/* Toolbar — tells the admin exactly what surface their edits target */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        padding: "8px 12px", background: "var(--c-card)", border: "1px solid var(--c-border)", borderBottom: "none",
        borderRadius: "var(--radius-md) var(--radius-md) 0 0",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--c-fg-subtle)" }}>
            {t("styleEditor.editing")}
          </span>
          {/* Active section chip */}
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 11px", borderRadius: "var(--radius-pill)",
            background: "var(--c-accent-soft)", color: "var(--c-accent)", border: "1px solid var(--c-accent-glow)",
            fontSize: 12.5, fontWeight: 700,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--c-accent)" }} />
            {editingLabel}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--c-fg-subtle)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {t(kindLabel[editingKind])}
          </span>
          {/* Scope chip — only when a component is scoped to a specific region */}
          {scopeLabel && (
            <>
              <span style={{ fontSize: 11, color: "var(--c-fg-subtle)" }}>{t("styleEditor.in")}</span>
              <span style={{
                padding: "3px 10px", borderRadius: "var(--radius-pill)", background: "var(--c-card)",
                border: "1px solid var(--c-border)", color: "var(--c-fg-muted)", fontSize: 12, fontWeight: 700,
              }}>{scopeLabel}</span>
            </>
          )}
          <span style={{ fontSize: 11, color: "var(--c-fg-subtle)", marginLeft: 2 }}>· {t("styleEditor.modeMode", { mode: t("styleEditor.mode_" + mode) })}</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {PREVIEW_STATES.map((s) => (
            <button key={s.id} type="button" onClick={() => setPreviewState(s.id)} title={t("styleEditor.forceState")} style={{
              padding: "3px 9px", borderRadius: "var(--radius-sm)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              background: previewState === s.id ? "var(--c-accent-soft)" : "transparent",
              color:      previewState === s.id ? "var(--c-accent)"       : "var(--c-fg-muted)",
              border:    `1px solid ${previewState === s.id ? "var(--c-accent-glow)" : "var(--c-border)"}`,
            }}>{t(s.label)}</button>
          ))}
        </div>
      </div>
      <div style={{ borderRadius: "0 0 var(--radius-md) var(--radius-md)", overflow: "hidden", border: "1px solid var(--c-border)", boxShadow: "var(--shadow-card)", background: "var(--c-bg)" }}>
        <iframe ref={ref} src="/__theme-preview" title={t("styleEditor.previewTitle")}
          style={{ width: "100%", height: 600, border: "none", display: "block" }} />
      </div>
      <p style={{ fontSize: 11, color: "var(--c-fg-muted)", marginTop: 8, lineHeight: 1.4 }}>
        {t("styleEditor.previewHint")}
      </p>
    </div>
  );
}

// ── BrandingSlot ──────────────────────────────────────────────────────────────

function BrandingSlot({ label, hint, currentUrl, accept, onUpload, onDelete, busy, square }: {
  label: string; hint: string; currentUrl: string | null; accept: string;
  onUpload: (f: File) => void; onDelete: () => void; busy: boolean; square?: boolean;
}) {
  const { t } = useTranslation("acp");
  const inputRef = useRef<HTMLInputElement>(null);
  const previewH = square ? 64 : 40;
  return (
    <div>
      <div className="acp-label">{label}</div>
      <div style={{ background:"var(--c-surface)", border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", padding:16, display:"flex", flexDirection:"column", gap:12 }}>
        <div style={{ height:previewH+16, display:"flex", alignItems:"center", justifyContent:"center", background:"var(--c-bg)", borderRadius:"var(--radius-sm)", border:"1px solid var(--c-border)" }}>
          {currentUrl
            ? <img src={currentUrl} alt={label} style={{ maxHeight:previewH, maxWidth:"100%", objectFit:"contain" }} />
            : <span style={{ fontSize:11, color:"var(--c-fg-muted)" }}>{t("styleEditor.noImage")}</span>}
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button type="button" className="btn-ghost btn-sm" style={{ flex:1 }} disabled={busy} onClick={() => inputRef.current?.click()}>
            <FontAwesomeIcon icon={faUpload} style={{ marginRight:5 }} /> {t("styleEditor.upload")}
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

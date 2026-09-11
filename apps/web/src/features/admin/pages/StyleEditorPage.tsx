import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../../components/Icon";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faXmark, faRotateLeft, faRotateRight, faCloudArrowUp, faSun, faMoon,
  faMagnifyingGlass, faSliders, faObjectGroup, faArrowTurnDown,
  faArrowUp, faArrowDown, faArrowLeft, faArrowRight,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { looksLikeKit } from "../../../lib/iconKit";
import { toast } from "../../../lib/toast";
import { useAutosave } from "../../../hooks/useAutosave";
import { AutosaveStatus } from "../../../components/AutosaveStatus";
import { refreshTokenCss } from "../../../lib/liveStyle";
import { useTheme } from "../../../hooks/useTheme";
import { StyleHistoryList } from "../components/StyleHistoryList";
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
  FONT_FAMILIES,
  fontRootDecls,
  fontBodyRule,
} from "@nodevo/contracts";
import {
  SECTIONS, SECTION_BY_ID, BOARD, SCOPE_OPTIONS, SCOPE_LABEL, tokenLabel,
  type Section,
} from "./styleTokens";
import {
  parseShadow, formatShadow, shadowValueFor, SHADOW_SEED,
  type ShadowKind, type ShadowParts,
} from "./shadowValue";
import "./StyleEditorPage.scss";
import { ICON_STYLE_DEFS, iconStyleDef, type IconStyleGroup } from "@nodevo/contracts";

const CUSTOM_CSS_PREVIEW_ID = "nodevo-custom-css-preview";

type Mode = "light" | "dark";
type Tab = "tokens" | "branding" | "css" | "history";

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

// Where the inheritance chain ENDS. Two kinds of token land here:
//
//  • radius long-hands, which have no HEARTH default and no `inheritsFrom`, so the
//    slider needs a starting position;
//  • terminal `inheritsFrom` targets that `tokens.scss` defines but
//    HEARTH_DEFAULT_TOKENS does not, because they are not themselves editable
//    (`--c-on-accent`, `--shadow-card`).
//
// Without the second group a row resolves to the empty string and renders its
// placeholder — "Button text" showed `#rrggbb` rather than white. `styleTokens.test.ts`
// fails if a new `inheritsFrom` target has no resolution here or in the contract.
export const BASE_FALLBACK: Record<string, string> = {
  "--btn-radius": "10px", "--card-radius": "18px", "--input-radius": "14px", "--menu-radius": "14px",
  // The rail widths, which `_tokenDefaults.scss` defines and no HEARTH token does —
  // without a starting position the slider sits at 0 and reads as "no rail".
  "--rail-width": "260px", "--sidebar-width": "248px",
  "--c-on-accent": "#ffffff",
  // The Soft preset's own value, so an untouched card shadow reads as Soft rather
  // than as nothing selected.
  "--shadow-card": "var(--shadow-card)",
};

// 3b — "preview state" forces a state on the specimen so token states you can't
// hover-click (menu hover bg, field focus border) are editable. Only the states
// that have registry tokens are offered.
type PreviewState = "base" | "hover" | "focus";
const PREVIEW_STATES: { id: PreviewState; label: string }[] = [
  { id: "base",  label: "styleEditor.stBase" },
  { id: "hover", label: "styleEditor.stHover" },
  { id: "focus", label: "styleEditor.stFocus" },
];

const FONTS = FONT_FAMILIES;
const FONT_WEIGHTS = ["300", "400", "500", "600", "700", "800"] as const;
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 20;

const FONT_SETTING_KEY    = "appearance.font.family";
const FSIZE_SETTING_KEY   = "appearance.font.size";
const FWEIGHT_SETTING_KEY = "appearance.font.weight";

// The kinds the shadow control offers, in order. `raw` is not offered — it is only
// reached by a value the controls cannot represent, and then edited as text.
const SHADOW_KINDS: { id: Exclude<ShadowKind, "raw">; label: string }[] = [
  { id: "none",   label: "styleEditor.shNone" },
  { id: "soft",   label: "styleEditor.shSoft" },
  { id: "strong", label: "styleEditor.shStrong" },
  { id: "custom", label: "styleEditor.shCustom" },
];

const SHADOW_SIDES: { key: "top" | "bottom" | "left" | "right"; label: string; icon: IconDefinition }[] = [
  { key: "top",    label: "styleEditor.shTop",    icon: faArrowUp },
  { key: "bottom", label: "styleEditor.shBottom", icon: faArrowDown },
  { key: "left",   label: "styleEditor.shLeft",   icon: faArrowLeft },
  { key: "right",  label: "styleEditor.shRight",  icon: faArrowRight },
];

const TABS: { id: Tab; label: string }[] = [
  { id: "tokens",   label: "styleEditor.tabTokens" },
  { id: "branding", label: "styleEditor.secBranding" },
  { id: "css",      label: "styleEditor.secCustomCss" },
  { id: "history",  label: "styleEditor.tabHistory" },
];

function numVal(v: string | undefined, fallback: number): number {
  const n = parseFloat(v ?? "");
  return isNaN(n) ? fallback : n;
}
function safeHex(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}
/** A value the browser can paint as a swatch, or nothing. */
function swatchOf(v: string): string {
  return /^(#|rgb|hsl|color-mix)/i.test(v.trim()) ? v : "transparent";
}

/** How a token's value was arrived at — what the row's tag and chain report. */
type Origin = "own" | "global" | "theme" | "inherited";

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
): { value: string; origin: Origin; from?: string } {
  const fromTheme = themeBuckets[scope]?.[cssVar] ?? themeBuckets.global?.[cssVar];
  if (fromTheme !== undefined) return { value: fromTheme, origin: "theme" };
  const def = (DEFAULTS[mode] as TokenMap)[cssVar];
  if (def !== undefined) {
    const own = globalBucket[cssVar];
    return own !== undefined ? { value: own, origin: "global" } : { value: def, origin: "inherited" };
  }
  const reg: TokenDef | undefined = TOKEN_BY_VAR[cssVar];
  if (reg?.inheritsFrom) {
    const up = inheritedValue(reg.inheritsFrom, mode, globalBucket, themeBuckets, scope);
    // The chain names the token this one falls back to, not wherever that one
    // ultimately resolved — "--btn-bg ← --c-accent" is what an admin can act on.
    return { value: up.value, origin: up.origin === "own" ? "inherited" : up.origin, from: reg.inheritsFrom };
  }
  const base = BASE_FALLBACK[cssVar];
  if (base !== undefined) return { value: base, origin: "inherited" };
  return { value: "", origin: "inherited" };
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

/** Every editable token a section owns — palette rows or registry rows. */
function sectionVars(section: Section): string[] {
  if (section.rows) return section.rows.map((r) => r.cssVar);
  return TOKEN_REGISTRY.filter((tok) => tok.group === section.group && tok.editable).map((tok) => tok.var);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function StyleEditorPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(
    () => (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
  );
  // The tab lives in the URL so it can be linked and survives a refresh — and so
  // the retired `/admin/style-history` route can redirect straight to History
  // rather than dropping you on Tokens.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(
    () => (TABS.some((x) => x.id === tabParam) ? (tabParam as Tab) : "tokens"),
  );
  const selectTab = (next: Tab) => {
    setTab(next);
    // Tokens is the default, so it stays out of the URL; `replace` keeps tab
    // switching out of the back button's history.
    const params = new URLSearchParams(searchParams);
    if (next === "tokens") params.delete("tab"); else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };
  const [sectionId, setSectionId] = useState(SECTIONS[0]!.id);
  const [scope, setScope] = useState<ThemeScope>("global");
  const [previewState, setPreviewState] = useState<PreviewState>("base");
  const [hotspots, setHotspots] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
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

  /**
   * The installed theme's own stylesheet, which sits UNDER this editor's content.
   *
   * Read separately and never merged into the textarea: this console saves back exactly
   * what it shows, so editing a merged blob would store the theme's CSS as the admin's
   * own and the next theme update would have nothing left to inherit. Same rule, and the
   * same reason, as the token editor's `theme` field.
   */
  const [themeCss, setThemeCss] = useState<Record<Mode, string>>({ light: "", dark: "" });

  useEffect(() => {
    api.get<{ light?: string; dark?: string; theme?: { light?: string; dark?: string } }>("/appearance/custom-css")
      .then((r) => {
        const next = { light: r?.light ?? "", dark: r?.dark ?? "" };
        setCustomCss(next); setCustomCssSaved(next);
        setThemeCss({ light: r?.theme?.light ?? "", dark: r?.theme?.dark ?? "" });
      })
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
      iconKitUrl?: string | null;
      iconStyle?: string | null;
  }>({ queryKey: ["acp-branding"], queryFn: () => api.get("/appearance/branding") });

  const [logoText, setLogoText] = useState("");
  useEffect(() => { if (branding !== undefined) setLogoText(branding?.logoText ?? ""); }, [branding?.logoText]);
  const [iconKit, setIconKit] = useState("");
  useEffect(() => { if (branding !== undefined) setIconKit(branding?.iconKitUrl ?? ""); }, [branding?.iconKitUrl]);

  /**
   * ⚠ Its own endpoint, not the generic settings PUT. The value becomes a
   * `<script src>` for every visitor, so the server validates it against a host
   * allowlist and rebuilds the URL rather than storing what was typed.
   */
  const saveIconStyleMut = useMutation({
    mutationFn: (style: string) => api.put("/appearance/branding/icon-style", { style }),
    onSuccess:  () => {
      refetchBranding();
      qc.invalidateQueries({ queryKey: ["pub-branding"] });
      swalToast(t("styleEditor.toastIconStyle"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const saveIconKitMut = useMutation({
    mutationFn: () => {
      // ⚠ Checked here so the message can be specific. The server refuses the same
      // shapes, but may only answer with a NEC code, which renders as the generic
      // "check your input" — useless to an admin who pasted a real id from the
      // wrong place.
      if (iconKit.trim() && !looksLikeKit(iconKit)) {
        return Promise.reject(new Error(t("styleEditor.iconKitInvalid")));
      }
      return api.put("/appearance/branding/icon-kit", { kit: iconKit });
    },
    onSuccess:  () => {
      refetchBranding();
      qc.invalidateQueries({ queryKey: ["pub-branding"] });
      swalToast(t("styleEditor.toastIconKit"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

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
      // Only what actually changed. The three font settings are INDEPENDENT rows, and
      // writing all of them on every token edit is the same defect this page's sibling
      // had: an editor left open holds the font it loaded, so recolouring a button
      // wrote that stale font back over whoever changed it since. Tokens are one
      // setting holding the whole sparse draft, so that one is written whole.
      const snap = savedSnap;
      const writes: Promise<unknown>[] = [api.put("/appearance/tokens", tokens)];
      if (snap?.fontFamily !== fontFamily) writes.push(api.put(`/admin/settings/${FONT_SETTING_KEY}`,    { value: fontFamily }));
      if (snap?.fontSize   !== fontSize)   writes.push(api.put(`/admin/settings/${FSIZE_SETTING_KEY}`,   { value: fontSize   }));
      if (snap?.fontWeight !== fontWeight) writes.push(api.put(`/admin/settings/${FWEIGHT_SETTING_KEY}`, { value: fontWeight }));
      await Promise.all(writes);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-style-history"] });
      qc.invalidateQueries({ queryKey: ["acp-draft-status"] });
      // No global injection here: the draft is previewed only in the scoped preview
      // iframe (previewCss). Injecting into the ACP's own <head> would restyle the
      // ACP you're working in with unpublished changes. The ACP keeps showing the
      // published theme until Publish (which calls refreshTokenCss).
      setSavedSnap(draftRef.current);
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
      setShowDiff(false);
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

  const section = SECTION_BY_ID[sectionId] ?? SECTIONS[0]!;
  const globalBucket = tokens[mode].global ?? {};
  /** What the installed theme defines — the layer under the admin's own edits. */
  const themeBuckets: ScopedTokens = themeTokens?.[mode] ?? {};

  // The scope a section edits: regions + palette → global; components → the picker.
  //
  // ⚠ Region tokens go in `global`, NOT in their own scope bucket, even though a
  // bucket exists for them. `--nav-bg` is consumed only by `.pub-nav`, so `:root`
  // and `.pub-nav` render identically — while every install that has ever set a
  // navbar colour has it stored under `global`. Reading the region bucket instead
  // would show those existing overrides as "Inherited" and write a second copy.
  const effScope: ThemeScope = section.kind === "component" ? scope : "global";

  function selectSection(id: string) {
    setSectionId(id);
    const next = SECTION_BY_ID[id];
    if (next?.kind !== "component") setScope("global"); // reset picker off component sections
  }

  // 3b — a click in the preview iframe picks a surface. `group` is the clicked
  // surface's data-component/data-region (which doubles as a section id); `pickScope`
  // is the enclosing region so clicking a button *in the navbar* preselects scope Navbar.
  function handlePick(group: string, pickScope: string) {
    const sec = SECTION_BY_ID[group];
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

  // Resolved value + where it came from, at the active scope.
  function display(cssVar: string, atScope: ThemeScope = effScope): { value: string; origin: Origin; from?: string } {
    if (bucketHas(atScope, cssVar)) return { value: tokens![mode][atScope]![cssVar]!, origin: "own" };
    // A component token in a region scope falls back to its global override, then base.
    if (atScope !== "global" && cssVar in globalBucket) return { value: globalBucket[cssVar]!, origin: "global" };
    return inheritedValue(cssVar, mode, globalBucket, themeBuckets, atScope);
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
    // The font comes from the SAME builders the API serves with (@nodevo/contracts),
    // so the preview cannot render a font the site will not. It previously hand-rolled
    // its own stack, skipped the weight entirely, and sized the page with
    // `html { font-size }` — which rescales every rem, something production never does.
    const font = { family: fontFamily, weight: fontWeight, size: fontSize };
    const gDecls = [
      ...Object.entries(globalVars).map(([k, v]) => `  ${k}: ${v} !important;`),
      ...fontRootDecls(font).map((d) => d.replace(/;$/, " !important;")),
    ].join("\n");
    blocks.push(`:root {\n${gDecls}\n}`);
    for (const [s, map] of Object.entries(scoped)) {
      if (s === "global" || !map) continue;
      const sel = SCOPE_SELECTOR[s as ThemeScope];
      if (!sel) continue;
      const decls = Object.entries(map).map(([k, v]) => `  ${k}: ${v} !important;`).join("\n");
      if (decls.trim()) blocks.push(`${sel} {\n${decls}\n}`);
    }
    // Applied exactly as the served stylesheet applies it. NOT to `body.nv-acp`:
    // this CSS goes into the preview iframe, which is the SITE — the admin panel
    // deliberately keeps its own type and must not follow the site font.
    const bodyRule = fontBodyRule(font);
    if (bodyRule) blocks.push(bodyRule.replace(/;$/gm, " !important;"));
    return blocks.join("\n");
  })();

  // ── Draft accounting ────────────────────────────────────────────────────────
  // Counted per mode so the switch can say there is work waiting on the side you
  // are not looking at.
  const countMode = (m: Mode) =>
    Object.values(tokens![m]).reduce((n, bucket) => n + Object.keys(bucket ?? {}).length, 0);
  const lightCount = countMode("light");
  const darkCount  = countMode("dark");
  const totalCount = lightCount + darkCount;

  const diffRows = (["light", "dark"] as const).flatMap((m) =>
    Object.entries(tokens![m]).flatMap(([sc, bucket]) =>
      Object.entries(bucket ?? {}).map(([cssVar, value]) => ({
        key: `${m}|${sc}|${cssVar}`,
        label: tokenLabel(cssVar, t),
        where: `${t(SCOPE_LABEL[sc] ?? sc)} · ${t("styleEditor.mode_" + m)}`,
        value,
      })),
    ),
  );

  // Rows for the active section.
  const rowVars = sectionVars(section);
  const setHere = rowVars.filter((v) => bucketHas(effScope, v)).length;

  // Scopes this section's tokens are already set in — the answer to "why does the
  // navbar look different?" without hunting through the picker.
  const scopeMarks = section.kind === "component"
    ? SCOPE_OPTIONS
        .map((o) => ({ id: o.id, n: rowVars.filter((v) => bucketHas(o.id, v)).length }))
        .filter((m) => m.n > 0)
    : [];

  return (
    <div className="se-page">
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.appearance")}</div>
          <h1 className="acp-page-title">{t("nav.styleEditor")}</h1>
        </div>

        <div className="se-actions">
          {/* State first, on its own line: what is unsaved and what is unpublished are
              readings, not controls. Sharing a row with the buttons that act on them
              made the header a wall of chips where nothing said which was which. */}
          <div className="se-actions__state">
            {(draftStatus?.pending || totalCount > 0) && (
              <div className="se-draft">
                <span className="se-draft__state"><span className="se-draft__dot" />{t("styleEditor.draft")}</span>
                <span className="se-draft__count">{t("styleEditor.unpublishedN", { count: totalCount })}</span>
                <button type="button" className="se-draft__btn" onClick={() => setShowDiff((v) => !v)} disabled={totalCount === 0}>
                  {showDiff ? t("styleEditor.diffHide") : t("styleEditor.diffReview")}
                </button>
              </div>
            )}
            <AutosaveStatus saving={saveMut.isPending} />
          </div>

          <div className="se-actions__row">
            {/* Only the Tokens tab reads `mode`. Branding has no per-theme values, and
                the Custom CSS console follows the ACP's OWN theme (`viewedTheme`), so
                the switch would be a control that does nothing on either. */}
            {tab === "tokens" && (
              <>
                <div className="se-modes">
                  {(["light", "dark"] as const).map((m) => (
                    <button key={m} type="button" className={`se-mode${mode === m ? " is-on" : ""}`} onClick={() => setMode(m)}>
                      <FontAwesomeIcon icon={m === "light" ? faSun : faMoon} />
                      {m === "light" ? t("styleEditor.modeLight") : t("styleEditor.modeDark")}
                      <span className="se-mode__n">{m === "light" ? lightCount : darkCount}</span>
                    </button>
                  ))}
                </div>
                <span className="se-sep" />
              </>
            )}

            <button type="button" className="btn-ghost se-act" disabled={resetMut.isPending || saveMut.isPending} onClick={handleReset}>
              <FontAwesomeIcon icon={faRotateLeft} /> {t("styleEditor.resetAll")}
            </button>

            <button
              type="button"
              className="btn-primary se-act se-act--go"
              disabled={publishMut.isPending || !draftStatus?.pending}
              onClick={() => publishMut.mutate()}
              title={t("styleEditor.publishHint")}
            >
              <FontAwesomeIcon icon={faCloudArrowUp} />
              {publishMut.isPending ? t("styleEditor.publishing") : t("styleEditor.publishNow")}
            </button>
          </div>
        </div>
      </div>

      {showDiff && totalCount > 0 && (
        <div className="se-diff">
          <div className="se-diff__head">
            <div className="se-diff__title">{t("styleEditor.diffTitle")}</div>
            <button type="button" className="se-diff__close" onClick={() => setShowDiff(false)}>{t("styleEditor.close")}</button>
          </div>
          <div className="se-diff__grid">
            {diffRows.map((d) => (
              <div key={d.key} className="se-diff__row">
                <span className="se-diff__sw" style={{ background: swatchOf(d.value) }} />
                <span className="se-diff__label">{d.label}</span>
                <span className="se-diff__where">{d.where}</span>
                <code className="se-diff__val">{d.value}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="se-tabs">
        {TABS.map((x) => (
          <button key={x.id} type="button" className={`se-tab${tab === x.id ? " is-on" : ""}`} onClick={() => selectTab(x.id)}>
            {t(x.label)}
          </button>
        ))}
      </div>

      {tab === "tokens" && (
        <>
          {/* ── Palette board — the site's colours, visible without opening anything ── */}
          <div className="se-board">
            {BOARD.map((cluster) => (
              <div className="se-cluster" key={cluster.heading}>
                <div className="se-cluster__h">{t(cluster.heading)}</div>
                <div className="se-cluster__tiles">
                  {cluster.tiles.map((tile) => {
                    const d = display(tile.cssVar, "global");
                    const on = sectionId === tile.section;
                    return (
                      <button
                        key={tile.cssVar}
                        type="button"
                        className={`se-tile${on ? " is-on" : ""}`}
                        onClick={() => { selectSection(tile.section); selectTab("tokens"); }}
                      >
                        <span className="se-tile__sw" style={{ background: swatchOf(d.value) }}>
                          {d.origin === "own" && <span className="se-tile__dot" />}
                        </span>
                        <span className="se-tile__label">{tokenLabel(tile.cssVar, t)}</span>
                        <code className="se-tile__val">{d.value}</code>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Typography is a palette decision, so it sits with the palette. */}
            <div className="se-type">
              <div className="se-cluster__h">{t("styleEditor.clType")}</div>
              <div className="se-type__body">
                <div className="se-type__aa" style={{ fontFamily: `"${fontFamily}", system-ui, sans-serif`, fontWeight: Number(fontWeight) }}>Aa</div>
                <div className="se-type__col">
                  <div className="se-type__row">
                    <select className="se-type__select" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} aria-label={t("styleEditor.fontFamily")}>
                      {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                    </select>
                    <div className="se-step">
                      <button type="button" aria-label={t("styleEditor.fontSmaller")}
                        disabled={numVal(fontSize, 16) <= FONT_SIZE_MIN}
                        onClick={() => setFontSize(String(Math.max(FONT_SIZE_MIN, numVal(fontSize, 16) - 1)))}>−</button>
                      <span className="se-step__v">{numVal(fontSize, 16)}px</span>
                      <button type="button" aria-label={t("styleEditor.fontBigger")}
                        disabled={numVal(fontSize, 16) >= FONT_SIZE_MAX}
                        onClick={() => setFontSize(String(Math.min(FONT_SIZE_MAX, numVal(fontSize, 16) + 1)))}>+</button>
                    </div>
                  </div>
                  <div className="se-weights">
                    {FONT_WEIGHTS.map((w) => (
                      <button key={w} type="button" className={`se-weight${fontWeight === w ? " is-on" : ""}`}
                        style={{ fontWeight: Number(w) as React.CSSProperties["fontWeight"] }}
                        onClick={() => setFontWeight(w)}>{w}</button>
                    ))}
                  </div>
                  <div className="se-type__hint">{t("styleEditor.fontScope")}</div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Canvas + inspector ───────────────────────────────────────────── */}
          <div className="se-work">
            <PreviewFrame
              mode={mode}
              css={previewCss}
              extraCss={cssPreview}
              activeGroup={section.id}
              hotspots={hotspots}
              setHotspots={setHotspots}
              previewState={previewState}
              setPreviewState={setPreviewState}
              onPick={handlePick}
            />

            <div className="se-insp">
              <div className="se-insp__head">
                <div className="se-insp__top">
                  <div className="se-insp__id">
                    <span className="se-insp__icon"><FontAwesomeIcon icon={faSliders} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div className="se-insp__title">{t(section.label)}</div>
                      <div className="se-insp__kind">
                        {t(`styleEditor.k${section.kind === "component" ? "Component" : section.kind === "region" ? "Region" : "Palette"}`)}
                        {section.kind === "component" && ` · ${t(SCOPE_LABEL[scope] ?? scope)}`}
                      </div>
                    </div>
                  </div>
                  <button type="button" className="se-chip se-chip--icon" onClick={() => setJumpOpen((v) => !v)}>
                    <FontAwesomeIcon icon={faMagnifyingGlass} /> {t("styleEditor.jumpTo")}
                  </button>
                </div>

                {jumpOpen && (
                  <div className="se-jump">
                    {SECTIONS.map((s) => (
                      <button key={s.id} type="button" className={`se-chip${s.id === sectionId ? " is-on" : ""}`}
                        onClick={() => { selectSection(s.id); setJumpOpen(false); }}>
                        {t(s.label)}
                      </button>
                    ))}
                  </div>
                )}

                {section.kind === "component" && (
                  <div className="se-scope">
                    <div className="se-scope__row">
                      <span className="se-scope__lab">{t("styleEditor.applyTo")}</span>
                      <select className="se-scope__select" value={scope} onChange={(e) => setScope(e.target.value as ThemeScope)}>
                        {SCOPE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{t(o.label)}</option>)}
                      </select>
                    </div>
                    <p className="se-scope__sentence">
                      {scope === "global"
                        ? t("styleEditor.editEvery")
                        : t("styleEditor.editOnly", { region: t(SCOPE_LABEL[scope] ?? scope) })}
                    </p>
                    {scopeMarks.length > 0 && (
                      <div className="se-scope__marks">
                        <span className="se-scope__marksLab">{t("styleEditor.alreadySetIn")}</span>
                        {scopeMarks.map((m) => (
                          <button key={m.id} type="button" className={`se-chip${m.id === scope ? " is-on" : ""}`} onClick={() => setScope(m.id)}>
                            {t(SCOPE_LABEL[m.id] ?? m.id)} · {m.n}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="se-rows">
                {rowVars.map((cssVar) => {
                  const d = display(cssVar);
                  const def = TOKEN_BY_VAR[cssVar];
                  return (
                    <TokenRow
                      key={cssVar}
                      label={tokenLabel(cssVar, t)}
                      cssVar={cssVar}
                      value={d.value}
                      origin={d.origin}
                      inheritsFrom={d.from ?? def?.inheritsFrom}
                      control={def?.control === "radius" ? "radius"
                        : def?.control === "shadow" ? "shadow"
                        : def?.control === "size" ? "size" : "color"}
                      min={def?.min}
                      max={def?.max}
                      mode={mode}
                      onChange={(v) => setOverride(effScope, cssVar, v)}
                      onReset={() => clearOverride(effScope, cssVar)}
                    />
                  );
                })}

                {/* Feedback colours drive the toast system — fire live samples to preview. */}
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
              </div>

              <div className="se-insp__foot">
                <span className="se-insp__summary">
                  {t("styleEditor.setHere", { set: setHere, total: rowVars.length, mode: t("styleEditor.mode_" + mode) })}
                </span>
                {setHere > 0 && (
                  <button type="button" className="se-insp__revert"
                    onClick={() => rowVars.forEach((v) => clearOverride(effScope, v))}>
                    {t("styleEditor.revertGroup")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "branding" && (
        <div className="se-brand">
          <div>
            <div className="se-brand__h">{t("styleEditor.logoText")}</div>
            <p className="se-brand__p">{t("styleEditor.logoTextHint")}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="se-brand__input" value={logoText} onChange={(e) => setLogoText(e.target.value)}
                placeholder={t("styleEditor.logoPlaceholder")} />
              <button type="button" className="btn-primary btn-sm" onClick={() => saveLogoTextMut.mutate()} disabled={saveLogoTextMut.isPending}>
                {t("styleEditor.save")}
              </button>
            </div>
            <div className="se-brand__specimen">
              <span className="se-brand__mark" />
              <span className="se-brand__word">{logoText || t("styleEditor.logoPlaceholder")}</span>
            </div>
          </div>

          <div>
            <div className="se-brand__h">{t("styleEditor.iconKit")}</div>
            <p className="se-brand__p">{t("styleEditor.iconKitHint")}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="se-brand__input" value={iconKit} onChange={(e) => setIconKit(e.target.value)}
                placeholder={t("styleEditor.iconKitPlaceholder")} spellCheck={false} />
              <button type="button" className="btn-primary btn-sm" onClick={() => saveIconKitMut.mutate()} disabled={saveIconKitMut.isPending}>
                {t("styleEditor.save")}
              </button>
            </div>
            <p className="se-brand__p">{t("styleEditor.iconKitLicence")}</p>

            <div className="se-brand__h" style={{ marginTop: "var(--sp-4)" }}>{t("styleEditor.iconStyle")}</div>
            {/* ⚠ Only meaningful with a kit: every style but Solid is Pro, and naming
                one with no kit loaded would emit a class nothing defines. The select
                is disabled rather than hidden so the capability is discoverable. */}
            <p className="se-brand__p">{t("styleEditor.iconStyleHint")}</p>
            <select
              className="se-brand__input"
              value={branding?.iconStyle ?? "solid"}
              disabled={!branding?.iconKitUrl || saveIconStyleMut.isPending}
              onChange={(e) => saveIconStyleMut.mutate(e.target.value)}
            >
              {/* ⚠ Grouped by FAMILY, and the style names are NOT translated — they
                  are FontAwesome's own product names, the same words the admin just
                  read on their kit page. Only the group headings are localised. */}
              {(["classic", "duotone", "sharp", "sharpDuotone", "proPlus"] as IconStyleGroup[]).map((g) => (
                <optgroup key={g} label={t(`styleEditor.iconGroup_${g}`)}>
                  {ICON_STYLE_DEFS.filter((d) => d.group === g).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.id === "solid" ? `${d.label} ${t("styleEditor.iconStyleBundled")}` : d.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {/* ⚠ The Pro+ families are stylised sets, not a weight of the whole
                library. An icon they have no glyph for simply does not draw, and
                there is nothing to fall back to — so say it before it happens. */}
            {iconStyleDef(branding?.iconStyle ?? "solid")?.full === false && (
              <p className="se-brand__p">{t("styleEditor.iconStylePartial")}</p>
            )}
          </div>

          <BrandingSlot
            label={t("styleEditor.navbarLogo")} hint={t("styleEditor.navbarLogoHint")}
            currentUrl={branding?.navbarUrl ?? null} accept="image/png,image/svg+xml,image/webp"
            onUpload={(f) => uploadBrandingMut.mutate({ variant: "navbar", file: f })}
            onDelete={() => deleteBrandingMut.mutate("navbar")}
            busy={uploadBrandingMut.isPending || deleteBrandingMut.isPending}
          />
          <BrandingSlot
            label={t("styleEditor.favicon")} hint={t("styleEditor.faviconHint")}
            currentUrl={branding?.iconUrl ?? null} accept="image/png,image/x-icon,image/svg+xml"
            onUpload={(f) => uploadBrandingMut.mutate({ variant: "icon", file: f })}
            onDelete={() => deleteBrandingMut.mutate("icon")}
            busy={uploadBrandingMut.isPending || deleteBrandingMut.isPending}
          />
        </div>
      )}

      {tab === "css" && (
        <div className="se-css">
          <div className="se-css__card">
            <div className="se-css__head">
              <div>
                <div className="se-css__title">
                  {t("styleEditor.secCustomCss")}
                  <span>· {t("styleEditor.themeSuffix", { theme: t("styleEditor.mode_" + viewedTheme) })}</span>
                </div>
                <p className="se-css__sub">{t("styleEditor.cssIntro")}</p>
                {/* Without this the inheritance is invisible: an admin sees an empty
                    textarea and concludes the site has no custom CSS, while a theme's
                    stylesheet is on every page. */}
                {themeCss[viewedTheme].trim() && (
                  <p className="se-css__sub">{t("styleEditor.cssThemeLayer")}</p>
                )}
              </div>
              <button type="button" className="btn-primary btn-sm" onClick={() => saveCustomCssMut.mutate()} disabled={saveCustomCssMut.isPending || !customDirty}>
                {saveCustomCssMut.isPending ? t("styleEditor.saving") : t("styleEditor.applySave")}
              </button>
            </div>
            <textarea
              className="se-css__ta"
              value={activeCss}
              spellCheck={false}
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
              placeholder={":root {\n  --c-accent2: #0ea5b7;\n}\n\narticle, aside {\n  border-radius: 22px;\n}"}
            />
            <div className="se-css__meta">
              <span>{customDirty ? t("styleEditor.unsaved") : t("styleEditor.saved")}</span>
              <span>{t("styleEditor.charCount", { count: activeCss.length.toLocaleString() })}</span>
            </div>
          </div>

          {/* Custom CSS is applied AFTER every token, so a `:root` variable here silently
              beats whatever the inspector shows. Naming those is the only way the two
              surfaces stop contradicting each other. */}
          <div className="se-css__card">
            <div className="se-css__title" style={{ marginBottom: 10 }}>{t("styleEditor.cssShadowTitle")}</div>
            <p className="se-css__sub" style={{ marginBottom: 14 }}>{t("styleEditor.cssShadowBody")}</p>
            {(() => {
              const vars = Object.entries(extractRootVars(activeCss));
              if (vars.length === 0) return <p className="se-css__sub">{t("styleEditor.cssShadowNone")}</p>;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {vars.map(([cssVar, value]) => (
                    <div className="se-shadow" key={cssVar}>
                      <span className="se-shadow__sw" style={{ background: swatchOf(value) }} />
                      <span className="se-shadow__l">{tokenLabel(cssVar, t)}</span>
                      <code className="se-shadow__v">{value}</code>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {tab === "history" && <StyleHistoryList />}
    </div>
  );
}

// ── Token row ───────────────────────────────────────────────────────────────────

function TokenRow({ label, cssVar, value, origin, inheritsFrom, control, min, max, mode, onChange, onReset }: {
  label: string; cssVar: string; value: string; origin: Origin; inheritsFrom?: string;
  control: "color" | "radius" | "shadow" | "size"; mode: Mode;
  /** `size` only — the slider's ends, from the token's registry entry. */
  min?: number; max?: number;
  onChange: (v: string) => void; onReset: () => void;
}) {
  const { t } = useTranslation("acp");
  const own = origin === "own";
  const tag = own ? t("styleEditor.tagSet")
    : origin === "global" ? t("styleEditor.tagFromGlobal")
    : origin === "theme"  ? t("styleEditor.tagFromTheme")
    : t("styleEditor.inherited");
  // The chain answers "inherited from WHAT" — the question the old bare
  // "Inherited" label raised and never answered.
  const chain = own ? cssVar
    : inheritsFrom      ? `${cssVar} ← ${inheritsFrom}`
    : origin === "global" ? `${cssVar} ← ${t("styleEditor.scopeAll")}`
    : origin === "theme"  ? `${cssVar} ← ${t("styleEditor.chainTheme")}`
    : `${cssVar} ← ${t("styleEditor.chainDefault")}`;

  const n = numVal(value, 0);

  return (
    <div className={`se-row${own ? " is-set" : ""}`}>
      <div className="se-row__head">
        <span className="se-row__label">{label}</span>
        <span className={`se-row__tag${own ? " is-set" : ""}`}>{tag}</span>
      </div>

      <div className="se-row__ctl" style={control === "shadow" ? { display: "none" } : undefined}>
        {/* A plain length — a measurement of the page's shape rather than of a
            corner, so it gets the token's own range instead of the radius slider's
            0–28. The readout is the control's only numeric feedback: unlike a
            radius there is no swatch that shows the value. */}
        {control === "size" && (
          <>
            <input type="range" className="se-row__range"
              min={min ?? 0} max={max ?? 400} value={n}
              onChange={(e) => onChange(`${e.target.value}px`)} aria-label={label} />
            <code className="se-row__num">{n}px</code>
          </>
        )}
        {control === "color" && (
          <>
            <input type="color" className="se-row__color" value={safeHex(value, "#888888")}
              onChange={(e) => onChange(e.target.value)} aria-label={label} />
            <input className="se-row__text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="#rrggbb" />
          </>
        )}
        {control === "radius" && (
          <>
            <span className="se-row__radiusPreview" style={{ borderRadius: value || 0 }} />
            <input type="range" className="se-row__range" min={0} max={28} value={n}
              onChange={(e) => onChange(`${e.target.value}px`)} aria-label={label} />
            <code className="se-row__num">{n}px</code>
          </>
        )}
      </div>

      {control === "shadow" && <ShadowControl value={value} mode={mode} onChange={onChange} />}

      <div className="se-row__foot">
        <span className="se-row__chain">
          <FontAwesomeIcon icon={faArrowTurnDown} />
          <code>{chain}</code>
        </span>
        {own && (
          <button type="button" className="se-row__revert" onClick={onReset} title={t("styleEditor.revertTitle")}>
            <FontAwesomeIcon icon={faRotateRight} /> {t("styleEditor.revertInherited")}
          </button>
        )}
      </div>
    </div>
  );
}

// ── ShadowControl ─────────────────────────────────────────────────────────────
//
// None / Soft / Strong picked a shadow; they could not design one. Custom opens the
// parts a shadow actually has — which way it falls, how far, how soft, how far it
// spreads, its colour, and whether it sits inside the element.
//
// The two presets stay `var(--shadow-card)` / `var(--shadow-pop)` so a site that
// wants "whatever the theme calls soft" keeps following the theme. Switching to
// Custom resolves that reference to real numbers ONCE, which is the moment the
// value stops tracking the theme — and the panel is on screen saying so.

function ShadowControl({ value, mode, onChange }: {
  value: string; mode: Mode; onChange: (v: string) => void;
}) {
  const { t } = useTranslation("acp");
  const parsed = parseShadow(value);

  // The parts the sliders drive. A parsed custom value supplies them; anything else
  // seeds from the preset it currently is, so opening Custom starts where you were
  // rather than at zero.
  const seed: ShadowParts = parsed.kind === "custom" ? parsed.parts
    : SHADOW_SEED[mode][parsed.kind === "strong" ? "strong" : "soft"];

  const set = (patch: Partial<ShadowParts>) => onChange(formatShadow({ ...seed, ...patch }));

  // Opposite sides cancel, so picking one clears the other on that axis. Clicking an
  // active side turns it off, which is how a shadow becomes centred on that axis.
  const toggleSide = (key: "top" | "bottom" | "left" | "right") => {
    const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" } as const;
    set({ [key]: !seed[key], [opposite[key]]: false } as Partial<ShadowParts>);
  };

  return (
    <div className="se-sh">
      <div className="se-sh__kinds">
        {SHADOW_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            className={`se-chip${parsed.kind === k.id ? " is-on" : ""}`}
            onClick={() => onChange(shadowValueFor(k.id, seed, value))}
          >{t(k.label)}</button>
        ))}
      </div>

      {parsed.kind === "raw" && (
        <>
          <p className="se-sh__note">{t("styleEditor.shRawNote")}</p>
          <input className="se-row__text" style={{ width: "100%", flex: "none" }}
            value={value} onChange={(e) => onChange(e.target.value)} />
        </>
      )}

      {parsed.kind === "custom" && (
        <div className="se-sh__panel">
          {/* The shadow itself, at the size it is actually being judged at. */}
          <div className="se-sh__stage">
            <span className="se-sh__chip" style={{ boxShadow: formatShadow(seed) }} />
          </div>

          <div className="se-sh__sides">
            <span className="se-sh__lab">{t("styleEditor.shDirection")}</span>
            <div className="se-sh__arrows">
              {SHADOW_SIDES.map((sd) => (
                <button
                  key={sd.key}
                  type="button"
                  className={`se-chip se-sh__arrow${seed[sd.key] ? " is-on" : ""}`}
                  title={t(sd.label)}
                  aria-label={t(sd.label)}
                  aria-pressed={seed[sd.key]}
                  onClick={() => toggleSide(sd.key)}
                ><FontAwesomeIcon icon={sd.icon} /></button>
              ))}
            </div>
            <button
              type="button"
              className={`se-chip${seed.inset ? " is-on" : ""}`}
              aria-pressed={seed.inset}
              onClick={() => set({ inset: !seed.inset })}
            >{t("styleEditor.shInset")}</button>
          </div>

          <ShadowSlider label={t("styleEditor.shDistance")} value={seed.distance} min={0} max={40}
            onChange={(v) => set({ distance: v })} />
          <ShadowSlider label={t("styleEditor.shBlur")} value={seed.blur} min={0} max={80}
            onChange={(v) => set({ blur: v })} />
          <ShadowSlider label={t("styleEditor.shSpread")} value={seed.spread} min={-20} max={40}
            onChange={(v) => set({ spread: v })} />

          <div className="se-sh__field">
            <span className="se-sh__lab">{t("styleEditor.shColour")}</span>
            <input type="color" className="se-row__color" value={seed.color}
              aria-label={t("styleEditor.shColour")}
              onChange={(e) => set({ color: e.target.value })} />
            <input type="range" className="se-row__range" min={0} max={100} value={Math.round(seed.alpha * 100)}
              aria-label={t("styleEditor.shOpacity")}
              onChange={(e) => set({ alpha: Number(e.target.value) / 100 })} />
            <code className="se-row__num">{Math.round(seed.alpha * 100)}%</code>
          </div>

          <code className="se-sh__out">{formatShadow(seed)}</code>
        </div>
      )}
    </div>
  );
}

function ShadowSlider({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div className="se-sh__field">
      <span className="se-sh__lab">{label}</span>
      <input type="range" className="se-row__range" min={min} max={max} value={value}
        aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <code className="se-row__num">{value}px</code>
    </div>
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

/**
 * The editor's own marks on the specimen: what is selectable, what is selected, and
 * a forced hover/focus so state-only tokens can be edited at all.
 *
 * ⚠ These rules may only ever DECORATE. The selection ring used to round itself with
 * `border-radius:4px`, which set the radius of the element it was highlighting — so
 * selecting Card pinned the card at 4px and the Card radius slider appeared to do
 * nothing. Editing a radius is exactly when its group is selected, so every radius
 * control was dead in the one view whose job is to show the effect. An outline
 * follows the element's own border curve anyway, so the rule bought nothing.
 *
 * Anything added here must be invisible to the tokens being edited; `outline` is the
 * whole budget, and the hover/focus rules paint only from the state tokens they
 * exist to preview. Guarded by `styleTokens.test.ts`.
 */
export function previewOverlayRules({ activeGroup, hotspots, previewState }: {
  activeGroup?: string; hotspots: boolean; previewState: PreviewState;
}): string {
  const rules: string[] = [];
  // Every editable surface, dashed — "click any surface" is only useful once you
  // can see which ones those are.
  if (hotspots) rules.push(`[data-group]{outline:1px dashed var(--c-fg-subtle);outline-offset:3px;}`);
  if (activeGroup) rules.push(`[data-group="${activeGroup}"]{outline:2px solid var(--c-accent);outline-offset:3px;}`);
  if (previewState === "hover") rules.push(`.tp-menu__item{background:var(--menu-item-hover-bg)!important;}`);
  if (previewState === "focus") rules.push(`.tp-field{border-color:var(--input-border-focus)!important;box-shadow:0 0 0 3px var(--c-accent-soft)!important;}`);
  return rules.join("\n");
}

function PreviewFrame({ mode, css, extraCss, activeGroup, hotspots, setHotspots, previewState, setPreviewState, onPick }: {
  mode: Mode; css: string; extraCss: string; activeGroup?: string;
  hotspots: boolean; setHotspots: (v: boolean) => void;
  previewState: PreviewState; setPreviewState: (s: PreviewState) => void;
  onPick: (group: string, scope: string) => void;
}) {
  const { t } = useTranslation("acp");
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
      ov.textContent = previewOverlayRules({ activeGroup, hotspots, previewState });

      if (activeGroup && activeGroup !== prevGroup.current) {
        doc.querySelector(`[data-group="${activeGroup}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      prevGroup.current = activeGroup;
    };
    apply();
    iframe.addEventListener("load", apply);
    return () => iframe.removeEventListener("load", apply);
  }, [mode, css, extraCss, activeGroup, previewState, hotspots]);

  // Capture-phase click-to-select on the iframe document (attached once per load).
  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let boundDoc: Document | null = null;
    const handler = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest) return;
      const reg = el.closest("[data-region]");
      const regionId = reg?.getAttribute("data-region") ?? "global";
      const scope = REGION_IDS.includes(regionId) ? regionId : "global";
      const comp = el.closest("[data-component]");
      if (comp) { onPickRef.current(comp.getAttribute("data-component")!, scope); return; }
      // A real (untagged) native form control is a Field — e.g. the live navbar's
      // search box. Map it to the Field component scoped to its region, instead of
      // falling through and selecting the enclosing region.
      if (el.closest("input, select, textarea")) { onPickRef.current("field", scope); return; }
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

  return (
    <div className="se-canvas">
      <div className="se-canvas__bar">
        <div className="se-canvas__left">
          <span className="se-live"><span className="se-live__dot" />{t("styleEditor.livePreview")}</span>
          <span className="se-sep" style={{ height: 18 }} />
          <span className="se-canvas__hint">{t("styleEditor.clickToEdit")}</span>
        </div>
        <div className="se-canvas__right">
          <button type="button" className={`se-chip se-chip--icon${hotspots ? " is-on" : ""}`} onClick={() => setHotspots(!hotspots)}>
            <FontAwesomeIcon icon={faObjectGroup} /> {t("styleEditor.outlineAreas")}
          </button>
          <span className="se-sep" style={{ height: 18 }} />
          <div style={{ display: "flex", gap: 4 }}>
            {PREVIEW_STATES.map((s) => (
              <button key={s.id} type="button" className={`se-chip${previewState === s.id ? " is-on" : ""}`}
                onClick={() => setPreviewState(s.id)} title={t("styleEditor.forceState")}>
                {t(s.label)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="se-canvas__frame">
        <iframe ref={ref} src="/__theme-preview" title={t("styleEditor.previewTitle")} />
      </div>
    </div>
  );
}

// ── BrandingSlot ──────────────────────────────────────────────────────────────

function BrandingSlot({ label, hint, currentUrl, accept, onUpload, onDelete, busy }: {
  label: string; hint: string; currentUrl: string | null; accept: string;
  onUpload: (f: File) => void; onDelete: () => void; busy: boolean;
}) {
  const { t } = useTranslation("acp");
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  // The MIME allow-list is re-checked here as well as by `accept`, because a drop
  // never consults the file dialog's filter. The API checks magic bytes regardless;
  // this only spares the admin a round-trip to be told no.
  const take = (file: File | undefined) => {
    if (!file) return;
    if (accept.split(",").includes(file.type)) onUpload(file);
    else swalToast(t("styleEditor.badType"));
  };

  return (
    <div>
      <div className="se-brand__h">{label}</div>
      <p className="se-brand__p">{hint}</p>
      <div
        className={`se-drop${over ? " is-over" : ""}`}
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) take(e.dataTransfer.files[0]); }}
      >
        {currentUrl ? (
          <>
            <img src={currentUrl} alt={label} />
            <button type="button" className="se-drop__x" disabled={busy} title={t("styleEditor.remove")}
              onClick={(e) => { e.stopPropagation(); onDelete(); }}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </>
        ) : (
          <div>
            <div className="se-drop__t">{t("styleEditor.dropImage")}</div>
            <div className="se-drop__s">{t("styleEditor.orBrowse")}</div>
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept={accept} style={{ display: "none" }}
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

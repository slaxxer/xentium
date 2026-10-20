import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../../components/Icon";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faRotateLeft, faRotateRight,
  faMagnifyingGlass, faSliders, faObjectGroup, faArrowTurnDown,
  faArrowUp, faArrowDown, faArrowLeft, faArrowRight, faUpload, faStar,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { looksLikeKit } from "../../../lib/iconKit";
import { toast } from "../../../lib/toast";
import { useDebouncedSave } from "../../../hooks/useAutosave";
import { SaveChip } from "../../../components/SaveChip";
import { refreshTokenCss } from "../../../lib/liveStyle";
import { StudioHistory } from "../components/StudioHistory";
import { PREVIEW_THEME_PARAM, useEditingTheme, withTheme } from "../../../lib/editingTheme";
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
} from "@xentium/contracts";
import {
  SECTIONS, SECTION_BY_ID, BOARD, SCOPE_OPTIONS, SCOPE_LABEL, LOGO_ROWS, tokenLabel,
  type Section,
} from "./styleTokens";
import { STYLESHEET_DEFAULTS, resolveColor } from "./tokenDefaults";
import { studioHref } from "./studioLinks";
import { useSiteConfig } from "../../../hooks/useSiteConfig";
import { useLayoutDocument } from "../../../layout/useLayout";
import { sectionBackground } from "../../../layout/blocks/sectionBackground";
import {
  parseShadow, formatShadow, shadowValueFor, SHADOW_SEED,
  type ShadowKind, type ShadowParts,
} from "./shadowValue";
import { PILL, pickOnPage } from "./stylePagePick";
import { LAYOUT_PREVIEW_PARAM } from "../../../layout/previewMode";
import { listTemplates } from "../../../layout/templateRegistry";
import { useAuth } from "../../../hooks/useAuth";
import "./StyleEditorPage.scss";
import { ICON_STYLE_DEFS, iconStyleDef, type IconStyleGroup } from "@xentium/contracts";
import { XentiumMark } from "../../../components/XentiumMark";
import { uiLocale } from "../../../lib/i18n";
import { Button } from "../../../components/AcpControls";

const CUSTOM_CSS_PREVIEW_ID = "xentium-custom-css-preview";

export type StyleTab = "tokens" | "branding" | "css" | "history";

interface StyleDraft {
  tokens: ScopedTokenSet;
  fontFamily: string;
  fontWeight: string;
  fontSize: string;
}

// ── Defaults / display resolution ───────────────────────────────────────────────
// Hearth core values — single shared copy in @xentium/contracts (also used by the
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
/** Icon size, as a multiple of stock: 70% to 200% in steps of 10. */
const ICON_SCALE_MIN = 0.7;
const ICON_SCALE_MAX = 2;
const ICON_SCALE_STEP = 0.1;


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
 * rather than to stock Xentium.
 */
function inheritedValue(
  cssVar: string, globalBucket: TokenMap, themeBuckets: ScopedTokens, scope: ThemeScope,
): { value: string; origin: Origin; from?: string } {
  const fromTheme = themeBuckets[scope]?.[cssVar] ?? themeBuckets.global?.[cssVar];
  if (fromTheme !== undefined) return { value: fromTheme, origin: "theme" };
  const def = DEFAULTS[cssVar];
  if (def !== undefined) {
    const own = globalBucket[cssVar];
    return own !== undefined ? { value: own, origin: "global" } : { value: def, origin: "inherited" };
  }
  const reg: TokenDef | undefined = TOKEN_BY_VAR[cssVar];
  if (reg?.inheritsFrom) {
    const up = inheritedValue(reg.inheritsFrom, globalBucket, themeBuckets, scope);
    // The chain names the token this one falls back to, not wherever that one
    // ultimately resolved — "--btn-bg ← --c-accent" is what an admin can act on.
    return { value: up.value, origin: up.origin === "own" ? "inherited" : up.origin, from: reg.inheritsFrom };
  }
  const base = BASE_FALLBACK[cssVar];
  if (base !== undefined) return { value: base, origin: "inherited" };
  // Anything else starts from the stylesheet's own default, so no row is ever blank.
  const stock = STYLESHEET_DEFAULTS[cssVar];
  if (stock !== undefined) return { value: stock, origin: "inherited" };
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

/**
 * The Style Editor edits ONE theme at a time — the one named in `?theme=`, else the
 * live one. Keyed by it, so switching themes starts the editor fresh rather than
 * carrying one theme's unsaved state onto another.
 */
export function StyleEditorPage({ tab }: {
  /** Which part to show: the Studio's mode. The Studio owns the page header, the mode
   *  tabs and the one Publish for layouts and styles together. */
  tab: StyleTab;
}) {
  const { key } = useEditingTheme();
  return <StyleEditorInner key={key ?? ""} themeKey={key} tab={tab} />;
}

function StyleEditorInner({ themeKey, tab }: { themeKey: string | null; tab: StyleTab }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sectionId, setSectionId] = useState(SECTIONS[0]!.id);
  const [scope, setScope] = useState<ThemeScope>("global");
  const [previewState, setPreviewState] = useState<PreviewState>("base");
  const [hotspots, setHotspots] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const [tokens, setTokens] = useState<ScopedTokenSet | null>(null);
  const initialised = useRef(false);

  // "" = no override: the core pairing (Figtree text, Bricolage Grotesque headings).
  const [fontFamily, setFontFamily] = useState<string>("");
  const [fontWeight, setFontWeight] = useState<string>("400");
  const [fontSize,   setFontSize]   = useState<string>("16");

  // ── Custom CSS console ──────────────────────────────────────────────────────
  // ONE stylesheet. It used to be a pair keyed by scheme, and the only thing that
  // second sheet could express was "when the visitor's OS asks for dark" — a question
  // this site no longer answers, because a dark site is a dark THEME.
  const [customCss, setCustomCss]           = useState("");
  // `undefined` until loaded, so the autosave below stays idle until then.
  const [customCssSaved, setCustomCssSaved] = useState<string | undefined>(undefined);
  const customDirty = customCssSaved !== undefined && customCss !== customCssSaved;

  /**
   * The installed theme's own stylesheet, which sits UNDER this editor's content.
   *
   * Read separately and never merged into the textarea: this console saves back exactly
   * what it shows, so editing a merged blob would store the theme's CSS as the admin's
   * own and the next theme update would have nothing left to inherit. Same rule, and the
   * same reason, as the token editor's `theme` field.
   */
  const [themeCss, setThemeCss] = useState("");

  useEffect(() => {
    api.get<{ css?: string; theme?: string }>(withTheme("/appearance/custom-css", themeKey))
      .then((r) => {
        setCustomCss(r?.css ?? ""); setCustomCssSaved(r?.css ?? "");
        setThemeCss(r?.theme ?? "");
      })
      .catch(() => {});
  }, []);

  const [cssPreview, setCssPreview] = useState("");
  useEffect(() => {
    const id = setTimeout(() => {
      api.post<{ css: string }>("/appearance/custom-css/preview", { css: customCss })
        .then((r) => setCssPreview(r?.css ?? ""))
        .catch(() => setCssPreview(""));
    }, 300);
    return () => clearTimeout(id);
  }, [customCss]);

  /**
   * The console autosaves to the theme's DRAFT, like the colours and the layouts: the
   * stylesheet goes live with the Theme Studio's one Publish. It used to save straight
   * to the site, so CSS written for a redesign went out before the redesign did.
   *
   * A sheet the server cannot parse is refused and stays unsaved; the meta line says
   * so instead of a toast per keystroke pause.
   */
  const saveCustomCssMut = useMutation({
    mutationFn: (css: string) => api.put(withTheme("/appearance/custom-css", themeKey), { css }).then(() => css),
    onSuccess: (css) => {
      setCustomCssSaved(css);
      qc.invalidateQueries({ queryKey: ["studio-status"] });
      qc.invalidateQueries({ queryKey: ["acp-draft-status"] });
    },
  });
  useDebouncedSave({
    value: customCss, savedValue: customCssSaved, delay: 1200,
    onSave: (css) => saveCustomCssMut.mutate(css),
  });

  // ── Autosave baseline ───────────────────────────────────────────────────────
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [savedSnap, setSavedSnap]     = useState<StyleDraft | undefined>(undefined);
  const draft: StyleDraft = { tokens: tokens ?? {}, fontFamily, fontWeight, fontSize };
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
      // shapes, but may only answer with a XEC code, which renders as the generic
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
  const { data: saved, isLoading } = useQuery<{
    tokens?: ScopedTokenSet;
    theme?: ScopedTokenSet;
    installedTheme?: { name?: string; version?: string } | null;
  }>({
    queryKey: ["acp-tokens", themeKey],
    queryFn:  () => api.get(withTheme("/appearance/tokens", themeKey)),
  });
  // NOT merged into `tokens`: the editor writes back what it holds, so folding the theme
  // in would turn every theme value into an admin override and destroy the inheritance.
  const themeTokens = saved?.theme;
  useEffect(() => {
    if (saved && !initialised.current) {
      initialised.current = true;
      // Stored sparse exactly as saved — do NOT merge defaults, or every token would
      // become an "override" and inheritance/sparse-storage would break.
      setTokens(saved.tokens ?? {});
    }
  }, [saved]);

  useEffect(() => {
    // This theme's own font — fonts belong to a theme, like its colours.
    api.get<{ family?: string; size?: string; weight?: string }>(withTheme("/appearance/font", themeKey))
      .then((font) => {
        const f = font?.family; if (f && FONTS.includes(f as any)) setFontFamily(f);
        if (font?.size) setFontSize(String(font.size));
        if (font?.weight) setFontWeight(String(font.weight));
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
      const writes: Promise<unknown>[] = [api.put(withTheme("/appearance/tokens", themeKey), { tokens })];
      const font: Record<string, string> = {};
      if (snap?.fontFamily !== fontFamily) font.family = fontFamily;
      if (snap?.fontSize   !== fontSize)   font.size   = fontSize;
      if (snap?.fontWeight !== fontWeight) font.weight = fontWeight;
      if (Object.keys(font).length) writes.push(api.put(withTheme("/appearance/font", themeKey), font));
      await Promise.all(writes);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["studio-history"] });
      qc.invalidateQueries({ queryKey: ["acp-draft-status"] });
      qc.invalidateQueries({ queryKey: ["studio-status"] });
      // No global injection here: the draft is previewed only in the scoped preview
      // iframe (previewCss). Injecting into the ACP's own <head> would restyle the
      // ACP you're working in with unpublished changes. The ACP keeps showing the
      // published theme until Publish (which calls refreshTokenCss).
      setSavedSnap(draftRef.current);
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  // Edits above are saved as a draft; the Theme Studio's Publish puts it live.
  const { data: draftStatus } = useQuery<{ pending: boolean; tokens?: boolean; font?: boolean }>({
    queryKey: ["acp-draft-status", themeKey],
    queryFn:  () => api.get(withTheme("/appearance/draft-status", themeKey)),
    refetchInterval: 15_000,
  });
  const resetMut = useMutation({
    mutationFn: () => api.post(withTheme("/appearance/reset", themeKey), {}),
    onSuccess: async () => {
      const empty: ScopedTokenSet = {};
      setTokens(empty);
      setFontFamily(""); setFontSize("16"); setFontWeight("400");
      setCustomCss(""); setCustomCssSaved("");
      document.getElementById(CUSTOM_CSS_PREVIEW_ID)?.remove();
      await refreshTokenCss();
      setSavedSnap({ tokens: empty, fontFamily: "", fontSize: "16", fontWeight: "400" });
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

  useDebouncedSave({ value: draft, savedValue: savedSnap, onSave: () => saveMut.mutate(), delay: 1200 });

  if (isLoading || !tokens) return <div className="acp-card acp-empty">{t("styleEditor.loading")}</div>;

  const section = SECTION_BY_ID[sectionId] ?? SECTIONS[0]!;
  const globalBucket = tokens.global ?? {};
  /** What the installed theme defines — the layer under the admin's own edits. */
  const themeBuckets: ScopedTokens = themeTokens ?? {};

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
    if (!isScopeable(next)) setScope("global"); // reset picker off sections it does not apply to
  }

  // From another tab (Branding's "Logo icon colours") straight to a token section.
  // Embedded, the Studio's mode decides the tab, so the Studio is switched instead —
  // this component stays mounted across modes, so the picked section survives.
  function jumpTo(id: string) {
    selectSection(id);
    navigate(studioHref(themeKey, "style"));
  }

  // 3b — a click in the preview iframe picks a surface. `group` is the clicked
  // surface's data-component/data-region (which doubles as a section id); `pickScope`
  // is the enclosing region so clicking a button *in the navbar* preselects scope Navbar.
  function handlePick(group: string, pickScope: string) {
    const sec = SECTION_BY_ID[group];
    if (!sec) return;
    setSectionId(group);
    if (isScopeable(sec) && SCOPE_OPTIONS.some((o) => o.id === pickScope)) setScope(pickScope as ThemeScope);
    else setScope("global");
  }

  function bucketHas(s: ThemeScope, cssVar: string): boolean {
    return !!(tokens![s] && cssVar in tokens![s]!);
  }
  function setOverride(s: ThemeScope, cssVar: string, value: string) {
    setTokens((prev) => {
      if (!prev) return prev;
      return { ...prev, [s]: { ...(prev[s] ?? {}), [cssVar]: value } };
    });
  }
  // The icon size token, read and written like any global token; stock (1) is stored
  // as no override at all, so "back to 100%" leaves nothing behind.
  const iconScale = Math.round((Number(display("--icon-scale", "global").value) || 1) * 10) / 10;
  function setIconScale(next: number) {
    const v = Math.round(Math.min(ICON_SCALE_MAX, Math.max(ICON_SCALE_MIN, next)) * 10) / 10;
    if (v === 1) clearOverride("global", "--icon-scale");
    else setOverride("global", "--icon-scale", String(v));
  }

  function clearOverride(s: ThemeScope, cssVar: string) {
    setTokens((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      const b = { ...(next[s] ?? {}) };
      delete b[cssVar];
      // An empty bucket is DELETED, not kept: "pending" is a stringify comparison, so
      // a `{}` left behind reads as an unsaved change forever.
      if (Object.keys(b).length) next[s] = b; else delete next[s];
      return next;
    });
  }

  // Resolved value + where it came from, at the active scope.
  function display(cssVar: string, atScope: ThemeScope = effScope): { value: string; origin: Origin; from?: string } {
    if (bucketHas(atScope, cssVar)) return { value: tokens![atScope]![cssVar]!, origin: "own" };
    // A component token in a region scope falls back to its global override, then base.
    if (atScope !== "global" && cssVar in globalBucket) return { value: globalBucket[cssVar]!, origin: "global" };
    return inheritedValue(cssVar, globalBucket, themeBuckets, atScope);
  }

  // ── Live preview CSS (scoped, mirrors the served stylesheet) ─────────────────
  const previewCss = (() => {
    // Theme first, admin on top — the same order `buildCSS` serves, so the preview cannot
    // show a site that has no theme installed when it does.
    const themeScoped: ScopedTokens = themeTokens ?? {};
    const scoped: ScopedTokens = { ...themeScoped, ...tokens };
    for (const key of Object.keys(themeScoped)) {
      if (tokens[key]) scoped[key] = { ...themeScoped[key], ...tokens[key] };
    }
    const globalVars = { ...(scoped.global ?? {}), ...extractRootVars(customCss) };
    const blocks: string[] = [];
    // The font comes from the SAME builders the API serves with (@xentium/contracts),
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
    // Applied exactly as the served stylesheet applies it. NOT to `body.xt-acp`:
    // this CSS goes into the preview iframe, which is the SITE — the admin panel
    // deliberately keeps its own type and must not follow the site font.
    const bodyRule = fontBodyRule(font);
    if (bodyRule) blocks.push(bodyRule.replace(/;$/gm, " !important;"));
    return blocks.join("\n");
  })();

  // ── Draft accounting ────────────────────────────────────────────────────────
  const totalCount = Object.values(tokens)
    .reduce((n, bucket) => n + Object.keys(bucket ?? {}).length, 0);

  const diffRows = Object.entries(tokens).flatMap(([sc, bucket]) =>
    Object.entries(bucket ?? {}).map(([cssVar, value]) => ({
      key: `${sc}|${cssVar}`,
      label: tokenLabel(cssVar, t),
      where: t(SCOPE_LABEL[sc] ?? sc),
      value,
    })),
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
      {/* Colours & type only: the other modes have their own state lines. */}
      {tab === "tokens" && <div className="se-embedded-bar">
        <div className="se-actions">
          {/* State first, on its own line: what is unsaved and what is unpublished are
              readings, not controls. Sharing a row with the buttons that act on them
              made the header a wall of chips where nothing said which was which. */}
          <div className="se-actions__state">
            {/* Only when the colours or the font differ from live. It used to show
                whenever the theme had ANY override and counted those, which read as
                "2 unpublished changes" under a header saying everything was live. */}
            {(draftStatus?.tokens || draftStatus?.font) && (
              <div className="se-draft">
                <span className="se-draft__state"><span className="se-draft__dot" />{t("styleEditor.draft")}</span>
                <button type="button" className="se-draft__btn" onClick={() => setShowDiff((v) => !v)} disabled={totalCount === 0}>
                  {showDiff ? t("styleEditor.diffHide") : t("styleEditor.diffReview")}
                </button>
              </div>
            )}
            <SaveChip saving={saveMut.isPending} autosave />
          </div>

          <div className="se-actions__row">
            {/* The light/dark switch used to live here. A site has ONE look now — the
                editor edits that one palette, and a site that wants to be dark installs
                a dark theme. */}

            <Button variant="ghost" className="se-act" disabled={resetMut.isPending || saveMut.isPending} onClick={handleReset}>
              <FontAwesomeIcon icon={faRotateLeft} /> {t("styleEditor.resetAll")}
            </Button>

          </div>
        </div>
      </div>}

      {tab === "tokens" && showDiff && totalCount > 0 && (
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
                        onClick={() => selectSection(tile.section)}
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
                <div className="se-type__aa" style={{ fontFamily: `"${fontFamily || "Figtree"}", system-ui, sans-serif`, fontWeight: Number(fontWeight) }}>Aa</div>
                <div className="se-type__col">
                  <div className="se-type__row">
                    <select className="se-type__select" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} aria-label={t("styleEditor.fontFamily")}>
                      <option value="">{t("styleEditor.fontSiteDefault")}</option>
                      {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                    </select>
                    <div className="se-step">
                      <button type="button" aria-label={t("styleEditor.fontSmaller")}
                        disabled={numVal(fontSize, 16) <= FONT_SIZE_MIN}
                        onClick={() => setFontSize(String(Math.max(FONT_SIZE_MIN, numVal(fontSize, 16) - 1)))}>−</button>
                      {/* The site's TEXT SIZE: every step of the type scale follows it, so it
                          reads as a percentage of stock rather than as the body's pixel size. */}
                      <span className="se-step__v" title={t("styleEditor.textSize")}>{Math.round((numVal(fontSize, 16) / 16) * 100)}%</span>
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
                  {/* ICON SIZE — apart from the text size: an admin who wants bigger icons
                      should not have to make every word bigger to get them. A theme token
                      (`--icon-scale`), so it is drafted, published and per theme like a colour. */}
                  <div className="se-type__row se-iconsize">
                    <span className="se-iconsize__label">
                      <FontAwesomeIcon icon={faStar} /> {t("styleEditor.iconSize")}
                    </span>
                    <div className="se-step">
                      <button type="button" aria-label={t("styleEditor.iconSmaller")}
                        disabled={iconScale <= ICON_SCALE_MIN}
                        onClick={() => setIconScale(iconScale - ICON_SCALE_STEP)}>−</button>
                      <span className="se-step__v" title={t("styleEditor.iconSize")}>{Math.round(iconScale * 100)}%</span>
                      <button type="button" aria-label={t("styleEditor.iconBigger")}
                        disabled={iconScale >= ICON_SCALE_MAX}
                        onClick={() => setIconScale(iconScale + ICON_SCALE_STEP)}>+</button>
                    </div>
                  </div>
                  <div className="se-type__hint">{t("styleEditor.iconSizeHint")}</div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Canvas + inspector ───────────────────────────────────────────── */}
          <div className="se-work">
            <PreviewFrame
              themeKey={themeKey}
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
                        {t(`styleEditor.k${section.kind === "component" ? "Component" : section.kind === "region" ? "Region" : section.kind === "foundation" ? "Foundation" : "Palette"}`)}
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

                {isScopeable(section) && (
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
                        : def?.control === "size" ? "size"
                        : def?.control === "text" ? "text"
                        : def?.control === "weight" ? "weight" : "color"}
                      min={def?.min}
                      max={def?.max}
                      onChange={(v) => setOverride(effScope, cssVar, v)}
                      onReset={() => clearOverride(effScope, cssVar)}
                    />
                  );
                })}

                {section.id === "logo" && (
                  <div className="se-logo-fx">
                    <XentiumMark size={40} className="xt-logo-fx" />
                    <span>{t("styleEditor.secLogoHint")}</span>
                  </div>
                )}

                {/* Feedback colours drive the toast system — fire live samples to preview. */}
                {section.kind === "feedback" && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--c-border)" }}>
                    <Button variant="ghost" onClick={() => {
                      toast.success(t("styleEditor.sampleSuccess"));
                      toast.info(t("styleEditor.sampleInfo"));
                      toast.warning(t("styleEditor.sampleWarning"));
                      toast.error(t("styleEditor.sampleError"));
                    }}>
                      {t("styleEditor.previewToasts")}
                    </Button>
                    <div style={{ fontSize: "var(--fs-2xs)", color: "var(--c-fg-subtle)", marginTop: 6 }}>
                      {t("styleEditor.toastsUse")}
                    </div>
                  </div>
                )}
              </div>

              <div className="se-insp__foot">
                <span className="se-insp__summary">
                  {t("styleEditor.setHere", { set: setHere, total: rowVars.length })}
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
        // The STAGED logo-icon colours, on the whole tab: the preview and every
        // default thumbnail show the icon as it will look once published.
        <div className="br" style={Object.fromEntries(LOGO_ROWS.map((r) => [r.cssVar, display(r.cssVar, "global").value])) as React.CSSProperties}>
          {/* ── Identity: what the site is called and how it looks, previewed where it
              shows up — the header, a browser tab, a phone's home screen. */}
          <section className="br-card br-identity">
            <BrandingPreview
              logoText={logoText}
              navbarUrl={branding?.navbarUrl ?? null}
              iconUrl={branding?.iconUrl ?? null}
            />

            <div className="br-controls">
              <div className="br-field">
                <label className="br-h" htmlFor="br-logo-text">{t("styleEditor.logoText")}</label>
                <p className="br-p">{t("styleEditor.logoTextHint")}</p>
                <div className="br-inline">
                  <input id="br-logo-text" className="se-brand__input" value={logoText} onChange={(e) => setLogoText(e.target.value)}
                    placeholder={t("styleEditor.logoPlaceholder")} />
                  <Button
                    onClick={() => saveLogoTextMut.mutate()}
                    disabled={saveLogoTextMut.isPending || logoText === (branding?.logoText ?? "")}>
                    {t("styleEditor.save")}
                  </Button>
                </div>
              </div>

              <BrandAsset
                label={t("styleEditor.navbarLogo")} hint={t("styleEditor.navbarLogoHint")}
                currentUrl={branding?.navbarUrl ?? null} accept="image/png,image/svg+xml,image/webp" wide
                onUpload={(f) => uploadBrandingMut.mutate({ variant: "navbar", file: f })}
                onDelete={() => deleteBrandingMut.mutate("navbar")}
                busy={uploadBrandingMut.isPending || deleteBrandingMut.isPending}
              />
              <BrandAsset
                label={t("styleEditor.favicon")} hint={t("styleEditor.faviconHint")}
                currentUrl={branding?.iconUrl ?? null} accept="image/png,image/x-icon,image/svg+xml"
                onUpload={(f) => uploadBrandingMut.mutate({ variant: "icon", file: f })}
                onDelete={() => deleteBrandingMut.mutate("icon")}
                busy={uploadBrandingMut.isPending || deleteBrandingMut.isPending}
              />

              <button type="button" className="br-jump" onClick={() => jumpTo("logo")}>
                <XentiumMark size={22} className="xt-logo-fx" />
                <span>
                  <b>{t("styleEditor.brandIconColours")}</b>
                  <small>{t("styleEditor.brandIconColoursHint")}</small>
                </span>
                <FontAwesomeIcon icon={faArrowRight} />
              </button>
            </div>
          </section>

          {/* ── Icons: the glyph set every icon on the site and in the ACP is drawn from. */}
          <section className="br-card br-icons">
            <div className="br-icons__head">
              <h2 className="br-title">{t("styleEditor.brandIconsTitle")}</h2>
              <p className="br-p">{t("styleEditor.brandIconsLede")}</p>
            </div>
            <div className="br-icons__grid">
              <div className="br-field">
                <label className="br-h" htmlFor="br-kit">{t("styleEditor.iconKit")}</label>
                <p className="br-p">{t("styleEditor.iconKitHint")}</p>
                <div className="br-inline">
                  <input id="br-kit" className="se-brand__input" value={iconKit} onChange={(e) => setIconKit(e.target.value)}
                    placeholder={t("styleEditor.iconKitPlaceholder")} spellCheck={false} />
                  <Button
                    onClick={() => saveIconKitMut.mutate()}
                    disabled={saveIconKitMut.isPending || iconKit === (branding?.iconKitUrl ?? "")}>
                    {t("styleEditor.save")}
                  </Button>
                </div>
                <p className="br-note">{t("styleEditor.iconKitLicence")}</p>
              </div>

              <div className="br-field">
                <label className="br-h" htmlFor="br-style">{t("styleEditor.iconStyle")}</label>
                {/* ⚠ Only meaningful with a kit: every style but Solid is Pro, and naming
                    one with no kit loaded would emit a class nothing defines. The select
                    is disabled rather than hidden so the capability is discoverable. */}
                <p className="br-p">{t("styleEditor.iconStyleHint")}</p>
                <select
                  id="br-style"
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
                {!branding?.iconKitUrl && <p className="br-note">{t("styleEditor.iconStyleNeedsKit")}</p>}
                {/* ⚠ The Pro+ families are stylised sets, not a weight of the whole
                    library. An icon they have no glyph for simply does not draw, and
                    there is nothing to fall back to — so say it before it happens. */}
                {iconStyleDef(branding?.iconStyle ?? "solid")?.full === false && (
                  <p className="br-note">{t("styleEditor.iconStylePartial")}</p>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {tab === "css" && (
        <div className="se-css">
          <div className="se-css__card">
            <div className="se-css__head">
              <div>
                <div className="se-css__title">{t("styleEditor.secCustomCss")}</div>
                <p className="se-css__sub">{t("styleEditor.cssIntro")}</p>
                {/* Without this the inheritance is invisible: an admin sees an empty
                    textarea and concludes the site has no custom CSS, while a theme's
                    stylesheet is on every page. */}
                {themeCss.trim() && (
                  <p className="se-css__sub">{t("styleEditor.cssThemeLayer")}</p>
                )}
              </div>
            </div>
            <textarea
              className="se-css__ta"
              value={customCss}
              spellCheck={false}
              onChange={(e) => setCustomCss(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Tab") {
                  e.preventDefault();
                  const el = e.currentTarget; const s = el.selectionStart, end = el.selectionEnd;
                  setCustomCss(customCss.slice(0, s) + "  " + customCss.slice(end));
                  requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
                }
              }}
              placeholder={":root {\n  --c-accent2: #0ea5b7;\n}\n\narticle, aside {\n  border-radius: 22px;\n}"}
            />
            <div className="se-css__meta">
              <span className={saveCustomCssMut.isError ? "se-css__err" : undefined}>
                {saveCustomCssMut.isError ? t("styleEditor.cssInvalid")
                  : saveCustomCssMut.isPending || customDirty ? t("styleEditor.saving")
                  : t("styleEditor.cssDraftSaved")}
              </span>
              <span>{t("styleEditor.charCount", { count: customCss.length.toLocaleString(uiLocale()) })}</span>
            </div>
          </div>

          {/* Custom CSS is applied AFTER every token, so a `:root` variable here silently
              beats whatever the inspector shows. Naming those is the only way the two
              surfaces stop contradicting each other. */}
          <div className="se-css__card">
            <div className="se-css__title" style={{ marginBottom: 10 }}>{t("styleEditor.cssShadowTitle")}</div>
            <p className="se-css__sub" style={{ marginBottom: 14 }}>{t("styleEditor.cssShadowBody")}</p>
            {(() => {
              const vars = Object.entries(extractRootVars(customCss));
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

      {tab === "history" && <StudioHistory themeKey={themeKey} />}
    </div>
  );
}

// ── Token row ───────────────────────────────────────────────────────────────────

const WEIGHTS = ["300", "400", "500", "600", "700", "800", "900"];

/**
 * Whether "Apply to" (per-region scope) means anything for a section: a component with
 * at least one region-scopeable token. The User menu and sort buttons have none — a
 * region bucket would be stored and reach nothing.
 */
function isScopeable(section: { kind: string; group?: string } | undefined): boolean {
  return section?.kind === "component"
    && TOKEN_REGISTRY.some((tok) => tok.group === section.group && tok.scopeable);
}

function TokenRow({ label, cssVar, value, origin, inheritsFrom, control, min, max, onChange, onReset }: {
  label: string; cssVar: string; value: string; origin: Origin; inheritsFrom?: string;
  control: "color" | "radius" | "shadow" | "size" | "text" | "weight";
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
            {/* The picker gets the RESOLVED colour: a default like `rgba(…)`,
                `var(--primitive-…)` or `color-mix(…)` is still a colour the admin
                should see and start from. The text field keeps the exact value, alpha
                included; picking a colour writes a plain hex. */}
            <input type="color" className="se-row__color" value={resolveColor(value) ?? safeHex(value, "#888888")}
              onChange={(e) => onChange(e.target.value)} aria-label={label} />
            <input className="se-row__text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="#rrggbb" />
          </>
        )}
        {/* A value that is not a single colour or length — a font stack, a type step,
            a glow built from another token. Typed as CSS, previewed live. */}
        {control === "text" && (
          <input className="se-row__text se-row__text--wide" value={value} onChange={(e) => onChange(e.target.value)}
            aria-label={label} spellCheck={false} />
        )}
        {/* A font weight: the named steps a typeface actually ships, previewed in the
            option itself. A free number field invited values no font draws. */}
        {control === "weight" && (
          <select className="acp-select se-row__weight" value={String(n || value || "")} aria-label={label}
            onChange={(e) => onChange(e.target.value)}>
            {!WEIGHTS.includes(String(n)) && <option value={value}>{value}</option>}
            {WEIGHTS.map((w) => <option key={w} value={w} style={{ fontWeight: Number(w) }}>{t(`styleEditor.weight.${w}`)} ({w})</option>)}
          </select>
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

      {control === "shadow" && <ShadowControl value={value} onChange={onChange} />}

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

function ShadowControl({ value, onChange }: {
  value: string; onChange: (v: string) => void;
}) {
  const { t } = useTranslation("acp");
  const parsed = parseShadow(value);

  // The parts the sliders drive. A parsed custom value supplies them; anything else
  // seeds from the preset it currently is, so opening Custom starts where you were
  // rather than at zero.
  const seed: ShadowParts = parsed.kind === "custom" ? parsed.parts
    : SHADOW_SEED[parsed.kind === "strong" ? "strong" : "soft"];

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
 * Live surfaces that belong to a section without carrying `data-group` — the real
 * header dropdowns and the pill — so outlining a section outlines them too.
 */
const GROUP_EXTRA: Record<string, string> = { menu: ".xt-pop", usermenu: PILL };
const groupSelector = (g: string) => [`[data-group="${g}"]`, GROUP_EXTRA[g]].filter(Boolean).join(",");

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
  if (hotspots) rules.push(`[data-group],${Object.values(GROUP_EXTRA).join(",")}{outline:1px dashed var(--c-fg-subtle);outline-offset:3px;}`);
  if (activeGroup) rules.push(`${groupSelector(activeGroup)}{outline:2px solid var(--c-accent);outline-offset:3px;}`);
  if (previewState === "hover") rules.push(`.tp-menu__item{background:var(--menu-item-hover-bg)!important;}`);
  if (previewState === "focus") rules.push(`.tp-field{border-color:var(--input-border-focus)!important;box-shadow:0 0 0 3px var(--c-accent-soft)!important;}`);
  return rules.join("\n");
}

function PreviewFrame({ css, extraCss, activeGroup, hotspots, setHotspots, previewState, setPreviewState, onPick, themeKey }: {
  css: string; extraCss: string; activeGroup?: string;
  /** The theme being edited — the specimen loads ITS stylesheet under the draft. */
  themeKey: string | null;
  hotspots: boolean; setHotspots: (v: boolean) => void;
  previewState: PreviewState; setPreviewState: (s: PreviewState) => void;
  onPick: (group: string, scope: string) => void;
}) {
  const { t } = useTranslation("acp");
  const ref = useRef<HTMLIFrameElement>(null);
  const onPickRef = useRef(onPick); onPickRef.current = onPick;

  /**
   * What the canvas shows: the Components specimen, or a real PAGE of the site.
   *
   * The page loads with the theme's DRAFT layouts and stylesheet (`__layout=draft`),
   * and the editor's unsaved token edits are injected over it exactly as on the
   * specimen, so the colours change as the inspector moves. A click picks the section
   * and scope of what was clicked (stylePagePick) and never reaches the page: links
   * do not navigate, buttons do not act. The picker below is how to change page.
   */
  const pages = usePreviewPages();
  const [surface, setSurface] = useState<"components" | "page">("components");
  const [pageId, setPageId] = useState(pages[0]!.id);
  const page = pages.find((p) => p.id === pageId) ?? pages[0]!;
  const surfaceRef = useRef(surface); surfaceRef.current = surface;
  const themeQs = themeKey ? `${PREVIEW_THEME_PARAM}=${encodeURIComponent(themeKey)}` : "";
  const previewSrc = surface === "page"
    ? `${page.route}${page.route.includes("?") ? "&" : "?"}${LAYOUT_PREVIEW_PARAM}=draft${themeQs ? `&${themeQs}` : ""}`
    : `/__theme-preview${themeQs ? `?${themeQs}` : ""}`;
  const prevGroup = useRef<string | undefined>(undefined);

  // Inject token + overlay styles whenever inputs change; scroll to the active group
  // only when it actually changes (not on every keystroke edit).
  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const apply = () => {
      const doc = iframe.contentDocument;
      if (!doc || !doc.head) return;

      let tok = doc.getElementById("xentium-preview-tokens") as HTMLStyleElement | null;
      if (!tok) { tok = doc.createElement("style"); tok.id = "xentium-preview-tokens"; doc.head.appendChild(tok); }
      tok.textContent = `${css}\n${extraCss}`;

      let ov = doc.getElementById("xentium-preview-overlay") as HTMLStyleElement | null;
      if (!ov) { ov = doc.createElement("style"); ov.id = "xentium-preview-overlay"; doc.head.appendChild(ov); }
      ov.textContent = previewOverlayRules({ activeGroup, hotspots, previewState });

      if (activeGroup && activeGroup !== prevGroup.current) {
        doc.querySelector(groupSelector(activeGroup))?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      prevGroup.current = activeGroup;
    };
    apply();
    iframe.addEventListener("load", apply);
    return () => iframe.removeEventListener("load", apply);
  }, [css, extraCss, activeGroup, previewState, hotspots]);

  // Capture-phase click-to-select on the iframe document (attached once per load).
  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let boundDoc: Document | null = null;
    const handler = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest) return;
      if (surfaceRef.current === "page") {
        // The real page: nothing it does on a click may happen here.
        e.preventDefault();
        e.stopPropagation();
        const [group, scope] = pickOnPage(el);
        onPickRef.current(group, scope);
        return;
      }
      // The header's dropdowns and the pill they open from have no data-component of
      // their own (they are the live components, not specimens): a dropdown is a Menu,
      // the pill around it is the User menu. Both are global; no region scope reaches
      // the masthead. A plugin dropdown that paints the card inline has no class yet.
      if (el.closest(`.xt-pop, ${PILL} [style*="background: var(--c-card)"]`)) { onPickRef.current("menu", "global"); return; }
      if (el.closest(PILL)) { onPickRef.current("usermenu", "global"); return; }
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
        <div className="se-canvas__surface">
          <div className="se-seg" role="tablist" aria-label={t("styleEditor.previewSurface")}>
            {(["components", "page"] as const).map((sf) => (
              <button key={sf} type="button" role="tab" aria-selected={surface === sf}
                className={`se-chip${surface === sf ? " is-on" : ""}`} onClick={() => setSurface(sf)}>
                {t(`styleEditor.surface.${sf}`)}
              </button>
            ))}
          </div>
          {surface === "page" && (
            <select className="se-scope__select" value={page.id} aria-label={t("styleEditor.previewPage")}
              onChange={(e) => setPageId(e.target.value)}>
              {pages.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
        </div>
        {/* Outlines and forced states are drawn on the specimen's own markup. */}
        {surface === "components" && <div className="se-canvas__right">
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
        </div>}
      </div>
      <div className="se-canvas__frame">
        <iframe ref={ref} src={previewSrc} title={t("styleEditor.previewTitle")} />
      </div>
    </div>
  );
}

interface PreviewPage { id: string; label: string; route: string }

/**
 * The pages the Page preview offers: the core pages, the admin's own profile (a
 * profile needs a member to show), and every plugin page that declared where it lives.
 */
function usePreviewPages(): PreviewPage[] {
  const { t } = useTranslation("acp");
  const { user } = useAuth();
  const pages: PreviewPage[] = [
    { id: "home", label: t("layoutEditor.template.home"), route: "/" },
    { id: "article.index", label: t("layoutEditor.template.article.index"), route: "/articles" },
    { id: "members", label: t("layoutEditor.template.members"), route: "/members" },
  ];
  if (user?.username) {
    pages.push({ id: "profile", label: t("layoutEditor.template.profile"), route: `/u/${encodeURIComponent(user.username)}` });
  }
  for (const def of listTemplates()) {
    if (def.pluginId && def.previewRoute) pages.push({ id: def.key, label: def.label ?? def.key, route: def.previewRoute });
  }
  return pages;
}

// ── Branding ──────────────────────────────────────────────────────────────────

/**
 * The brand where visitors meet it: the masthead (in the site's own band colours),
 * a browser tab and a phone's home screen. The tab sets the STAGED logo-icon colours
 * around it, so a change in Colours & type shows here before it is published.
 */
function BrandingPreview({ logoText, navbarUrl, iconUrl }: {
  logoText: string; navbarUrl: string | null; iconUrl: string | null;
}) {
  const { t } = useTranslation("acp");
  const { data: site } = useSiteConfig();
  const doc = useLayoutDocument("chrome.header");
  const band = (doc.regions.header ?? []).find((b) => b.type === "header");
  const background = band ? sectionBackground(band.props as Parameters<typeof sectionBackground>[0]) : undefined;
  const name = logoText || t("styleEditor.logoPlaceholder");
  const siteName = site?.siteName || name;
  const favicon = iconUrl
    ? <img className="br-fav" src={iconUrl} alt="" />
    : <XentiumMark size={16} className="br-fav" />;

  return (
    <div className="br-preview">
      <span className="br-preview__label">{t("styleEditor.brandPreview")}</span>

      <div className="br-mast" style={background ? { backgroundImage: background } : undefined}>
        <span className="br-mast__brand">
          {navbarUrl
            ? <img className="xt-logo-fx br-mast__img" src={navbarUrl} alt="" />
            : <><XentiumMark size={40} className="xt-logo-fx" /><span className="br-mast__word">{name}</span></>}
        </span>
        <span className="br-mast__pill" aria-hidden><i /><i /><i /></span>
      </div>

      <div className="br-places">
        <div className="br-tab" aria-label={t("styleEditor.brandTab")}>
          <span className="br-tab__dots" aria-hidden><i /><i /><i /></span>
          <span className="br-tab__tab">{favicon}<span>{siteName}</span></span>
        </div>
        <div className="br-home" aria-label={t("styleEditor.brandHome")}>
          {iconUrl ? <img className="br-home__icon" src={iconUrl} alt="" /> : <XentiumMark size={52} className="br-home__icon" />}
          <span>{siteName}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * One uploadable brand file: what is live now (the upload, or the shipped Xentium
 * default), and Upload / Replace / Remove. The whole row takes a dropped file too.
 */
function BrandAsset({ label, hint, currentUrl, accept, onUpload, onDelete, busy, wide = false }: {
  label: string; hint: string; currentUrl: string | null; accept: string;
  onUpload: (f: File) => void; onDelete: () => void; busy: boolean; wide?: boolean;
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
    <div
      className={`br-asset${over ? " is-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) take(e.dataTransfer.files[0]); }}
    >
      <span className={`br-asset__thumb${wide ? " br-asset__thumb--wide" : ""}`}>
        {currentUrl ? <img src={currentUrl} alt="" /> : <XentiumMark size={wide ? 30 : 34} />}
      </span>
      <span className="br-asset__text">
        <span className="br-h">{label}</span>
        <span className="br-asset__state">{currentUrl ? t("styleEditor.brandCustom") : t("styleEditor.brandDefault")}</span>
        <span className="br-asset__hint">{hint} · {t("styleEditor.brandDrop")}</span>
      </span>
      <span className="br-asset__actions">
        <Button variant="ghost" disabled={busy} onClick={() => inputRef.current?.click()}>
          <FontAwesomeIcon icon={faUpload} /> {currentUrl ? t("styleEditor.brandReplace") : t("styleEditor.brandUpload")}
        </Button>
        {currentUrl && (
          <Button variant="ghost" className="br-asset__remove" disabled={busy} onClick={onDelete}
            title={t("styleEditor.brandRemoveHint")}>
            {t("styleEditor.remove")}
          </Button>
        )}
      </span>
      <input ref={inputRef} type="file" accept={accept} hidden
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

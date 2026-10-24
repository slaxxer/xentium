/**
 * Layout editor (ADR-0005).
 *
 * A structure/settings rail beside a live preview. The tree is the backbone and
 * the props panel is generated from the selected block's Zod schema — the same
 * interaction model ADR-0003 locked for the Style Editor, so an admin does not
 * learn two ways to edit appearance.
 *
 * Blocks are dropped into an ordered list inside a fixed region, never onto a
 * coordinate, so a non-developer cannot produce a layout that is broken on
 * mobile. Reordering works from the tree (drag or the ↑/↓ buttons, which are the
 * keyboard path) and from inside the preview itself via `previewBridge`.
 *
 * The draft AUTOSAVES, matching the ACP convention for config surfaces; the
 * preview renders the in-progress document pushed over postMessage, so an edit
 * is visible before it is persisted. Publish stays explicit — going live is the
 * deliberate act.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faPlus, faRotateLeft, faRotateRight, faXmark,
  faDesktop, faTabletScreenButton, faMobileScreenButton, faEye, faUsers, faCube, faPalette, faCircleQuestion, faArrowUp, faArrowDown, faUpDownLeftRight,
  faCheck, faSpinner, faEllipsis,
  faChevronDown, faFileLines, faWindowMaximize, faArrowUpRightFromSquare,
  faClone, faTrash, faIcons, faCodeCompare,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { z } from "zod";
import {
  CORE_TEMPLATE_KEYS,
  DEFAULT_VARIANT,
  defaultLayoutFor,
  isChromeTemplate,
  regionsFor,
  requiredBlocksFor,
  type BlockNode,
  type AudienceView,
  type BlockVariant,
  type BlockVisibility,
  type LayoutDocument,
  type LayoutDraftResponse,
  type LayoutSelector,
  type HeadingFont,
  type CoreTemplateKey,
  type TemplateKey,
} from "@xentium/contracts";
import { api } from "../../../lib/api";
import { articlesApi } from "../../../lib/articlesApi";
import { authStore } from "../../../lib/authStore";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { SchemaFields, defaultsFor, type FieldSchema } from "../../../components/SchemaFields";
import { acceptsChild, getBlock, hasSurface } from "../../../layout/blockRegistry";
import { shortcutFor } from "../../../layout/editorShortcuts";
import { blockTextType } from "../../../layout/slotBlocks";
import { LAYOUT_PREVIEW_PARAM, LAYOUT_EDITING_PARAM } from "../../../layout/useLayout";
import {
  ancestorsOf,
  canNestInto,
  cloneBlock,
  collectIds,
  countDescendants,
  findNode,
  insertBlock,
  moveBlock,
  newBlockId,
  removeBlock,
  updateBlockProps,
  updateBlockVariant,
  updateBlockEdges,
  updateBlockClassName, updateBlockHeadingFont,
  updateBlockVisibility,
  updateBlockIconOverride,
  type Regions,
} from "../../../layout/blockTree";
import { useDebouncedSave } from "../../../hooks/useAutosave";
import { useLayoutHistory, type LayoutSnapshot } from "./useLayoutHistory";
import { iconFor } from "../../../layout/blockIcons";
import { dateFromMonthDay } from "../../../layout/edgeArt";
import {
  BlockList,
  regionLabel,
  type DragSrc,
  type DropAt,
  type TreeCtx,
} from "./LayoutTree";
import { BlockVisibilityFields } from "./BlockVisibility";
import { BlockCatalogue } from "./BlockCatalogue";
import { BlockLibrary } from "./BlockLibrary";
import { SiteFramePopover } from "./SiteFramePopover";
import { ChromeStyles } from "./ChromeStyles";
import { StudioTour } from "./StudioTour";
import { useUiFlag } from "../../../hooks/useUiFlag";
import { PREVIEW_THEME_PARAM, useEditingTheme, withTheme } from "../../../lib/editingTheme";
import type { EdgeArt, SiteFrame } from "@xentium/contracts";
import { BlockStyleFields } from "./BlockStyle";
import { BlockMenuStyle, menuGroupsFor } from "./BlockMenuStyle";
import { BlockBackgroundFields, BACKGROUND_PROPS } from "./BlockBackground";
import { BlockEdgeArtFields } from "./BlockEdgeArt";
import { edgeExtensions } from "../../../layout/edgeRegistry";
import { CHROME_SETTINGS } from "./ChromeSettings";
import { ThemeStyleFields, effectiveGlobal, themeDraftCss, useThemeTokenPatch, useThemeTokens } from "./ThemeStyle";
import { blockPanelsFor } from "../../../layout/blockPanelRegistry";
import { InspectorFold } from "./InspectorFold";
import { SectionColumnsPicker, SectionPresets } from "./SectionPresets";
import {
  buildPreset, layoutChanges, sectionLayoutOf, setSectionLayout,
  type PresetText, type RemovedBlock, type SectionPreset,
} from "../../../layout/sections";
import "./LayoutEditorPage.scss";
import { IconPicker } from "../../../components/IconPicker";
import { blockLabel, pluginText } from "../../../lib/coreText";
import { Button } from "../../../components/AcpControls";

/**
 * The three canvas widths, and what they are for.
 *
 * Not a viewport emulation — no touch, no user agent, no device pixel ratio. It is
 * the ONE thing the site's own CSS reads, which is what makes the collapse an admin
 * is checking for happen: `.xt-body-row` stacks at 1024, `.xt-columns` wraps when its
 * tracks stop fitting, the navbar folds at 640.
 */
/**
 * ⚠ Desktop FILLS the canvas rather than pinning a number. A fixed 1280 left a band
 * of dead pane beside the page AND drew the site narrower than there was room to show
 * it — two ways of being wrong at once, since the widest view available is the pane
 * itself and a desktop visitor's window is whatever it is. The two small widths stay
 * fixed: they are checks against specific breakpoints, and a tablet that grew with
 * the window would not be a tablet.
 */
type DeviceId = "desktop" | "tablet" | "phone";

/**
 * Desktop is never drawn narrower than this.
 *
 * Since the settings became their own pane (ADR-0012) the canvas can be ~620px on a
 * 1440 screen, and "fill" there drew the PHONE navbar under a Desktop label. Below this
 * width the page is drawn at it and scaled to fit (Fit is the default), which keeps the
 * layout a desktop visitor gets.
 */
const DESKTOP_MIN = 1200;
const DEVICES: Record<DeviceId, { width: number | "fill"; icon: IconDefinition }> = {
  desktop: { width: "fill", icon: faDesktop },
  tablet:  { width: 834,    icon: faTabletScreenButton },
  phone:   { width: 390,    icon: faMobileScreenButton },
};

/** The route each template previews at. Themes re-lay-out existing pages, so a
 *  template always has exactly one real URL to show. */
/**
 * Where each template previews.
 *
 * Only a FALLBACK for the two templates that render per instance — `profile` and
 * `article.detail` need a real slug or username, resolved at runtime
 * below. Previously `profile` pointed at `/members` and `article.detail` at the
 * article index, so choosing either showed a page the blocks being arranged do not
 * even appear on.
 */
const PREVIEW_ROUTE: Record<CoreTemplateKey, string> = {
  "home":           "/",
  "article.index":  "/articles",
  "article.detail": "/articles",
  "profile":        "/members",
  "members":        "/members",
  // Chrome renders on every route, so any page previews it. "/" is the least
  // surprising one to look at while rearranging a navbar or footer.
  "chrome.header":  "/",
  "chrome.footer":  "/",
};

interface TemplateInfo {
  key: TemplateKey;
  regions: string[];
  /**
   * The plugin's own name for the template. `null` for core, whose eight keys the
   * ACP bundle translates — a plugin's label is a literal in the plugin's language
   * and there is nothing to look up.
   */
  label?: string | null;
  /** Owning plugin, or `null` for core. Groups the picker and marks the rows. */
  pluginId?: string | null;
  /** Where the plugin says its page lives, e.g. `/forum`. */
  previewRoute?: string | null;
  /** The installed theme ships this template — so there is something to revert TO. */
  hasTheme?: boolean;
  /** This template has moved away from its baseline, so a theme update would keep it. */
  customised?: boolean;
}





/**
 * The revision the server holds, out of a 409 body.
 *
 * Carried so "keep mine" can be a deliberate overwrite in one round trip rather than
 * a re-read followed by a save, which would leave a window for a third write.
 */
function conflictVersion(e: unknown): string | null {
  const details = (e as { detail?: { error?: { details?: { version?: unknown } } } })
    .detail?.error?.details?.version;
  return typeof details === "string" ? details : null;
}

/**
 * Blocks the STYLE EDITOR already paints.
 *
 * For these, an empty background panel means "inheriting those colours", not "no
 * background" — the footer's band is `--footer-bg` under `SCOPE_SELECTOR.footer`
 * whether or not this panel has anything in it. Naming them here keeps the wrong
 * word off the one screen where an admin would otherwise go hunting for a colour
 * control that lives in another editor.
 */
const STYLED_SURFACES = new Set(["footer"]);

/** JSON Schema for a block's props, straight from its registered Zod schema. */
/** True when a block's own schema carries the background props — the panel below
 *  edits them, and `SchemaFields` skips them, from this one answer. */
function paintsBackground(type: string): boolean {
  const props = schemaFor(type)?.properties ?? {};
  return BACKGROUND_PROPS.every((p) => p in props);
}

function schemaFor(type: string): FieldSchema | null {
  const def = getBlock(type);
  if (!def) return null;
  try {
    return z.toJSONSchema(def.schema as never, { io: "input" }) as FieldSchema;
  } catch {
    return null;
  }
}

/**
 * A new block, carrying the children its type is useless without.
 *
 * A `columns` row with no tracks is an empty grid, and adding two would be every
 * admin's next action, so it arrives with them. The track count IS the number of
 * columns, so this is also what gives the block its shape.
 */
function makeNode(type: string, taken: Set<string>): BlockNode {
  const node: BlockNode = { id: newBlockId(taken), type, props: defaultsFor(schemaFor(type)) };
  if (type === "columns") {
    node.children = [
      { id: newBlockId(taken), type: "column", props: {} },
      { id: newBlockId(taken), type: "column", props: {} },
    ];
  }
  return node;
}

/**
 * What the site inherits from, if anything.
 *
 * Only the NAME is wanted here, for the "Revert to theme" confirmation. Importing and
 * exporting moved to Appearance → Themes (2026-08-15): a manifest is a form and an
 * import report is something you read, and neither belongs in a collapsed strip above
 * the editor. Revert stays, because it acts on ONE template and belongs beside the
 * template picker.
 */
interface InstalledTheme {
  manifest: { name: string; version: string } | null;
}

/**
 * The Layout Editor edits ONE theme's layouts — the one in `?theme=`, else the live
 * one. Keyed by it, so switching themes starts fresh: undo history, selection and the
 * open document all belong to the theme they were made in.
 */
/**
 * Whether the block clips what is drawn outside its box, measured in the preview: a
 * theme's cut card corners are a clip-path on the card, which hides an outward edge.
 * Read when the panel renders; the preview is same-origin.
 */
function clipsOutside(frame: HTMLIFrameElement | null, id: string): boolean {
  try {
    const el = frame?.contentDocument?.querySelector(`[data-xt-block="${CSS.escape(id)}"]`)?.firstElementChild;
    return !!el && getComputedStyle(el).clipPath !== "none";
  } catch {
    return false;
  }
}

export function LayoutEditorPage() {
  // Only Theme Studio renders it: the Studio owns the page header and the one Publish
  // for layouts and styles together.
  const { key } = useEditingTheme();
  return <LayoutEditorInner key={key ?? ""} themeKey={key} />;
}

function LayoutEditorInner({ themeKey }: { themeKey: string | null }) {
  const { t, i18n } = useTranslation("acp");
  const qc = useQueryClient();

  const [templateKey, setTemplateKey] = useState<TemplateKey>("article.index");
  /**
   * Which PAGE the preview is showing, which is not always the document being edited.
   *
   * The site header and footer render on every page, so opening one of them should
   * not throw away the page you were looking at — you clicked the masthead ON this
   * page, and that is where you want to see the change. Only a page template moves
   * the preview.
   */
  const [previewPageKey, setPreviewPageKey] = useState<TemplateKey>("article.index");
  /** Read by the preview's message listener, which is registered once and must not
   *  close over the template that happened to be open when it was attached. */
  const templateKeyRef = useRef<TemplateKey>(templateKey);
  templateKeyRef.current = templateKey;
  /** Same reason as `templateKeyRef`: the push runs from a listener registered once. */
  const iconModeRef = useRef(false);
  /**
   * The full push, kept current for the message listener.
   *
   * ⚠ That listener is registered once with no deps, so it cannot call `pushTo`
   * directly — it would send whatever document and audience existed when the editor
   * mounted. Assigned on every render instead.
   */
  const pushAllRef = useRef<() => void>(() => {});
  /** The last change marks sent to the preview, so a reloaded frame gets them again. */
  const changesMsgRef = useRef<{ ids: string[]; show: boolean }>({ ids: [], show: false });
  // Always the template default: no template takes variants since custom pages were
  // removed. Kept as a name because every request and preview message carries it.
  const variant = DEFAULT_VARIANT;
  const [doc, setDoc] = useState<LayoutDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  /**
   * The second editing axis: WHOSE arrangement is being worked on.
   *
   * Two values, because a site has two kinds of visitor and no third view is needed —
   * an unrestricted block belongs to both arrangements and appears in both, so nothing
   * can hide from the editor. Defaults to `members`: the signed-in experience is what
   * most templates are about, and every template except `home` has only one arrangement.
   */
  const [audience, setAudience] = useState<AudienceView>("members");
  /**
   * Icon mode, and the icon it produced.
   *
   * ⚠ Two pieces of state, not one. The MODE stays on while an admin works through
   * several icons — turning it off after each pick would make changing four icons
   * four trips to the toolbar — while the SELECTION is whichever one is open now.
   */
  const [iconMode, setIconMode] = useState(false);
  iconModeRef.current = iconMode;
  const [iconPick, setIconPick] = useState<{ id: string; slot: string } | null>(null);
  /**
   * ⚠ The rail scrolls, and this panel opens BELOW the block's own settings. An admin
   * clicks an icon in the preview and the thing that answered them can be off-screen —
   * which reads as "nothing happened", the same complaint that turned out to be the
   * handshake race. Cheap insurance against the same symptom from a different cause.
   */
  const iconPanelRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);

  /**
   * WHICH REGION the structure pane is showing.
   *
   * Regions were stacked, every one of them, headings and all — which reads as four
   * things to fill on a template where three are usually empty. As tabs they read as
   * one page with parts, the count says which parts have anything in them, and the
   * block library below has an unambiguous target to add into.
   *
   * `null` means "not chosen yet": resolved to the template's first region on render,
   * so a template switch cannot leave a tab selected that the new template lacks.
   */
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  useEffect(() => { setActiveRegion(null); }, [templateKey]);

  /**
   * The canvas: what it shows, and how big.
   *
   * ⚠ The width is MANUAL. An earlier version scaled the frame automatically to fit
   * the pane, and it was wrong to: an admin arranging a page has a right to see it at
   * the size they chose, and a preview that silently resizes itself is one more thing
   * that might explain what they are looking at. Nothing moves here unless a button
   * is pressed.
   */
  /**
   * THE INSPECTOR FLOATS. It overlays the canvas instead of taking a third column.
   *
   * ⚠ Out of grid flow on purpose. As a column it cost the canvas 320px — enough that
   * a 1280 desktop preview could not be drawn at 100% — and, worse, appearing and
   * disappearing with the selection RESIZED the stage, which changes the Fit scale,
   * so the whole page visibly re-scaled on every click. Overlaying costs some pixels
   * of preview; reflowing cost the preview its honesty.
   *
   * Open follows the selection, and × or Escape closes it WITHOUT deselecting: the
   * highlight in the tree and the frame in the preview are worth keeping while you
   * look at what you just changed. `reopen` is how it comes back.
   */
  /** The draft-actions menu, and the click-away target that closes it. */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * Whether this session has actually stored something.
   *
   * ⚠ Gates the "Autosaved" pill. Without it a freshly loaded editor claims to have
   * just saved — an event that did not happen, on a page where the difference between
   * "stored" and "live" is the whole point.
   */
  const [savedOnce, setSavedOnce] = useState(false);

  /**
   * The catalogue dialog's target, or null while it is closed.
   *
   * It carries WHERE a pick lands rather than reading the open region when it opens:
   * the dialog can be raised from a container's own placeholder, and a container
   * accepts a different set from the region around it.
   */
  const [browseTarget, setBrowseTarget] =
    useState<{ region: string; parentId: string | null } | null>(null);

  /**
   * The rail's tab. BLOCKS is the library — the way to add — and the default, because
   * the page itself is now where blocks are selected and arranged. LAYERS is the whole
   * tree: still needed for what the canvas cannot show (a spacer, a block hidden from
   * the audience in view, a disabled plugin's block) and for keyboard users.
   */
  const [railTabChosen, setRailTab] = useState<"blocks" | "layers">("blocks");
  /**
   * Simple (the default) or Advanced, remembered per admin on the server. Simple
   * hides what a first visit does not need — the Layers tree, icon mode, the
   * season/time viewers, the preview URL, the Theme style tab, "Who sees it" and edge
   * art — so the editor is the page, the blocks and the selected block's settings.
   */
  const advancedFlag = useUiFlag("layout:advanced");
  const advanced = advancedFlag.on === true;
  const railTab = railTabChosen;

  /**
   * The first-visit tour. Opens by itself once per admin, the first time the editor
   * is actually on screen with a page loaded; "?" replays it. Closing (finished or
   * skipped) marks it seen on the server.
   */
  const tourFlag = useUiFlag("tour:theme-studio");
  const [tourOpen, setTourOpen] = useState(false);
  const tourAutoStarted = useRef(false);
  const closeTour = () => { setTourOpen(false); if (tourFlag.on === false) tourFlag.set(true); };

  /**
   * A spot marked on the page (the `+` under a block, or an empty region clicked):
   * the next library pick lands exactly there. Cleared once something lands, or when
   * the document changes underneath it.
   */
  const [insertTarget, setInsertTarget] = useState<DropAt | null>(null);

  /** The "Move to…" list in the settings panel. */
  const [moveOpen, setMoveOpen] = useState(false);
  const [device, setDevice] = useState<DeviceId>("desktop");
  const [zoom, setZoom] = useState<"fit" | "full">("fit");
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect;
      setStage({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * How wide to draw the frame.
   *
   * `fill` resolves to the measured canvas, so the page is drawn at exactly the width
   * there is room for — no dead band, no scaling, nothing to reconcile. The 1280 is
   * only for the first paint, before the ResizeObserver has measured anything.
   */
  const configuredWidth = DEVICES[device].width;
  const deviceWidth = configuredWidth === "fill"
    ? Math.max(stage.w > 0 ? stage.w : 1280, DESKTOP_MIN)
    : configuredWidth;
  /**
   * How much room the frame wants, against how much the pane has.
   *
   * Fit never magnifies: a phone frame blown up to fill a wide pane is a lie about
   * how big the text is. It only ever shrinks a frame that would not otherwise fit —
   * which, at desktop width in a narrow window, is the whole reason it exists.
   */
  const neededWidth = deviceWidth;
  const scale = zoom === "fit" && stage.w > 0 ? Math.min(1, stage.w / neededWidth) : 1;
  /** Whether the frame wants more room than the pane has — what makes Fit meaningful. */
  const oversized = stage.w > 0 && neededWidth > stage.w;


  /**
   * The frame's own height, and the box that holds it.
   *
   * ⚠ A transform does not change LAYOUT size: a scaled frame still occupies its full
   * width and height in the stage, which left a band of dead space below and beside
   * what was actually drawn. The wrapper is sized to what is DRAWN and clips; the
   * frame inside keeps the device's real dimensions, which is what its media queries
   * read.
   */
  const frameHeight = stage.h > 0 ? Math.round(stage.h / scale) : 560;
  const frameBox = {
    width:  Math.round(deviceWidth * scale),
    height: Math.round(frameHeight * scale),
  };
  const frameStyle = {
    width:  deviceWidth,
    height: frameHeight,
    transform: scale === 1 ? undefined : `scale(${scale})`,
    transformOrigin: "0 0",
  } as const;

  const history = useLayoutHistory();

  /**
   * Mirrors of the two pieces of editing state that long-lived listeners read.
   *
   * The preview's message listener and the keyboard shortcuts are registered ONCE,
   * so reading `doc` from their closure would apply every edit to the document as it
   * was on first render. Assigned during render so they are never a tick behind, and
   * again by `commitDoc` so a handler that edits twice in one tick sees its own first
   * edit rather than the state before it.
   */
  const docRef = useRef<LayoutDocument | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  docRef.current = doc;
  selectedIdRef.current = selectedId;

  /**
   * The document as last persisted, for deciding whether there is anything to save.
   *
   * A ref rather than the query's data: a successful save deliberately does NOT
   * invalidate the layout query — refetching would stomp whatever was typed while the
   * write was in flight — so the query keeps returning the document as it was when the
   * editor opened.
   */
  const savedJsonRef = useRef<string | null>(null);

  /**
   * The revision this editor read, sent with every save so a write built on a stale
   * document is refused instead of silently flattening whoever got there first.
   * `null` is meaningful: "there was no row when I loaded".
   */
  const versionRef = useRef<string | null>(null);
  /**
   * Set when a save is refused. While it holds, autosave is SUSPENDED — a debounced
   * writer that keeps retrying a conflict would hammer the endpoint and bury the one
   * message the admin needs to read.
   */
  const [conflict, setConflict] = useState<{ version: string | null } | null>(null);

  /**
   * The one way the working document changes, so the mirror cannot fall behind it.
   *
   * "Dirty" is COMPARED here rather than latched on edit. Undoing back to where you
   * started is the most ordinary gesture there is, and a flag that only a save can
   * clear would leave the toolbar claiming unsaved changes over a document identical
   * to the stored one — while autosave, which compares properly, correctly declines
   * to write anything.
   */
  const commitDoc = (next: LayoutDocument) => {
    docRef.current = next;
    setDoc(next);
    setDirty(savedJsonRef.current !== null && JSON.stringify(next) !== savedJsonRef.current);
  };

  // Drag state. The source lives in a ref because it must survive the drag
  // without re-rendering the tree under the pointer; only the drop indicator is
  // state. The ↑/↓ buttons stay as the keyboard path — drag is an accelerator,
  // never the only way to reorder.
  const dragRef = useRef<DragSrc | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<DropAt | null>(null);
  // The drop position is mirrored into a ref because `drop` must read what the
  // last `dragover` computed. Reading it from state would depend on React having
  // re-rendered between the two events — which it usually does during a real
  // drag and does not when they arrive in the same tick, making the drop
  // silently do nothing.
  const dropRef = useRef<DropAt | null>(null);

  const setDrop = (next: DropAt | null) => {
    dropRef.current = next;
    setDropAt(next);
  };

  const endDrag = () => { dragRef.current = null; setDragId(null); setDrop(null); };

  /** What the site inherits from, if anything. */
  const installedQuery = useQuery<InstalledTheme>({
    queryKey: ["acp-theme-installed"],
    queryFn:  () => api.get("/admin/themes/installed"),
    staleTime: 60_000,
  });
  const installedTheme = installedQuery.data;

  const templatesQuery = useQuery<TemplateInfo[]>({
    queryKey: ["acp-layout-templates", themeKey],
    queryFn:  () => api.get(withTheme("/admin/layouts/templates", themeKey)),
    // A plugin's template name in the reader's language when the plugin ships one.
    select:   (rows) => rows.map((r) => r.pluginId && r.label ? { ...r, label: pluginText(`templates.${r.key}`, r.label) } : r),
  });

  // The theme being edited, on every per-document request.
  const qs = withTheme("", themeKey);

  const draftQuery = useQuery<LayoutDraftResponse>({
    queryKey: ["acp-layout", templateKey, variant, themeKey],
    queryFn:  () => api.get(`/admin/layouts/${templateKey}${qs}`),
  });
  const draftDoc = draftQuery.data?.document;

  const statusQuery = useQuery<{ pending: LayoutSelector[] }>({
    queryKey: ["acp-layout-status", themeKey],
    queryFn:  () => api.get(withTheme("/admin/layouts/draft-status", themeKey)),
  });


  // `article.detail` needs a real article, or the preview shows the index and none of
  // the blocks being arranged.
  const previewArticleQuery = useQuery({
    queryKey: ["acp-layout-preview-article"],
    queryFn:  () => articlesApi.list({ page: 1, limit: 1, feed: "latest" }),
    enabled:  templateKey === "article.detail",
    staleTime: 60_000,
  });
  const previewArticleSlug = previewArticleQuery.data?.data?.[0]?.slug;

  // `profile` needs a real user. The signed-in admin always has one, so this costs
  // nothing and never shows an empty profile.
  const previewUsername = authStore.user?.username;

  /**
   * Server state seeds local editing state; local edits win until saved.
   *
   * The selection SURVIVES a refetch as long as the block is still there. This query
   * refetches on window focus, so dropping the selection unconditionally meant that
   * alt-tabbing away — to compare a colour, to read a spec — closed the settings panel
   * and lost your place. Only a block that no longer exists clears it, which is the
   * case the reset actually existed for.
   */
  useEffect(() => {
    if (!draftDoc) return;
    savedJsonRef.current = JSON.stringify(draftDoc);
    versionRef.current = draftQuery.data?.version ?? null;
    setConflict(null); // a fresh read is, by definition, no longer stale
    commitDoc(draftDoc); // clean by definition — it IS what is stored
    setSelectedId((current) => (current && findNode(draftDoc.regions, current) ? current : null));
    // NOT cleared here. This query refetches on window focus, so clearing would make
    // alt-tabbing away — to check a colour, to read a spec — silently throw away the
    // undo stack. The history is dropped where the document genuinely changes identity
    // (template/variant) or is replaced wholesale by the server (reset, revert, discard,
    // theme import).
  }, [draftQuery.data]);

  /**
   * A different template or variant is a different document; its edit history is not
   * transferable, and offering an undo that would paste one page's arrangement over
   * another's is worse than offering none.
   */
  useEffect(() => { history.clear(); }, [templateKey, variant]);

  /** A page template is also the page the preview renders; chrome is not. */
  useEffect(() => {
    if (!isChromeTemplate(templateKey)) setPreviewPageKey(templateKey);
  }, [templateKey]);

  /**
   * Messages from the preview iframe: an admin clicked a block, or dragged one.
   * The editor stays the single source of truth — the preview reports intent and
   * this applies it to the document, exactly as the tree does.
   */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return; // never trust a foreign frame
      const msg = e.data as {
        source?: string; type?: string; id?: string; templateKey?: string;
        region?: string; parentId?: string | null; index?: number;
        action?: "undo" | "redo";
        left?: number; right?: number;
        slot?: string;
        blockType?: string; delta?: number;
        beforeId?: string | null; afterId?: string | null; preset?: string;
        prop?: string; value?: string;
      };

      if (msg?.source !== "xt-preview") return;

      /**
       * Clicking a block OPENS its document.
       *
       * The header and footer are on the page an admin is arranging — the masthead
       * band and the navbar ARE the header — so clicking one has to lead somewhere.
       * It leads here: the editor switches to that document and selects the block, so
       * the next thing you can do is delete the logo or drop something beside it.
       * The preview stays on the same page (`previewPageKey`), because that is where
       * the click happened.
       *
       * ⚠ One document at a time, deliberately. Each has its own draft and its own
       * publish; editing two behind one screen is how a Publish comes to mean
       * something other than what the button says. Switching is the honest version,
       * and the tree keeps showing the whole page either way.
       */
      if (msg.type === "select" && msg.id) {
        if (msg.templateKey && msg.templateKey !== templateKeyRef.current) {
          setTemplateKey(msg.templateKey as TemplateKey);
        }
        setSelectedId(msg.id);
      }

      /**
       * The preview's bridge is listening.
       *
       * ⚠ The `onLoad` push races it — the iframe fires `load` before the React app
       * inside has mounted and subscribed, so that push is dropped. The document
       * survived only because it is re-pushed on every change; icon mode was pushed
       * once and lost, which left the toggle looking on while the preview had no idea.
       */
      if (msg.type === "ready") pushAllRef.current();

      /**
       * One icon was clicked, in icon mode.
       *
       * ⚠ The block is selected too. The override is stored ON that block, so the
       * rail must be showing it — otherwise an admin picks an icon and the panel that
       * opens belongs to something else.
       */
      if (msg.type === "iconPick" && msg.id && msg.slot) {
        if (msg.templateKey && msg.templateKey !== templateKeyRef.current) {
          setTemplateKey(msg.templateKey as TemplateKey);
        }
        setSelectedId(msg.id);
        setIconPick({ id: msg.id, slot: msg.slot });
      }

      // An empty region was clicked in the preview. Open the SAME add-block picker
      // the region's own `+` opens — the key is `r:<region>`, so there is one picker
      // and one code path whichever surface asked for it.
      // Marks the region as the next pick's spot and opens the library on it — the
      // same thing the `+` under a block does, for a region that has no block yet.
      if (msg.type === "addTo" && msg.region) {
        if (msg.templateKey && msg.templateKey !== templateKeyRef.current) {
          setTemplateKey(msg.templateKey as TemplateKey);
          latest.current.browse(msg.region!, null);
          return;
        }
        latest.current.markEnd(msg.region!);
      }

      // A block dragged in from the library and dropped on the page.
      // A preset arrives as one too, carrying which; it is a whole section, built here.
      if (msg.type === "insert" && msg.blockType && msg.region && typeof msg.index === "number") {
        const at = latest.current.placeAt({
          region: msg.region, parentId: msg.parentId ?? null, index: msg.index,
        }, msg.beforeId, msg.afterId);
        if (msg.preset) latest.current.insertPreset(msg.preset as SectionPreset, at);
        else latest.current.insertAt(msg.blockType, at);
      }

      // Text typed on the page. Applied like a settings-panel edit, one undo step.
      if (msg.type === "inlineEdit" && msg.id && msg.prop && typeof msg.value === "string") {
        latest.current.inlineEdit(msg.id, msg.prop, msg.value);
      }

      // The `+` under a block: the next pick goes straight after it.
      if (msg.type === "insertAfter" && msg.id) latest.current.markAfter(msg.id);

      // The chip's up/down — the same one-step move the tree's arrows make.
      if (msg.type === "nudge" && msg.id && typeof msg.delta === "number") {
        latest.current.nudge(msg.id, msg.delta);
      }

      if (msg.type === "move" && msg.id && msg.region && typeof msg.index === "number") {
        // Goes through the same `applyTree` the tree's own drags use, so a move made
        // in the preview is one undo step exactly like a move made in the rail. It
        // reads the document through `docRef`, which is why this listener can be
        // registered once and still never act on a stale document.
        const at = latest.current.placeAt({
          region: msg.region, parentId: msg.parentId ?? null, index: msg.index,
        }, msg.beforeId, msg.afterId);
        latest.current.applyTree((r) => moveBlock(r, msg.id!, at));
        setSelectedId(msg.id);
      }

      // Ctrl+Z inside the preview. Keystrokes in an iframe never reach this document,
      // and the preview is precisely where blocks get dragged into the wrong place —
      // so the bridge forwards the shortcut rather than making an admin click the rail
      // first to be allowed to undo.
      // The chip's own actions. They land in the SAME calls the tree's buttons use —
      // a second implementation of "duplicate this block" is how the two drift.
      if (msg.type === "duplicate" && msg.id) latest.current.duplicate(msg.id);
      if (msg.type === "remove" && msg.id) latest.current.remove(msg.id);


      if (msg.type === "shortcut") {
        if (msg.action === "undo") latest.current.undo();
        if (msg.action === "redo") latest.current.redo();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /**
   * Everything the frame needs, in one place.
   *
   * A frame that has just loaded has to be told all three things — the working
   * document, the audience it is drawn for, and the staged tokens — and each of them
   * is also pushed on its own when it changes. One helper for the load case is what
   * stops those three going out of step with each other.
   */
  const pushTo = (win: Window | null | undefined, forAudience: AudienceView) => {
    if (!win) return;
    if (doc) {
      win.postMessage(
        { source: "xt-editor", type: "document", templateKey, variant, document: doc },
        window.location.origin,
      );
    }
    win.postMessage({ source: "xt-editor", type: "audience", audience: forAudience }, window.location.origin);
    win.postMessage({ source: "xt-editor", type: "iconMode", on: iconModeRef.current }, window.location.origin);
    win.postMessage({ source: "xt-editor", type: "tokens", css: styleCss }, window.location.origin);
    if (liveFrame) win.postMessage({ source: "xt-editor", type: "frame", frame: liveFrame }, window.location.origin);
    win.postMessage({ source: "xt-editor", type: "previewDate", md: viewDateRef.current }, window.location.origin);
    win.postMessage({ source: "xt-editor", type: "previewHour", hour: viewHourRef.current }, window.location.origin);
    win.postMessage({ source: "xt-editor", type: "changes", ...changesMsgRef.current }, window.location.origin);
    // The preview draws a restricted block like any other — the chip is the only
    // place the condition shows — so it needs the words for it.
    win.postMessage(
      {
        source: "xt-editor", type: "labels",
        audience: {
          guests:  t("layoutEditor.audience.guests"),
          members: t("layoutEditor.audience.members"),
          groups:  t("layoutEditor.audience.groups"),
        },
        chip: {
          up:        t("layoutEditor.moveUp"),
          down:      t("layoutEditor.moveDown"),
          duplicate: t("layoutEditor.duplicateBlock"),
          remove:    t("layoutEditor.removeBlock"),
          insert:    t("layoutEditor.library.addHere"),
          changed:   t("layoutEditor.sections.changedTag"),
          dropHere:  t("layoutEditor.sections.dropHere"),
          empty:     t("layoutEditor.sections.emptyHere"),
        },
      },
      window.location.origin,
    );
  };

  useEffect(() => {
    if (iconPick) iconPanelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [iconPick]);

  pushAllRef.current = () => pushTo(previewRef.current?.contentWindow, audience);

  /**
   * Pending variant tokens, pushed into the preview as a stylesheet.
   *
   * The preview iframe loads the real route, which serves the PUBLISHED appearance CSS —
   * so a token edit staged in the appearance draft would be invisible here until
   * publish, which defeats the point of editing colours against a live preview. The
   * panel hands over the CSS it would produce and the bridge injects it.
   */
  const [variantCss, setVariantCss] = useState("");

  /**
   * The theme's staged GLOBAL tokens (Theme style tab, or the Style Editor), for the
   * same reason. Kept here rather than in the tab so the preview still shows them
   * after switching back to Block.
   */
  const { data: themeDraft } = useThemeTokens();
  const themeTokens = useMemo(() => effectiveGlobal(themeDraft), [themeDraft]);
  const patchThemeTokens = useThemeTokenPatch();
  const styleCss = useMemo(
    () => [themeDraftCss(themeDraft), variantCss].filter(Boolean).join("\n"),
    [themeDraft, variantCss],
  );

  /** Which half of the inspector is showing. Kept across selections: someone tuning
   *  the theme's look clicks from block to block to see it on each. */
  const [inspectorTab, setInspectorTab] = useState<"block" | "theme">("block");
  // Picking an icon in the preview opens its picker, which lives on the Block tab.
  useEffect(() => { if (iconPick) setInspectorTab("block"); }, [iconPick]);

  /**
   * The working site frame, from the Site layout popover. Pushed like the document:
   * the preview serves the draft frame, but an edit has to show before its autosave.
   */
  const [liveFrame, setLiveFrame] = useState<SiteFrame | null>(null);

  /** "Viewing on": the date the preview pretends it is (`MM-DD`), or null for today. */
  const [viewDate, setViewDate] = useState<string | null>(null);
  const viewDateRef = useRef<string | null>(null);
  viewDateRef.current = viewDate;

  useEffect(() => {
    previewRef.current?.contentWindow?.postMessage(
      { source: "xt-editor", type: "previewDate", md: viewDate },
      window.location.origin,
    );
  }, [viewDate]);

  /** "Viewing at": the hour the preview pretends it is (0–23), or null for now. */
  const [viewHour, setViewHour] = useState<number | null>(null);
  const viewHourRef = useRef<number | null>(null);
  viewHourRef.current = viewHour;

  useEffect(() => {
    previewRef.current?.contentWindow?.postMessage(
      { source: "xt-editor", type: "previewHour", hour: viewHour },
      window.location.origin,
    );
  }, [viewHour]);

  useEffect(() => {
    if (!liveFrame) return;
    previewRef.current?.contentWindow?.postMessage(
      { source: "xt-editor", type: "frame", frame: liveFrame },
      window.location.origin,
    );
  }, [liveFrame]);

  useEffect(() => {
    previewRef.current?.contentWindow?.postMessage(
      { source: "xt-editor", type: "tokens", css: styleCss },
      window.location.origin,
    );
  }, [styleCss]);

  /** Push the chosen audience into the preview whenever it changes. */
  useEffect(() => {
    previewRef.current?.contentWindow?.postMessage(
      { source: "xt-editor", type: "audience", audience },
      window.location.origin,
    );
  }, [audience]);

  /**
   * Selecting in the tree highlights the same block in the preview — and tells the
   * chip there what to say.
   *
   * `label` and `removable` travel with the id because neither is knowable inside the
   * frame: the label is `editorMeta`'s, and removability is a rule about this TEMPLATE.
   * A chip that offered a delete this editor would refuse is worse than none.
   */
  useEffect(() => {
    const regionsNow = docRef.current?.regions ?? {};
    const found = selectedId ? findNode(regionsNow, selectedId) : null;
    const node = found?.node ?? null;
    // The breadcrumb, outermost first: each parent, then the block itself.
    const crumbs: { id: string; label: string }[] = [];
    for (let at = found; at; at = at.parentId ? findNode(regionsNow, at.parentId) : null) {
      crumbs.unshift({ id: at.node.id, label: blockLabel(at.node.type) });
    }
    previewRef.current?.contentWindow?.postMessage(
      {
        source: "xt-editor", type: "highlight", id: selectedId,
        label: node ? blockLabel(node.type) : null,
        crumbs,
        canUp:   !!found && found.index > 0,
        canDown: !!found && found.index < found.list.length - 1,
        // ⚠ Asked of the registry directly, not of the `required` set below: this
        // effect is declared above it, and reading it here would be a use before
        // declaration. Same source, same answer.
        removable: node ? !(requiredBlocksFor(templateKey) ?? []).includes(node.type) : false,
      },
      window.location.origin,
    );
  }, [selectedId, templateKey, doc]);

  /**
   * The marked spot, drawn on the page as a pulsing line. Described by its
   * neighbours rather than an index, because the page knows blocks, not positions.
   */
  useEffect(() => {
    let mark: Record<string, string | null> | null = null;
    if (insertTarget && doc) {
      const list = insertTarget.parentId == null
        ? doc.regions[insertTarget.region] ?? []
        : findNode(doc.regions, insertTarget.parentId)?.node.children ?? [];
      mark = {
        afterId:  list[insertTarget.index - 1]?.id ?? null,
        beforeId: insertTarget.index === 0 ? list[0]?.id ?? null : null,
        parentId: insertTarget.parentId,
        region:   insertTarget.region,
      };
    }
    previewRef.current?.contentWindow?.postMessage(
      { source: "xt-editor", type: "insertMark", mark }, window.location.origin,
    );
  }, [insertTarget, doc]);

  /** A marked spot belongs to one document. */
  useEffect(() => { setInsertTarget(null); }, [templateKey, variant]);

  /**
   * Push the working document to the preview on every change, so an edit is
   * visible immediately instead of only after a save. The preview renders what
   * it is given; the save below is about persistence, not about seeing.
   */
  useEffect(() => {
    if (!doc) return;
    previewRef.current?.contentWindow?.postMessage(
      { source: "xt-editor", type: "document", templateKey, variant, document: doc },
      window.location.origin,
    );
  }, [doc, templateKey, variant]);

  /**
   * Autosave the draft, matching the ACP convention for config surfaces.
   *
   * Without it an admin could rearrange blocks, hit Publish, and have nothing
   * happen — Publish promotes the stored draft, and an unsaved edit is not one.
   * Publish stays explicit because going live is the deliberate act; keeping the
   * draft current is not.
   */
  useDebouncedSave({
    value: doc,
    savedValue: draftDoc,
    delay: 700,
    // Suspended while a conflict is unresolved: retrying on every keystroke would
    // hammer a write the server has already refused, and would bury the prompt that
    // is the only way out of it.
    //
    // ⚠ And refused outright while the held document belongs to another template —
    // the window that opens every time the picker moves, before the new draft has
    // resolved. `versionRef` is the other half of the reason: it holds the version
    // of the row being EDITED, so a write from that window would carry one
    // template's version against another template's row.
    onSave: (next) => {
      if (!next || conflict) return;
      if (next.templateKey !== templateKey) return;
      save.mutate(next);
    },
  });

  /**
   * Every template's draft document, for the chrome tab counts.
   *
   * One request for the whole set rather than one per chrome template, and shared
   * with nothing else — it is refetched when a layout is saved through the same
   * `acp-layout-status` invalidation, so a header that just gained a block says 3.
   */
  const allDraftsQuery = useQuery<{ templates: Record<string, LayoutDocument> }>({
    queryKey: ["acp-layout-all", themeKey],
    queryFn:  () => api.get(withTheme("/admin/layouts", themeKey)),
    staleTime: 30_000,
  });

  const templateInfo = templatesQuery.data?.find((x) => x.key === templateKey);
  const previewTemplateInfo = templatesQuery.data?.find((x) => x.key === previewPageKey);
  const regions = templateInfo?.regions ?? [];
  // From the local registry rather than the catalogue: a plugin's template is
  // registered in this browser by the plugin's own bundle, and the required-block
  // marker has to be right on the very first render, before the fetch lands.
  const required = useMemo(
    () => new Set<string>(requiredBlocksFor(templateKey) ?? []),
    [templateKey],
  );

  // Nesting means a block can be at any depth, so selection resolves through the
  // tree walk rather than a per-region scan.
  const selected = useMemo(
    () => (doc && selectedId ? findNode(doc.regions, selectedId) : null),
    [doc, selectedId],
  );

  /**
   * What publishing would change, block by block, against what is live (ADR-0012).
   *
   * Counted in the toolbar; marked on the page only while "Show changes" is on, since
   * an outline on every edited block is noise while you are still making them.
   */
  const publishedDoc = draftQuery.data?.published;
  const changes = useMemo(
    () => (doc && publishedDoc && publishedDoc.templateKey === doc.templateKey
      ? layoutChanges(doc.regions, publishedDoc.regions)
      : null),
    [doc, publishedDoc],
  );
  const changeCount = changes ? changes.changed.size + changes.removed.length : 0;
  const [showChanges, setShowChanges] = useState(false);
  useEffect(() => { if (changeCount === 0) setShowChanges(false); }, [changeCount]);
  useEffect(() => {
    changesMsgRef.current = { ids: changes ? [...changes.changed] : [], show: showChanges };
    previewRef.current?.contentWindow?.postMessage(
      { source: "xt-editor", type: "changes", ...changesMsgRef.current }, window.location.origin,
    );
  }, [changes, showChanges]);

  /**
   * Everywhere the selected block may go, for "Move to…": each area of this page
   * (main column, sidebar…) and every container that takes it, in page order, with
   * containers indented under the area they sit in. The same two rules a drag obeys —
   * what the parent ACCEPTS (registry) and whether the nesting is possible (tree) —
   * so the list never offers a move that would be refused. It also reaches what a
   * drag in the canvas cannot: a container's SIBLING, by picking the area itself.
   */
  const moveTargets = useMemo(() => {
    if (!doc || !selected) return [];
    const id = selected.node.id;
    const type = selected.node.type;
    const out: { region: string; parentId: string | null; type?: string; label: string; depth: number; current: boolean }[] = [];
    const visit = (nodes: BlockNode[], region: string, depth: number) => {
      for (const n of nodes) {
        if (n.id === id) continue; // never into itself (or anything inside it)
        if (getBlock(n.type)?.container && acceptsChild(n.type, type) && canNestInto(doc.regions, id, n.id)) {
          out.push({ region, parentId: n.id, type: n.type, label: blockLabel(n.type), depth, current: selected.parentId === n.id });
        }
        if (n.children?.length) visit(n.children, region, depth + 1);
      }
    };
    for (const region of regionsFor(templateKey)) {
      if (acceptsChild(null, type) && canNestInto(doc.regions, id, null)) {
        out.push({
          region, parentId: null, label: regionLabel(region, templateKey, t), depth: 0,
          current: selected.parentId == null && selected.region === region,
        });
      }
      visit(doc.regions[region] ?? [], region, 1);
    }
    return out;
  }, [doc, selected, templateKey, i18n.language]);

  /** Put a block at the END of an area or a container: "Move to…". */
  const moveInto = (id: string, region: string, parentId: string | null) => {
    const current = docRef.current;
    if (!current) return;
    const dest = parentId == null
      ? current.regions[region] ?? []
      : findNode(current.regions, parentId)?.node.children ?? [];
    applyTree((r) => moveBlock(r, id, { region, parentId, index: dest.length }));
  };

  // ── Mutations ─────────────────────────────────────────────────────────────

  const save = useMutation({
    /*
     * ⚠ Addressed by the DOCUMENT's own template key, never by the picker's.
     *
     * `templateKey` is state that changes the instant the picker moves; `doc` is
     * replaced a render or two later, when the new template's draft resolves. In
     * that window the editor holds the OUTGOING document under the INCOMING key —
     * and a 700ms autosave landing there PUTs one template's blocks into another
     * template's draft. Silent, and it destroys work: what it overwrites is a saved
     * layout nobody asked it to touch.
     *
     * The document knows which template it belongs to, so it addresses itself. The
     * `onSave` guard below refuses the mismatch outright; this is the second half,
     * so that a write which does happen goes to the right row.
     */
    mutationFn: (next: LayoutDocument) =>
      api.put<LayoutDraftResponse>(`/admin/layouts/${next.templateKey}${qs}`, {
        document: next,
        baseVersion: versionRef.current,
      }),
    // What was WRITTEN is the new baseline — not whatever the editor holds now, which
    // may already have moved on while the request was in flight.
    onSuccess: (res, written) => {
      savedJsonRef.current = JSON.stringify(written);
      setSavedOnce(true);
      // The row moved on because WE moved it; without adopting the new revision the
      // very next autosave would conflict with our own write.
      versionRef.current = res.version;
      setDirty(JSON.stringify(docRef.current) !== savedJsonRef.current);
      qc.invalidateQueries({ queryKey: ["acp-layout-status"] });
      qc.invalidateQueries({ queryKey: ["studio-status"] });
      qc.invalidateQueries({ queryKey: ["acp-layout-all"] });
      // No preview reload: the working document is already pushed live, and a
      // reload would throw it away and re-fetch the same thing.
    },
    onError: (e) => {
      // A 409 is not a failure to report and move past — somebody else's work is in
      // the row, and only the admin can decide what happens to it.
      if ((e as { status?: number }).status === 409) {
        setConflict({ version: conflictVersion(e) });
        return;
      }
      toast.error(apiErrorMessage(e));
    },
  });

  /**
   * Inheritance: back to what the installed theme ships (as distinct from Reset, which
   * goes back to the CODE default — with a theme installed those differ).
   */
  /**
   * Throw the draft away and go back to what is live.
   *
   * The escape hatch autosave removed. Reset is NOT this — it drops to the code
   * default, discarding the published layout too, so an admin who merely wanted to
   * abandon an afternoon's experiment would lose everything they had already shipped.
   */
  const discard = useMutation({
    mutationFn: () => api.post(`/admin/layouts/${templateKey}/discard${qs}`),
    onSuccess: () => {
      // The server replaced the document; the stack describes edits to one that no
      // longer exists, and undoing into it would silently re-stage what was discarded.
      history.clear();
      qc.invalidateQueries({ queryKey: ["acp-layout", templateKey, variant] });
      qc.invalidateQueries({ queryKey: ["acp-layout-status"] });
      qc.invalidateQueries({ queryKey: ["studio-status"] });
      qc.invalidateQueries({ queryKey: ["acp-layout-all"] });
      previewRef.current?.contentWindow?.location.reload();
      toast.success(t("layoutEditor.discardDone"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const revertTheme = useMutation({
    mutationFn: () => api.post<LayoutDocument>(withTheme(`/admin/layouts/${templateKey}/revert-theme`, themeKey)),
    onSuccess: () => {
      history.clear();
      qc.invalidateQueries({ queryKey: ["acp-layout", templateKey, variant] });
      qc.invalidateQueries({ queryKey: ["acp-layout-status"] });
      qc.invalidateQueries({ queryKey: ["studio-status"] });
      qc.invalidateQueries({ queryKey: ["acp-layout-all"] });
      qc.invalidateQueries({ queryKey: ["acp-layout-templates"] });
      toast.success(t("layoutEditor.revertedTheme"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const reset = useMutation({
    mutationFn: () => api.post(`/admin/layouts/${templateKey}/reset${qs}`),
    onSuccess: () => {
      history.clear();
      qc.invalidateQueries({ queryKey: ["acp-layout", templateKey, variant] });
      qc.invalidateQueries({ queryKey: ["acp-layout-status"] });
      qc.invalidateQueries({ queryKey: ["studio-status"] });
      qc.invalidateQueries({ queryKey: ["acp-layout-all"] });
      previewRef.current?.contentWindow?.location.reload();
      toast.success(t("layoutEditor.resetDone"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  // ── Document edits (local until saved) ────────────────────────────────────

  /**
   * Apply a tree operation to the working document.
   *
   * The operations are pure and return the ORIGINAL object when they refuse — a
   * cycle, a depth breach, a stale drag — so comparing by reference is how a
   * refusal is detected, and a refused edit leaves the draft clean rather than
   * triggering an autosave that writes nothing.
   */
  const applyTree = (fn: (regions: Regions) => Regions, coalesceKey?: string) => {
    const current = docRef.current;
    if (!current) return;
    const regions = fn(current.regions);
    // A refused edit is not a step: recording one would spend an undo doing nothing,
    // which reads as a broken undo rather than a refused drag.
    if (regions === current.regions) return;
    history.record({ doc: current, selectedId: selectedIdRef.current }, coalesceKey);
    commitDoc({ ...current, regions });
  };

  /**
   * Undo/redo swap the whole document, so they go through `commitDoc` rather than
   * `applyTree` — there is no tree operation to apply, and recording the step being
   * undone would make undo its own inverse and the stacks would never drain.
   *
   * The result is PERSISTED, not just shown: `commitDoc` marks it against the saved
   * baseline and autosave writes it. An undo that only changed the screen and left the
   * stored draft holding the mistake would be a trap. Undoing all the way back to the
   * stored document is the one case that writes nothing, correctly.
   */
  const applySnapshot = (snap: LayoutSnapshot | null) => {
    if (!snap) return;
    commitDoc(snap.doc);
    setSelectedId(snap.selectedId);
  };

  const undoEdit = () => {
    const current = docRef.current;
    if (!current) return;
    applySnapshot(history.undo({ doc: current, selectedId: selectedIdRef.current }));
  };

  const redoEdit = () => {
    const current = docRef.current;
    if (!current) return;
    applySnapshot(history.redo({ doc: current, selectedId: selectedIdRef.current }));
  };

  /**
   * What the once-registered listeners call. Reassigned every render, so they always
   * reach the current closures without having to re-bind the listeners themselves —
   * re-binding a `dragover` handler mid-gesture is how a drag gets dropped.
   */
  // `browse` rides along for the same reason the others do: the message listener is
  // registered once, so it must read the current callbacks rather than close over the
  // ones that existed when it was attached.
  const browse = (region: string, parentId: string | null) => setBrowseTarget({ region, parentId });
  /**
   * ⚠ Seeded with no-ops for the two that are defined further down, and REASSIGNED
   * below them (`latest.current = …`, after `removeNode`). The seed is evaluated once,
   * on the first render, and overwritten later in that same render — before any
   * listener can fire — so nothing ever calls a no-op. Naming the functions up here
   * instead would read them in their temporal dead zone.
   */
  const latest = useRef<{
    applyTree: (fn: (regions: Regions) => Regions, coalesceKey?: string) => void;
    undo: () => void;
    redo: () => void;
    browse: (region: string, parentId: string | null) => void;
    duplicate: (id: string) => void;
    remove: (id: string) => void;
    insertAt: (type: string, at: DropAt) => void;
    markAfter: (id: string) => void;
    markEnd: (region: string) => void;
    nudge: (id: string, delta: number) => void;
    removable: (id: string) => boolean;
    placeAt: (at: DropAt, beforeId?: string | null, afterId?: string | null) => DropAt;
    insertPreset: (preset: SectionPreset, at: DropAt) => void;
    inlineEdit: (id: string, prop: string, value: string) => void;
  }>({
    applyTree, undo: undoEdit, redo: redoEdit, browse, duplicate: () => {}, remove: () => {}, removable: () => false,
    insertAt: () => {}, markAfter: () => {}, markEnd: () => {}, nudge: () => {},
    placeAt: (at) => at, insertPreset: () => {}, inlineEdit: () => {},
  });

  /**
   * Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (Ctrl+Y too, for the Windows muscle memory).
   *
   * Skipped while a text field has focus: inputs carry their own undo stack, and
   * hijacking it would make a typo in a heading impossible to correct without
   * reverting the block's whole arrangement.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor(e);
      if (!action) return;
      e.preventDefault();
      if (action === "undo") latest.current.undo(); else latest.current.redo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // First visit: open the tour once the flags are known, a page is loaded and the
  // editor is really on screen (Theme Studio keeps it mounted, hidden, in other modes).
  useEffect(() => {
    if (tourAutoStarted.current || tourFlag.on !== false || !doc) return;
    const visible = !!document.querySelector(".lay__stage")?.getClientRects().length;
    if (!visible) return;
    tourAutoStarted.current = true;
    setTourOpen(true);
  }, [tourFlag.on, doc]);

  /** A new selection closes the "Move to…" list opened for the previous one. */
  useEffect(() => { setMoveOpen(false); }, [selectedId]);

  /**
   * The keyboard, outside text fields: Escape deselects (back to the block list),
   * Alt+↑/↓ moves the selected block, Ctrl/⌘+D duplicates it, Delete removes it.
   *
   * Not while a text field has focus: Escape in an input is how a browser reverts an
   * edit in progress, and Delete there deletes a character. Same rule as the undo
   * chord, for the same reason.
   */
  /** A menu closes on a click anywhere else, and on Escape — like every other menu. */
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
      if (e.key === "Escape") {
        setMenuOpen(false);
        setMoveOpen(false);
        setInsertTarget(null);
        if (!typing) setSelectedId(null);
        return;
      }
      const id = selectedIdRef.current;
      if (typing || !id) return;
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        latest.current.nudge(id, e.key === "ArrowUp" ? -1 : 1);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        latest.current.duplicate(id);
      } else if (e.key === "Delete" && latest.current.removable(id)) {
        e.preventDefault();
        latest.current.remove(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const addBlock = (type: string, region: string, parentId: string | null) => {
    const doc = docRef.current;
    if (!doc) return;
    const node = makeNode(type, collectIds(doc.regions));
    // Deliberately NOT stamped with the current audience. Nesting already does the
    // job — a block dropped inside a guests-only container is hidden from members by
    // its ancestor — and stamping would silently make every block added on `members`
    // or `profile` members-only, so a guest would not see what the admin just added.
    const siblings = parentId == null
      ? doc.regions[region] ?? []
      : findNode(doc.regions, parentId)?.node.children ?? [];
    applyTree((r) => insertBlock(r, node, { region, parentId, index: siblings.length }));
    setSelectedId(node.id);
  };

  /**
   * Add a block at an exact spot — a drop on the page, or the marked `+`.
   *
   * Returns whether it landed. `insertBlock` refuses (returns the same tree) for a
   * container that does not take the type or a depth breach, and a refused add must
   * not select a block that does not exist.
   */
  const addBlockAt = (type: string, at: DropAt): boolean => {
    const current = docRef.current;
    if (!current) return false;
    const node = makeNode(type, collectIds(current.regions));
    applyTree((r) => insertBlock(r, node, at));
    if (docRef.current === current) return false;
    setSelectedId(node.id);
    setInsertTarget(null);
    return true;
  };

  /**
   * Where a CLICKED library block goes, in order of how deliberately it was asked for:
   * the marked spot; inside the selected container when only a container takes it (a
   * Column into Columns); straight after the selected block; the end of the open region.
   * The first spot that accepts the type wins.
   */
  const placeBlock = (type: string) => {
    const current = docRef.current;
    if (!current) return;
    const typeAt = (parentId: string | null) =>
      parentId == null ? null : findNode(current.regions, parentId)?.node.type ?? null;
    const candidates: DropAt[] = [];
    if (insertTarget) candidates.push(insertTarget);
    const sel = selectedIdRef.current ? findNode(current.regions, selectedIdRef.current) : null;
    if (sel) {
      if (getBlock(sel.node.type)?.container && acceptsChild(sel.node.type, type)) {
        const inside = { region: sel.region, parentId: sel.node.id, index: sel.node.children?.length ?? 0 };
        if (!acceptsChild(typeAt(sel.parentId), type)) candidates.push(inside);
        candidates.push({ region: sel.region, parentId: sel.parentId, index: sel.index + 1 }, inside);
      } else {
        candidates.push({ region: sel.region, parentId: sel.parentId, index: sel.index + 1 });
      }
    }
    candidates.push({ region: openRegion, parentId: null, index: (current.regions[openRegion] ?? []).length });
    for (const at of candidates) {
      if (!acceptsChild(typeAt(at.parentId), type)) continue;
      if (addBlockAt(type, at)) return;
    }
    toast.warning(t("layoutEditor.library.notHere", { block: blockLabel(type) }));
  };

  /** The `+` under a block: mark the spot straight after it and open the library. */
  const markAfter = (id: string) => {
    const at = findNode(docRef.current?.regions ?? {}, id);
    if (!at) return;
    setInsertTarget({ region: at.region, parentId: at.parentId, index: at.index + 1 });
    setRailTab("blocks");
  };

  /** An empty region clicked on the page: mark its end and open the library. */
  const markEnd = (region: string) => {
    const list = docRef.current?.regions[region] ?? [];
    setActiveRegion(region);
    setInsertTarget({ region, parentId: null, index: list.length });
    setRailTab("blocks");
  };

  /** Tell the page which library block is being dragged, so it can aim the drop. */
  const announceDrag = (type: string | null, preset?: SectionPreset) => {
    previewRef.current?.contentWindow?.postMessage(
      type
        ? { source: "xt-editor", type: "dragNew", blockType: type, ...(preset ? { preset } : {}) }
        : { source: "xt-editor", type: "dragNewEnd" },
      window.location.origin,
    );
  };

  /**
   * Where a drop from the page lands, in THIS document's terms.
   *
   * The page names the neighbours it was dropped between, and those win over its
   * index: it does not draw every block in a list (another audience's, one that drew
   * nothing), so the count it saw is not an index into the document.
   */
  const placeAt = (at: DropAt, beforeId?: string | null, afterId?: string | null): DropAt => {
    const regionsNow = docRef.current?.regions ?? {};
    const list = at.parentId == null
      ? regionsNow[at.region] ?? []
      : findNode(regionsNow, at.parentId)?.node.children ?? [];
    const before = beforeId ? list.findIndex((n) => n.id === beforeId) : -1;
    if (before >= 0) return { ...at, index: before };
    const after = afterId ? list.findIndex((n) => n.id === afterId) : -1;
    if (after >= 0) return { ...at, index: after + 1 };
    return beforeId || afterId ? at : { ...at, index: list.length };
  };

  /** A ready-made section's starting words, in the admin's language. */
  const presetWords = (): PresetText => ({
    eyebrow:      t("layoutEditor.sections.words.eyebrow"),
    title:        t("layoutEditor.sections.words.title"),
    body:         t("layoutEditor.sections.words.body"),
    featureTitle: t("layoutEditor.sections.words.featureTitle"),
    featureBody:  t("layoutEditor.sections.words.featureBody"),
    ctaTitle:     t("layoutEditor.sections.words.ctaTitle"),
    ctaBody:      t("layoutEditor.sections.words.ctaBody"),
  });

  const insertPreset = (preset: SectionPreset, at: DropAt): boolean => {
    const current = docRef.current;
    if (!current) return false;
    const node = buildPreset(preset, presetWords(), collectIds(current.regions));
    applyTree((r) => insertBlock(r, node, at));
    if (docRef.current === current) return false;
    setSelectedId(node.id);
    setInsertTarget(null);
    return true;
  };

  /**
   * A CLICKED preset: straight after the section the selection is in, else at the end
   * of the open area. Always between sections — never inside a column.
   */
  const placePreset = (preset: SectionPreset) => {
    const current = docRef.current;
    if (!current) return;
    const sel = selectedIdRef.current ? findNode(current.regions, selectedIdRef.current) : null;
    const top = sel ? ancestorsOf(current.regions, sel.node.id)[0] ?? sel.node : null;
    const at = top ? findNode(current.regions, top.id) : null;
    const region = at?.region ?? (regions.includes("main") ? "main" : openRegion);
    const index = at ? at.index + 1 : (current.regions[region] ?? []).length;
    if (!insertPreset(preset, { region, parentId: null, index })) {
      toast.warning(t("layoutEditor.library.notHere", { block: t(`layoutEditor.sections.preset.${preset}`) }));
    }
  };

  /**
   * Text typed on the page. Only props the block's own schema has are written — the
   * page says which prop, and a page is not trusted to name one that does not exist.
   */
  const inlineEdit = (id: string, prop: string, value: string) => {
    const at = findNode(docRef.current?.regions ?? {}, id);
    if (!at || !(prop in (schemaFor(at.node.type)?.properties ?? {}))) return;
    updateProps(id, { ...at.node.props, [prop]: value });
    setSelectedId(id);
  };

  /**
   * Put a block that is live, but gone from the draft, back where it was.
   *
   * Same ids when nothing in the draft uses them, so a block put back is simply
   * unchanged again; fresh ones otherwise (one of its children was moved out first).
   */
  const putBack = (r: RemovedBlock) => {
    const current = docRef.current;
    if (!current) return;
    const taken = collectIds(current.regions);
    const clash = (n: BlockNode): boolean => taken.has(n.id) || (n.children ?? []).some(clash);
    const node = clash(r.node) ? cloneBlock(r.node, taken) : structuredClone(r.node);
    const parentThere = r.parentId == null || !!findNode(current.regions, r.parentId);
    const at: DropAt = parentThere
      ? { region: r.region, parentId: r.parentId, index: r.index }
      : { region: r.region, parentId: null, index: (current.regions[r.region] ?? []).length };
    applyTree((rg) => insertBlock(rg, node, at));
    setSelectedId(node.id);
  };

  /**
   * The ↑/↓ keyboard path, now within whatever list the block is in — a block
   * inside a column moves among that column's children, not the region's.
   *
   * Indices go to `moveBlock` as the admin sees them BEFORE the block is lifted
   * out, so moving down one slot is `index + 2`: the removal shifts everything
   * after it down by one and the insert compensates.
   */
  const nudge = (id: string, delta: number) => {
    const doc = docRef.current;
    if (!doc) return;
    const at = findNode(doc.regions, id);
    if (!at) return;
    const target = at.index + delta;
    if (target < 0 || target >= at.list.length) return;
    applyTree((r) => moveBlock(r, id, {
      region:   at.region,
      parentId: at.parentId,
      index:    delta > 0 ? at.index + 2 : at.index - 1,
    }));
  };

  /**
   * Copy a block — and everything inside it — in beside itself.
   *
   * Goes in directly AFTER the original in the same list, which is where a copy is
   * wanted and also the only position that needs no decision from the admin. It goes
   * through `insertBlock` like any other add, so the depth limit and the container's
   * `childTypes` still apply: a refused duplicate leaves the document untouched rather
   * than producing a tree that the next save would reject.
   */
  const duplicateNode = (id: string) => {
    const current = docRef.current;
    if (!current) return;
    const at = findNode(current.regions, id);
    if (!at) return;
    const copy = cloneBlock(at.node, collectIds(current.regions));
    applyTree((r) => insertBlock(r, copy, {
      region: at.region, parentId: at.parentId, index: at.index + 1,
    }));
    // Selected, because the next act after duplicating is editing the copy — and
    // because two identical rows are otherwise indistinguishable in the tree.
    setSelectedId(copy.id);
  };

  /**
   * Delete, and — for a CONTAINER — say what else goes with it.
   *
   * ⚠ Removing a container removes its whole subtree. A column holding five blocks is
   * one click and six blocks gone, from a 24px button on a hovered row, with nothing
   * on screen afterwards saying anything happened. That is how `home` lost its right
   * rail (twice), and it stayed lost because the loss looks exactly like a layout
   * that never had one.
   *
   * A leaf still deletes immediately: the confirm is for the case where the button
   * does more than it appears to, not a tax on every delete.
   */
  const removeNode = (id: string) => {
    const at = findNode(docRef.current?.regions ?? {}, id);
    const descendants = at ? countDescendants(at.node) : 0;
    if (descendants > 0) { void confirmRemoveTree(id, at!.node.type, descendants); return; }
    doRemoveNode(id);
  };

  async function confirmRemoveTree(id: string, type: string, count: number) {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("layoutEditor.removeTreeTitle", {
        block: blockLabel(type),
      }),
      body: t("layoutEditor.removeTreeBody", { count }),
      confirmText: t("layoutEditor.removeBlock"),
      cancelText:  t("layoutEditor.cancel"),
    });
    if (ok) doRemoveNode(id);
  }

  const doRemoveNode = (id: string) => {
    applyTree((r) => removeBlock(r, id));
    // Anything nested inside also just went away, so a selection pointing into it
    // would leave the settings panel describing a block that no longer exists. The
    // check reads `docRef`, which `commitDoc` has already advanced to the tree WITHOUT
    // the block — against the pre-removal tree every descendant still resolves, so the
    // only selection this could ever clear was the removed node itself.
    setSelectedId((s) => (s && findNode(docRef.current?.regions ?? {}, s) ? s : null));
  };

  // Every render, so the once-registered listeners always reach this render's closures.
  latest.current = {
    applyTree, undo: undoEdit, redo: redoEdit, browse,
    duplicate: duplicateNode, remove: removeNode,
    insertAt: (type, at) => { addBlockAt(type, at); },
    markAfter, markEnd, nudge, placeAt,
    insertPreset: (preset, at) => { insertPreset(preset, at); },
    inlineEdit,
    removable: (id) => {
      const at = findNode(docRef.current?.regions ?? {}, id);
      return !!at && !required.has(at.node.type);
    },
  };

  const updateProps = (id: string, props: Record<string, unknown>) => {
    // Coalesced per block: the props panel fires one of these per keystroke, and an
    // undo step per character would bury the structural edits an admin actually wants
    // to reach. A pause, or selecting a different block, starts a new step.
    applyTree((r) => updateBlockProps(r, id, props), `props:${id}`);
  };

  const updateVisibility = (id: string, visibility: BlockVisibility | undefined) => {
    applyTree((r) => updateBlockVisibility(r, id, visibility));
  };

  const updateVariant = (id: string, variant: BlockVariant | undefined) => {
    applyTree((r) => updateBlockVariant(r, id, variant));
  };

  const updateClassName = (id: string, className: string | undefined) => {
    applyTree((r) => updateBlockClassName(r, id, className));
  };

  const updateHeadingFont = (id: string, font: HeadingFont | undefined) => {
    applyTree((r) => updateBlockHeadingFont(r, id, font));
  };

  // ── Drag handling ─────────────────────────────────────────────────────────

  /**
   * Whether the dragged block may land in a container.
   *
   * Checked before the drop indicator is drawn, so an admin is never shown a
   * landing spot that the move would then silently refuse. Two separate rules:
   * the registry decides what a container ACCEPTS (a `columns` row takes only
   * tracks), and the tree decides whether the nesting is structurally possible
   * (no cycles, within the depth limit).
   */
  const canDropInto = (parentId: string | null): boolean => {
    const src = dragRef.current;
    if (!src || !doc) return false;
    // `acceptsChild` keys off the block TYPE, so the container has to be resolved
    // first — passing the id would look up nothing and reject every container.
    const parentType = parentId == null ? null : findNode(doc.regions, parentId)?.node.type ?? null;
    if (parentId != null && parentType == null) return false;
    if (!acceptsChild(parentType, src.type)) return false;
    return canNestInto(doc.regions, src.id, parentId);
  };

  const startDrag = (node: BlockNode) => {
    dragRef.current = { id: node.id, type: node.type };
    setDragId(node.id);
  };

  /**
   * Claim a drop position.
   *
   * An illegal target deliberately does NOT call `preventDefault`, which both
   * shows the "no drop" cursor and lets the event bubble to an enclosing
   * container or region that may accept it — the same outwards walk the preview
   * bridge performs.
   */
  const hover = (e: DragEvent<HTMLElement>, at: DropAt) => {
    if (!dragRef.current || !canDropInto(at.parentId)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDrop(at);
  };

  const dropHere = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const src = dragRef.current;
    const at = dropRef.current;
    if (src && at) {
      applyTree((r) => moveBlock(r, src.id, at));
      setSelectedId(src.id);
    }
    endDrag();
  };

  /**
   * Take THEIR version: drop what is on screen and re-read the row.
   *
   * The history goes too — every entry describes edits to a document that is no
   * longer the one being edited.
   */
  const takeTheirs = () => {
    setConflict(null);
    history.clear();
    qc.invalidateQueries({ queryKey: ["acp-layout", templateKey, variant] });
    previewRef.current?.contentWindow?.location.reload();
  };

  /**
   * Keep MINE: adopt the revision the refusal reported and write over it.
   *
   * Deliberate, named as such, and never automatic — this is the branch that destroys
   * somebody else's work, so it only ever runs because an admin picked it.
   */
  const takeMine = () => {
    versionRef.current = conflict?.version ?? null;
    setConflict(null);
    const current = docRef.current;
    if (current) save.mutate(current);
  };

  /**
   * The region the structure pane is showing — the first one until a tab is pressed.
   *
   * Resolved rather than stored, so a template switch cannot strand a selection: the
   * `aside` tab pressed on `home` does not survive into `chrome.header`, which has no
   * such region.
   */
  const openRegion = activeRegion && regions.includes(activeRegion) ? activeRegion : regions[0] ?? "";

  /** One region's blocks, arrangeable. */
  const regionPanel = (region: string) => {
    const nodes = doc?.regions[region] ?? [];
    return (
      <div
        className="lay__region"
        key={region}
        // Region-level target so a drop on the region's own chrome — its padding, the
        // "Empty" placeholder — appends rather than doing nothing. Rows and containers
        // stop propagation, so this only fires when nothing more specific claimed it.
        // ⚠ MOVES only. Adding is a click now, from the catalogue — a drag out of a
        // modal onto the tree behind its own overlay is not a gesture that exists.
        onDragOver={(e) => hover(e, { region, parentId: null, index: nodes.length })}
        onDrop={dropHere}
      >

        {/* Said once, where the surprise is: `aside` is the only region whose
            position is not simply "next". */}
        {region === "aside" && (
          <p className="lay__region-hint">{t("layoutEditor.asideHint")}</p>
        )}

        <BlockList nodes={nodes} region={region} parentId={null} depth={1} ctx={treeCtx} />
      </div>
    );
  };

  /**
   * The tab row: this template's regions, then the site's chrome.
   *
   * ⚠ The chrome tabs SWITCH DOCUMENT — they are `chrome.header` and `chrome.footer`,
   * not regions of this page. A page has neither any more (every default shipped them
   * empty, and "Header" in a page's structure read as the site header having gone
   * missing), but the header and footer are still on screen above and below the page
   * being arranged, and reaching them by clicking the preview is a route only someone
   * who already knows finds. The tab says where they are; the count says what is in
   * them; opening one is the same act as clicking a header block in the preview.
   */
  const chromeTabs = isChromeTemplate(templateKey)
    ? []
    : (["chrome.header", "chrome.footer"] as TemplateKey[]);

  /**
   * How many blocks the chrome documents hold, for the tabs that open them.
   *
   * From `GET /admin/layouts` — every template as the DRAFT would render it, which is
   * the same document the tab opens. Counting the OPEN document's regions instead
   * would be free and wrong: the header is not a region of this page.
   */
  const chromeCounts: Partial<Record<string, number>> = useMemo(() => {
    // ⚠ `{ templates, variants }`, not a bare map — the endpoint answers with both,
    // and reading it as a map made every chrome tab say 0.
    const templates = allDraftsQuery.data?.templates;
    if (!templates) return {};
    const out: Record<string, number> = {};
    for (const key of ["chrome.header", "chrome.footer"]) {
      const regionsOf = templates[key]?.regions ?? {};
      out[key] = Object.values(regionsOf).reduce((n, list) => n + (list?.length ?? 0), 0);
    }
    return out;
  }, [allDraftsQuery.data]);

  const regionTabs = () => (
    <div className="lay__tabs" role="tablist">
      {regions.map((region) => {
        const count = (doc?.regions[region] ?? []).length;
        return (
          <button
            key={region}
            type="button"
            role="tab"
            aria-selected={region === openRegion}
            className={`lay__tab${region === openRegion ? " is-on" : ""}`}
            onClick={() => setActiveRegion(region)}
          >
            {regionLabel(region, templateKey, t)}
            <span className="lay__tab-count">{count}</span>
          </button>
        );
      })}
      {chromeTabs.map((key) => (
        <button
          key={key}
          type="button"
          className="lay__tab lay__tab--chrome"
          title={t("layoutEditor.chromeTabHint")}
          onClick={() => setTemplateKey(key)}
        >
          {t(`layoutEditor.template.${key}`)}
          <span className="lay__tab-count">
            {chromeCounts[key] ?? 0}
          </span>
        </button>
      ))}
    </div>
  );


  const treeCtx: TreeCtx = {
    t, templateKey, selectedId, dragId, dropAt, required, audience,
    select: setSelectedId,
    startDrag, endDrag, hover, drop: dropHere,
    nudge, remove: removeNode, duplicate: duplicateNode, browse, add: addBlock,
  };

  async function confirmReset() {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("layoutEditor.resetTitle"),
      body:  t("layoutEditor.resetBody"),
      confirmText: t("layoutEditor.reset"),
      cancelText:  t("layoutEditor.cancel"),
    });
    if (ok) reset.mutate();
  }

  async function confirmDiscard() {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("layoutEditor.discardTitle"),
      body:  t("layoutEditor.discardBody"),
      confirmText: t("layoutEditor.discard"),
      cancelText:  t("layoutEditor.cancel"),
    });
    if (ok) discard.mutate();
  }

  async function confirmRevertTheme() {
    const ok = await openDialog({
      kind: "confirm", icon: "warning",
      title: t("layoutEditor.revertThemeTitle"),
      body:  t("layoutEditor.revertThemeBody", { theme: installedTheme?.manifest?.name ?? "" }),
      confirmText: t("layoutEditor.revertTheme"),
      cancelText:  t("layoutEditor.cancel"),
    });
    if (ok) revertTheme.mutate();
  }

  const pending = statusQuery.data?.pending ?? [];
  /** Whether THIS template/variant has unpublished changes — what Discard acts on. */
  const hasDraft = pending.some((p) => p.templateKey === templateKey && p.variant === variant);

  /**
   * The picker's three groups.
   *
   * Falls back to core's own keys while the catalogue is in flight, so the select is
   * never momentarily empty — the editor opens on `article.index` and would otherwise
   * show a blank control until the fetch lands.
   */
  const catalogue: TemplateInfo[] = templatesQuery.data
    ?? CORE_TEMPLATE_KEYS.map((key) => ({ key, regions: [...regionsFor(key)] }));
  const corePageTemplates   = catalogue.filter((x) => !x.pluginId && !isChromeTemplate(x.key));
  const coreChromeTemplates = catalogue.filter((x) => !x.pluginId && isChromeTemplate(x.key));
  const pluginTemplates     = catalogue.filter((x) => !!x.pluginId);

  /**
   * `page.detail` renders on `/p/:slug`, so previewing it needs a real page —
   * `/` would show the home page and none of the blocks being arranged. The first
   * published page is used; with no pages at all the fallback route applies and the
   * preview honestly shows nothing to arrange.
   */
  // The PAGE being previewed — which stays put when the open document is the site
  // header or footer, because those render on this page too and that is where the
  // admin just clicked one.
  const previewRoute =
    previewPageKey === "profile"        && previewUsername    ? `/u/${encodeURIComponent(previewUsername)}`
    : previewPageKey === "article.detail" && previewArticleSlug ? `/articles/${encodeURIComponent(previewArticleSlug)}`
    // A plugin says where its own page lives; core cannot know. `/` is the honest
    // fallback for a plugin that declared no route — it previews the chrome and shows
    // the admin that this template has no page to point at.
    : previewTemplateInfo?.previewRoute
      ?? PREVIEW_ROUTE[previewPageKey as CoreTemplateKey]
      ?? "/";
  /**
   * `__editing` names the template under the cursor, so the preview can draw THAT
   * one from the draft and everything around it — the site header and footer — from
   * what is published. Without it the preview showed every template's staged state
   * at once, and a stale `chrome.header` draft read as the site header disappearing.
   */
  /**
   * A day worth previewing the open document on, for "Viewing on": the first one an
   * edge's plugin names (`viewDate`) — art that shows only part of the year. Core's own
   * edge art always shows, so it never names one.
   */
  const seasonStart: string | null = (() => {
    const dated = edgeExtensions().filter((x) => x.viewDate);
    if (dated.length === 0) return null;
    const dayOf = (e: EdgeArt | undefined): string | null => {
      if (!e) return null;
      for (const x of dated) {
        const md = x.viewDate!(e.ext?.[x.namespace]);
        if (md) return md;
      }
      return null;
    };
    const walk = (nodes: BlockNode[]): string | null => {
      for (const n of nodes) {
        const s = dayOf(n.edges?.top) ?? dayOf(n.edges?.bottom);
        if (s) return s;
        const hit = n.children ? walk(n.children) : null;
        if (hit) return hit;
      }
      return null;
    };
    return doc ? walk(Object.values(doc.regions).flat()) : null;
  })();

  /**
   * Whether the open document has edge art that changes with the time of day — only a
   * plugin's can, and the plugin says so (`usesTime`). Offers "Viewing at" when it does.
   */
  const usesTime: boolean = (() => {
    const timed = edgeExtensions().filter((x) => x.usesTime);
    if (!doc || timed.length === 0) return false;
    const walk = (nodes: BlockNode[]): boolean => nodes.some((n) =>
      [n.edges?.top, n.edges?.bottom].some((e) => e && timed.some((x) => x.usesTime!(e.ext?.[x.namespace])))
      || (n.children ? walk(n.children) : false));
    return walk(Object.values(doc.regions).flat());
  })();

  // While the preview is "in season", follow the season: a preset or a date edit moves
  // the opening day, and the button is labelled with the NEW one — previewing the old
  // date under that label showed an edge that never appeared.
  useEffect(() => {
    if (viewDate && viewDate !== seasonStart) setViewDate(seasonStart);
  }, [seasonStart, viewDate]);

  const previewSrc =
    `${previewRoute}?${LAYOUT_PREVIEW_PARAM}=draft&${LAYOUT_EDITING_PARAM}=${encodeURIComponent(templateKey)}`
    // The theme being edited, so the preview renders ITS draft and stylesheet.
    + (themeKey ? `&${PREVIEW_THEME_PARAM}=${encodeURIComponent(themeKey)}` : "");

  return (
    <div className="lay">
      {/* Toolbar */}
      <div className="lay__bar">
        {/* THE DOCUMENT, named with the route it draws.
            ⚠ Still a native `<select>`, laid transparently over the chip that shows
            the current one. The chip can say two lines and carry the template's icon,
            which a select's own rendering cannot — but a custom listbox would have to
            re-earn type-ahead, arrow keys, the mobile picker and the screen-reader
            behaviour that come free here, and this control is how every other document
            is reached. The visible layer is a label; the select is the control. */}
        <div className="lay__doc">
          <span className="lay__doc-icon" aria-hidden="true">
            <FontAwesomeIcon icon={isChromeTemplate(templateKey) ? faWindowMaximize : faFileLines} />
          </span>
          <span className="lay__doc-text">
            <b>
              {templatesQuery.data?.find((x) => x.key === templateKey)?.label
                ?? t(`layoutEditor.template.${templateKey}`, { defaultValue: templateKey })}
              {pending.some((p) => p.templateKey === templateKey) && (
                <span className="lay__doc-dot" title={t("layoutEditor.aheadOfLive")} />
              )}
            </b>
            <code>{previewRoute}</code>
          </span>
          <FontAwesomeIcon icon={faChevronDown} className="lay__doc-caret" aria-hidden="true" />
        <select
          className="lay__template"
          aria-label={t("layoutEditor.documentLabel")}
          value={templateKey}
          onChange={(e) => setTemplateKey(e.target.value as TemplateKey)}
        >
          {/* Three groups, because the list mixes three kinds of thing: chrome renders
              on EVERY page, core pages are one route each, and a plugin's pages exist
              only while that plugin is enabled. Flat, they read alike.

              Driven by the SERVER's catalogue, not a constant: a plugin's templates are
              exactly the ones that come and go, so a hardcoded list could only ever
              offer core's. */}
          <optgroup label={t("layoutEditor.group.pages")}>
            {corePageTemplates.map(({ key }) => (
              <option key={key} value={key}>
                {t(`layoutEditor.template.${key}`)}{pending.some((p) => p.templateKey === key) ? " ●" : ""}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("layoutEditor.group.site")}>
            {coreChromeTemplates.map(({ key }) => (
              <option key={key} value={key}>
                {t(`layoutEditor.template.${key}`)}{pending.some((p) => p.templateKey === key) ? " ●" : ""}
              </option>
            ))}
          </optgroup>
          {pluginTemplates.length > 0 && (
            <optgroup label={t("layoutEditor.group.plugins")}>
              {pluginTemplates.map(({ key, label }) => (
                <option key={key} value={key}>
                  {/* The plugin's own label, untranslated — core has no bundle for a
                      third party's strings. The key is the fallback so a plugin that
                      forgot one still produces a selectable row. */}
                  {label || key}{pending.some((p) => p.templateKey === key) ? " ●" : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        </div>


        {/* The audience axis moved onto the CANVAS toolbar: it says who the page is
            drawn for, which is a property of what you are looking at rather than of
            the document you are editing. It still filters the tree — both ask
            `audienceInView`, so the two panes can never disagree. */}

        {/* Undo/redo. Icon-only with the shortcut in the tooltip — the keyboard is
            how these are actually used, but a control an admin can see is how they
            find out the keyboard works at all. */}
        <div className="lay__history">
          <Button variant="ghost" disabled={!history.canUndo}
            onClick={undoEdit} title={`${t("layoutEditor.undo")} (Ctrl+Z)`}
            aria-label={t("layoutEditor.undo")}>
            <FontAwesomeIcon icon={faRotateLeft} />
          </Button>
          <Button variant="ghost" disabled={!history.canRedo}
            onClick={redoEdit} title={`${t("layoutEditor.redo")} (Ctrl+Shift+Z)`}
            aria-label={t("layoutEditor.redo")}>
            <FontAwesomeIcon icon={faRotateRight} />
          </Button>
        </div>

        {/* TWO pills, because they answer two different questions and an admin who
            confuses them publishes by accident. The first is about the DRAFT — has
            what I just typed been stored. The second is about the LIVE SITE — does
            what visitors see differ from what I am editing. A draft can be perfectly
            saved and still not be live, which is the normal state of this editor and
            the one the old single line could not express.
            ⚠ The saved pill appears only once a save has actually happened in this
            session. Showing "Autosaved" on a page that has just loaded and stored
            nothing would be a claim about an event that never occurred. */}
        <span className="lay__pills">
          {save.isPending ? (
            <span className="lay__pill">
              <FontAwesomeIcon icon={faSpinner} spin /> {t("layoutEditor.saving")}
            </span>
          ) : dirty ? (
            <span className="lay__pill">{t("layoutEditor.unsaved")}</span>
          ) : savedOnce ? (
            <span className="lay__pill lay__pill--ok">
              <FontAwesomeIcon icon={faCheck} /> {t("layoutEditor.autosaved")}
            </span>
          ) : null}

        </span>

        {/* What publishing would change, and the switch that marks it on the page. */}
        {changes && (
          <button type="button" className={`lay__changes${showChanges ? " is-on" : ""}`}
            aria-pressed={showChanges} disabled={changeCount === 0}
            onClick={() => setShowChanges((v) => !v)}>
            <FontAwesomeIcon icon={faCodeCompare} />
            {changeCount === 0
              ? t("layoutEditor.sections.noChanges")
              : showChanges
                ? t("layoutEditor.sections.hideChanges")
                : t("layoutEditor.sections.changes", { count: changeCount })}
          </button>
        )}

        <div className="lay__bar-actions">
          <Button variant="ghost" className="lay__help" onClick={() => setTourOpen(true)}
            title={t("layoutEditor.tour.replay")} aria-label={t("layoutEditor.tour.replay")}>
            <FontAwesomeIcon icon={faCircleQuestion} />
          </Button>
          <div className="lay__seg lay__mode" role="group" aria-label={t("layoutEditor.mode.label")}>
            <button type="button" className={!advanced ? "is-on" : ""} aria-pressed={!advanced}
              title={t("layoutEditor.mode.simpleHint")} onClick={() => advancedFlag.set(false)}>
              {t("layoutEditor.mode.simple")}
            </button>
            <button type="button" className={advanced ? "is-on" : ""} aria-pressed={advanced}
              title={t("layoutEditor.mode.advancedHint")} onClick={() => advancedFlag.set(true)}>
              {t("layoutEditor.mode.advanced")}
            </button>
          </div>
          {/* How the whole site sits in the window. Site-wide, like Publish, which is
              why it sits beside it rather than with the page's own controls. */}
          <SiteFramePopover pageKey={previewPageKey} onLiveChange={setLiveFrame} themeKey={themeKey} />

          {/* THROWING WORK AWAY, behind a menu. All three undo something — a theme's
              version, the draft, the whole arrangement — and they sat in the toolbar
              at the same weight as Publish, which is the one button here that is used
              on purpose and often. None of them is reached by accident now, and each
              still confirms. */}
          <div className="lay__menu" ref={menuRef}>
            <Button variant="ghost"
              aria-haspopup="menu" aria-expanded={menuOpen}
              title={t("layoutEditor.draftActions")} aria-label={t("layoutEditor.draftActions")}
              onClick={() => setMenuOpen((o) => !o)}>
              <FontAwesomeIcon icon={faEllipsis} />
            </Button>
            {menuOpen && (
              <div className="lay__menu-list" role="menu">
                {/* Only when the installed theme actually ships this template — an
                    item that 404s is worse than no item. */}
                {templateInfo?.hasTheme && !variant && (
                  <button type="button" role="menuitem"
                    disabled={revertTheme.isPending}
                    onClick={() => { setMenuOpen(false); void confirmRevertTheme(); }}>
                    <FontAwesomeIcon icon={faRotateLeft} /> {t("layoutEditor.revertTheme")}
                  </button>
                )}
                {/* Disabled rather than hidden, matching Publish: both act on the
                    draft, and a control that vanishes when there is nothing to do
                    teaches an admin less than one that greys out. */}
                <button type="button" role="menuitem"
                  disabled={discard.isPending || !hasDraft}
                  onClick={() => { setMenuOpen(false); void confirmDiscard(); }}>
                  <FontAwesomeIcon icon={faXmark} /> {t("layoutEditor.discard")}
                </button>
                <button type="button" role="menuitem" className="lay__menu-danger"
                  onClick={() => { setMenuOpen(false); void confirmReset(); }}>
                  <FontAwesomeIcon icon={faRotateLeft} /> {t("layoutEditor.reset")}
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* A refused save. Deliberately a BANNER and not a toast: autosave is suspended
          until this is answered, so it has to stay on screen until it is — a toast
          that faded would leave the editor silently not saving. */}
      {conflict && (
        <div className="lay__conflict" role="alert">
          <div>
            <strong>{t("layoutEditor.conflictTitle")}</strong>
            <p>{t("layoutEditor.conflictBody")}</p>
          </div>
          <div className="lay__conflict-actions">
            <Button variant="ghost" onClick={takeTheirs}>
              {t("layoutEditor.conflictReload")}
            </Button>
            <Button onClick={takeMine}>
              {t("layoutEditor.conflictOverwrite")}
            </Button>
          </div>
        </div>
      )}


      {showChanges && changes && changes.removed.length > 0 && (
        <div className="lay__removed" role="status">
          <span>{t("layoutEditor.sections.removed")}</span>
          {changes.removed.map((r) => (
            <button key={r.node.id} type="button" className="lay__removed-item" onClick={() => putBack(r)}
              title={t("layoutEditor.sections.putBack")}>
              <FontAwesomeIcon icon={iconFor(r.node.type)} /> {blockLabel(r.node.type)}
              <em>{t("layoutEditor.sections.putBack")}</em>
            </button>
          ))}
        </div>
      )}

      <div className="lay__grid">
        {/* THREE panes: what the page is made of, the page, and the selected block.
            The structure and the library share the left rail because both answer
            "what goes on this page"; the inspector is opposite because it answers
            "what about this one" — and putting it under the tree meant every
            selection scrolled the thing you were selecting out of view. */}
        <div className="lay__rail">
          {/* ── The selected block's settings, IN the rail ─────────────────
              They used to float over the canvas and cover the page they describe.
              The rail answers "what goes on this page" when nothing is selected and
              "what about this one" when something is: one place, one at a time, and
              the canvas keeps its full width. Back (or Esc) returns to the blocks. */}
        <div className="lay__tree">
          {/* Blocks to add, or the whole tree. The canvas is where blocks are selected
              and arranged now; the tree stays one tab away for everything the canvas
              cannot show, and as the keyboard path. */}
          {/* Simple mode has only the blocks, so a lone tab would be a label pretending to be a control. */}
          <div className="lay__railtabs" role="tablist" aria-label={t("layoutEditor.library.tabs")}>
            <button type="button" role="tab" aria-selected={railTab === "blocks"}
              className={railTab === "blocks" ? "is-on" : ""} onClick={() => setRailTab("blocks")}>
              {t("layoutEditor.sections.add")}
            </button>
            <button type="button" role="tab" aria-selected={railTab === "layers"}
              className={railTab === "layers" ? "is-on" : ""} onClick={() => setRailTab("layers")}>
              {t("layoutEditor.sections.outline")}
            </button>
          </div>

          {railTab === "blocks" ? (
            <>
            {/* The header and footer start from a ready-made style; blocks fine-tune it. */}
            {doc && (templateKey === "chrome.header" || templateKey === "chrome.footer") && (
              <ChromeStyles kind={templateKey === "chrome.header" ? "header" : "footer"}
                regions={doc.regions}
                onApply={(next) => applyTree((r) => ({ ...r, ...next }))} />
            )}
            {doc && !isChromeTemplate(templateKey) && (
              <SectionPresets
                onPick={placePreset}
                onDragStart={(p) => announceDrag("section", p)}
                onDragEnd={() => announceDrag(null)}
              />
            )}
            <BlockLibrary
              templateKey={templateKey}
              inserting={!!insertTarget}
              onPick={placeBlock}
              onDragStartType={(type) => announceDrag(type)}
              onDragEndType={() => announceDrag(null)}
              onCancelInsert={() => setInsertTarget(null)}
              onBrowseAll={() => setBrowseTarget(insertTarget
                ? { region: insertTarget.region, parentId: insertTarget.parentId }
                : { region: openRegion, parentId: null })}
            />
            </>
          ) : (
            <>
              <div className="lay__pane-title">
                {t("layoutEditor.structure")}
                <span className="lay__pane-count">
                  {t("layoutEditor.blockCount", { count: (doc?.regions[openRegion] ?? []).length })}
                </span>
              </div>
              {regionTabs()}
              <div className="lay__region-head">
                <span>{regionLabel(openRegion, templateKey, t)}</span>
                <Button variant="ghost"
                  onClick={() => setBrowseTarget({ region: openRegion, parentId: null })}
                  title={t("layoutEditor.addBlock")}>
                  <FontAwesomeIcon icon={faPlus} />
                </Button>
              </div>
              {regionPanel(openRegion)}
            </>
          )}
        </div>
        </div>

        {/* ── Preview ───────────────────────────────────────────────────── */}
        <div className="lay__preview">
          {/* The canvas toolbar: who the page is drawn for, and how wide.
              Both are about the page rather than about the document, which is why
              they live over the canvas and not in the document toolbar above. */}
          <div className="lay__canvasbar">
            {/* The axis is named ONCE, beside the pair. Each button carried it
                ("Audience: guests") back when this was a select and every option had
                to say what it was an option for. */}
            <span className="lay__canvasbar-label">{t("layoutEditor.audienceViewLabel")}</span>
            <div className="lay__seg" role="group" aria-label={t("layoutEditor.audienceViewHint")}>
              <button type="button" className={audience === "guests" ? "is-on" : ""}
                onClick={() => setAudience("guests")}>
                <FontAwesomeIcon icon={faEye} /> {t("layoutEditor.audienceView.guests")}
              </button>
              <button type="button" className={audience === "members" ? "is-on" : ""}
                onClick={() => setAudience("members")}>
                <FontAwesomeIcon icon={faUsers} /> {t("layoutEditor.audienceView.members")}
              </button>
            </div>

            {/* Plugin art that shows only part of the year is hidden most of it, which is
                exactly when an admin arranges things — so the canvas can pretend it is
                that day. Offered when an edge's plugin names one (`viewDate`). */}
            {advanced && seasonStart && (
              <>
                <span className="lay__canvasbar-label">{t("layoutEditor.edge.viewingOn")}</span>
                <div className="lay__seg" role="group" aria-label={t("layoutEditor.edge.viewingOn")}>
                  <button type="button" className={!viewDate ? "is-on" : ""} onClick={() => setViewDate(null)}>
                    {t("layoutEditor.edge.today")}
                  </button>
                  <button type="button" className={viewDate ? "is-on" : ""} onClick={() => setViewDate(seasonStart)}>
                    {dateFromMonthDay(seasonStart).toLocaleDateString(i18n.language, { month: "short", day: "numeric" })}
                  </button>
                </div>
              </>
            )}

            {/* Time-of-day art (a sun by day, stars by night) follows each visitor's clock,
                so the canvas can pretend it is another hour. */}
            {advanced && (usesTime || viewHour !== null) && (
              <>
                <span className="lay__canvasbar-label">{t("layoutEditor.edge.viewingAt")}</span>
                <select className="acp-input lay__canvasbar-select" aria-label={t("layoutEditor.edge.viewingAt")}
                  value={viewHour ?? ""} onChange={(e) => setViewHour(e.target.value === "" ? null : Number(e.target.value))}>
                  <option value="">{t("layoutEditor.edge.now")}</option>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
                  ))}
                </select>
              </>
            )}

            <div className="lay__seg lay__seg--icons" role="group" aria-label={t("layoutEditor.deviceHint")}>
              {(Object.keys(DEVICES) as DeviceId[]).map((id) => (
                <button key={id} type="button"
                  className={device === id ? "is-on" : ""}
                  title={DEVICES[id].width === "fill"
                    ? t("layoutEditor.deviceFill")
                    : `${t(`layoutEditor.device.${id}`)} · ${DEVICES[id].width}px`}
                  aria-label={t(`layoutEditor.device.${id}`)}
                  onClick={() => setDevice(id)}>
                  <FontAwesomeIcon icon={DEVICES[id].icon} />
                </button>
              ))}
            </div>

            {/* ⚠ A MODE, not a one-shot. Icons are clicked in runs — changing four
                of them should not mean four trips back to this button. While it is
                on, a click in the preview picks an icon instead of selecting a
                block, and the preview outlines every icon so that is visible. */}
            {advanced && <button type="button"
              className={`lay__zoom${iconMode ? " is-on" : ""}`}
              aria-pressed={iconMode}
              title={t("layoutEditor.iconModeHint")}
              onClick={() => {
                const on = !iconMode;
                setIconMode(on);
                if (!on) setIconPick(null);
                previewRef.current?.contentWindow?.postMessage(
                  { source: "xt-editor", type: "iconMode", on }, window.location.origin,
                );
              }}>
              <FontAwesomeIcon icon={faIcons} /> {t("layoutEditor.iconMode")}
            </button>}

            <span className="lay__canvasbar-width">
              {t(`layoutEditor.device.${device}`)} · {deviceWidth}
            </span>

            {/* Only offered when it would do something: at desktop width in a wide
                pane the frame already fits, and a Fit button that changes nothing is
                a control an admin has to test to understand.
                ⚠ Hiding it does not clear `zoom` — a pane that grows past the frame
                resolves `scale` to 1 on its own, so a fit left switched on is already
                indistinguishable from full size, and keeping the state means shrinking
                the window back does not silently lose the choice. */}
            {oversized && (
              <button type="button"
                className={`lay__zoom${zoom === "fit" ? " is-on" : ""}`}
                onClick={() => setZoom((z) => (z === "fit" ? "full" : "fit"))}
                title={t("layoutEditor.zoomHint")}>
                {zoom === "fit" ? `${Math.round(scale * 100)}%` : "100%"}
              </button>
            )}

            {advanced && <span className="lay__preview-url">{previewSrc}</span>}
            {/* The preview, in a tab of its own. The draft has been renderable at a
                real URL all along — `?__layout=draft` is what the frame itself loads —
                and nothing linked to it, so checking a layout at the browser's own
                width meant typing the parameter by hand. `noreferrer` with `_blank`
                as everywhere else. */}
            {advanced && <a className="lay__preview-open" href={previewSrc}
               target="_blank" rel="noreferrer"
               title={t("layoutEditor.openPreview")} aria-label={t("layoutEditor.openPreview")}>
              <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
            </a>}
          </div>
          {/* The real route, so blocks receive real context. An iframe keeps ACP
              chrome CSS from bleeding into the site preview. Hover, click-select
              and drag inside it are wired by previewBridge over postMessage. */}
          {/* Re-push on load: the iframe starts by fetching the SAVED draft, so
              without this a reload would silently drop unsaved edits from view. */}
          <div ref={stageRef} className="lay__stage">
            <div className="lay__frame" style={frameBox}>
              <iframe
                ref={previewRef}
                src={previewSrc}
                title={t("layoutEditor.preview")}
                style={frameStyle}
                // A reload throws away the iframe's module state, so the working
                // document, the chosen audience and the pending tokens all have to be
                // re-sent — otherwise a reload silently drops unsaved edits from view,
                // reverts the preview to showing every audience, and loses the staged
                // colours, which live in the editor and not in the served CSS.
                onLoad={() => pushTo(previewRef.current?.contentWindow, audience)}
              />
            </div>
          </div>

        </div>

        {/* ── Settings: the selection's, or the theme's when nothing is selected ──
            The third pane (ADR-0012). The rail on the left is always how things are
            ADDED and found; this one is always what the selected thing is. */}
        <div className="lay__inspector">
          {selected && doc ? (
          <div className="lay__props">
            <div className="lay__props-bar">
              <span className="lay__props-bar-title">{t("layoutEditor.sections.settingsTitle")}</span>
              <Button variant="ghost"
                onClick={() => setSelectedId(null)}
                title={t("layoutEditor.closeSettings")}
                aria-label={t("layoutEditor.closeSettings")}>
                <FontAwesomeIcon icon={faXmark} />
              </Button>
            </div>

            <div className="lay__props-ident">
              <span className="lay__props-icon" aria-hidden="true">
                <FontAwesomeIcon icon={iconFor(selected.node.type)} />
              </span>
              <span className="lay__props-text">
                <b>{blockLabel(selected.node.type)}</b>
                {/* Where it sits: the area, then each container. A parent is otherwise
                    hard to click, since every point inside it belongs to a child. */}
                <span className="lay__props-path">
                  <span>{regionLabel(selected.region, templateKey, t)}</span>
                  {ancestorsOf(doc.regions, selected.node.id).map((p) => (
                    <span key={p.id} className="lay__props-path-step">
                      <span aria-hidden="true">›</span>
                      <button type="button" onClick={() => setSelectedId(p.id)}>{blockLabel(p.type)}</button>
                    </span>
                  ))}
                </span>
              </span>
            </div>

            {/* One row of everything that ARRANGES the block. The canvas has the same
                actions on the block itself; these are here so the panel is enough. */}
            <div className="lay__props-acts">
              <Button variant="ghost"
                disabled={selected.index === 0}
                onClick={() => nudge(selected.node.id, -1)}
                title={`${t("layoutEditor.moveUp")} (Alt+↑)`} aria-label={t("layoutEditor.moveUp")}>
                <FontAwesomeIcon icon={faArrowUp} />
              </Button>
              <Button variant="ghost"
                disabled={selected.index >= selected.list.length - 1}
                onClick={() => nudge(selected.node.id, 1)}
                title={`${t("layoutEditor.moveDown")} (Alt+↓)`} aria-label={t("layoutEditor.moveDown")}>
                <FontAwesomeIcon icon={faArrowDown} />
              </Button>
              <div className="lay__moveto">
                <button type="button" className={`btn-ghost btn-sm${moveOpen ? " is-on" : ""}`}
                  aria-expanded={moveOpen} onClick={() => setMoveOpen((o) => !o)}>
                  <FontAwesomeIcon icon={faUpDownLeftRight} /> {t("layoutEditor.moveTo")}
                </button>
                {moveOpen && (
                  <div className="lay__moveto-list" role="menu">
                    <div className="lay__moveto-head">{t("layoutEditor.moveToTitle")}</div>
                    {moveTargets.length === 0 && <div className="lay__moveto-none">{t("layoutEditor.moveToNone")}</div>}
                    {moveTargets.map((tg) => (
                      <button key={`${tg.region}:${tg.parentId ?? ""}`} type="button" role="menuitem"
                        className="lay__moveto-item" disabled={tg.current}
                        style={{ paddingInlineStart: `${12 + tg.depth * 14}px` }}
                        onClick={() => { moveInto(selected.node.id, tg.region, tg.parentId); setMoveOpen(false); }}>
                        <FontAwesomeIcon icon={tg.parentId ? iconFor(tg.type!) : faWindowMaximize} />
                        <span>{tg.label}</span>
                        {tg.current && <em>{t("layoutEditor.moveToHere")}</em>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="lay__props-acts-gap" />
              <Button variant="ghost"
                onClick={() => duplicateNode(selected.node.id)}
                title={`${t("layoutEditor.duplicateBlock")} (Ctrl+D)`} aria-label={t("layoutEditor.duplicateBlock")}>
                <FontAwesomeIcon icon={faClone} />
              </Button>
              {!required.has(selected.node.type) && (
                <Button variant="ghost" className="lay__danger"
                  onClick={() => removeNode(selected.node.id)}
                  title={`${t("layoutEditor.removeBlock")} (Del)`} aria-label={t("layoutEditor.removeBlock")}>
                  <FontAwesomeIcon icon={faTrash} />
                </Button>
              )}
            </div>

            {/* Two tabs, as the design draws them: what this BLOCK is (its settings, who
                sees it, its edge art) and the THEME it sits in (colourway, corners, glow
                — tokens, saved in the appearance draft). The block's style variant sits
                under Theme style: it chooses which of the theme's looks the block wears,
                and its colours are theme tokens too. */}
            {advanced && <div className="lay__props-tabs" role="tablist" aria-label={t("layoutEditor.inspectorTabs")}>
              <button type="button" role="tab" aria-selected={inspectorTab === "block"}
                className={inspectorTab === "block" ? "is-on" : ""} onClick={() => setInspectorTab("block")}>
                <FontAwesomeIcon icon={faCube} />{t("layoutEditor.tabBlock")}
              </button>
              <button type="button" role="tab" aria-selected={inspectorTab === "theme"}
                className={inspectorTab === "theme" ? "is-on" : ""} onClick={() => setInspectorTab("theme")}>
                <FontAwesomeIcon icon={faPalette} />{t("layoutEditor.tabTheme")}
              </button>
            </div>}
            <div className="lay__props-body">
              {/* Simple mode is the block's own settings only. */}
              {inspectorTab === "block" || !advanced ? (
                <>
                {(() => {
                  const about = t(`layoutEditor.blockDesc.${selected.node.type}`, { defaultValue: "" });
                  return about ? <p className="lay__props-about">{about}</p> : null;
                })()}
                {(selected.node.type === "section" || selected.node.type === "columns") && (
                  <SectionColumnsPicker
                    key={`cols:${selected.node.id}`}
                    value={sectionLayoutOf(selected.node)}
                    onChange={(k) => applyTree((r) => setSectionLayout(r, selected.node.id, k))}
                  />
                )}
                {(() => {
                  // Text typed over a TRANSLATED default is one language for everyone
                  // now. Said where it happened, with the way back.
                  const shipped = findNode(defaultLayoutFor(templateKey).regions, selected.node.id)?.node;
                  const fixed = Object.entries(shipped?.props ?? {}).filter(([k, v]) =>
                    !!v && typeof v === "object" && "key" in v && typeof selected.node.props[k] === "string");
                  if (fixed.length === 0) return null;
                  return (
                    <div className="lay__fixedtext">
                      <p className="acp-hint">{t("layoutEditor.sections.fixedText")}</p>
                      <Button variant="ghost"
                        onClick={() => updateProps(selected.node.id, { ...selected.node.props, ...Object.fromEntries(fixed) })}>
                        {t("layoutEditor.sections.useTranslated")}
                      </Button>
                    </div>
                  );
                })()}
                <div className="lay__props-section">{t("layoutEditor.sectionSettings")}</div>
                {(() => {
                  // The site chrome's three bands have their own panels (ChromeSettings),
                  // which also carry the structure settings: where search sits, the
                  // navbar's small logo, which end its links sit at.
                  const Chrome = CHROME_SETTINGS[selected.node.type];
                  if (Chrome && doc) {
                    return (
                      <>
                        <Chrome key={`chrome:${selected.node.id}`} node={selected.node} regions={doc.regions}
                          onProps={(next) => updateProps(selected.node.id, next)}
                          onTree={(next) => applyTree(() => next)} />
                      </>
                    );
                  }
                  const hasProps = Object.keys(schemaFor(selected.node.type)?.properties ?? {}).length > 0;
                  return (
                    <>
                      <SchemaFields
                        compact
                        schema={schemaFor(selected.node.type)}
                        // Core blocks' setting texts are translated; a plugin block's are its own.
                        textKey={`blocks.${blockTextType(selected.node.type)}.props`}
                        values={selected.node.props}
                        onChange={(next) => updateProps(selected.node.id, next)}
                        // The background props get a picker, an uploader and a preview
                        // instead of a text box and a number — see BlockBackground.
                        omit={paintsBackground(selected.node.type) ? BACKGROUND_PROPS : undefined}
                      />
                      {!hasProps && <div className="acp-hint">{t("layoutEditor.noProps")}</div>}
                      {/* Whether a block paints is read from its SCHEMA, not its name.
                          ⚠ NAMESPACED key: BlockStyleFields below keys on the bare id, and
                          two siblings sharing a key make React duplicate them. */}
                      {paintsBackground(selected.node.type) && (
                        <BlockBackgroundFields
                          key={`bg:${selected.node.id}`}
                          image={selected.node.props.backgroundImage as string | undefined}
                          gradient={selected.node.props.backgroundGradient as string[] | undefined}
                          angle={selected.node.props.backgroundAngle as number | undefined}
                          onChange={(patch) => updateProps(selected.node.id, { ...selected.node.props, ...patch })}
                          inherits={STYLED_SURFACES.has(selected.node.type)}
                        />
                      )}
                    </>
                  );
                })()}


                {/* The header's dropdowns + the pill they open from: theme tokens, offered
                    where the admin clicks them (the preview opens the dropdown too). */}
                {(() => {
                  const groups = menuGroupsFor(selected.node.type);
                  return groups && (
                    <InspectorFold key={`menu:${selected.node.id}`} defaultOpen
                      title={t("layoutEditor.dropdownStyle")}>
                      <BlockMenuStyle groups={groups} />
                    </InspectorFold>
                  );
                })()}

                {/* A required block may be moved anywhere but never restricted: an
                    audience would achieve by hiding exactly what deletion is
                    forbidden to do. Refused by the API too. */}
                {/* Advanced only — unless the block already HAS an audience, which must
                    stay visible (and removable) in Simple too. */}
                {(advanced || selected.node.visibility) && (
                <InspectorFold key={`vis:${selected.node.id}`} title={t("layoutEditor.whoSeesIt")}
                  active={!!selected.node.visibility}>
                  {required.has(selected.node.type) ? (
                    <div className="acp-hint lay__vis-note">{t("layoutEditor.audienceRequired")}</div>
                  ) : (
                    <BlockVisibilityFields bare
                      value={selected.node.visibility}
                      onChange={(next) => updateVisibility(selected.node.id, next)}
                    />
                  )}
                </InspectorFold>
                )}

                {/* Edge art belongs to a SURFACE — a band, a card, a panel — not to a link
                    or a button. Still offered where a block already has some, so it can
                    be taken off again. */}
                {((advanced && hasSurface(selected.node.type)) || selected.node.edges) && (
                  <InspectorFold key={`edge:${selected.node.id}`} title={t("layoutEditor.edge.title")}
                    active={!!(selected.node.edges?.top || selected.node.edges?.bottom)}>
                    <BlockEdgeArtFields bare
                      clipsOutside={clipsOutside(previewRef.current, selected.node.id)}
                      blockType={selected.node.type}
                      templateKey={templateKey}
                      value={selected.node.edges}
                      onChange={(next) => applyTree((r) => updateBlockEdges(r, selected.node.id, next))}
                    />
                  </InspectorFold>
                )}

                {/* Add-ons' settings for this kind of block (an avatar effect on the avatar
                    block). They stage site-wide theme tokens, so they show on every page. */}
                {blockPanelsFor(selected.node.type).map(({ id, title, active, Panel }) => (
                  <InspectorFold key={`panel:${id}:${selected.node.id}`} title={title()}
                    active={active?.(themeTokens) ?? false}>
                    <Panel
                      block={{ id: selected.node.id, type: selected.node.type, props: selected.node.props ?? {} }}
                      templateKey={templateKey}
                      themeTokens={themeTokens}
                      setThemeTokens={(tokens) => patchThemeTokens.mutate(tokens)}
                    />
                  </InspectorFold>
                ))}

                {/* One icon, picked in the preview. Shown only while an icon of THIS block
                    is picked — the override lives on the block. */}
                {iconPick && iconPick.id === selected.node.id && (
                  <div className="lay__iconpick" ref={iconPanelRef}>
                    <div className="acp-label">
                      {t("layoutEditor.iconOverride", { slot: iconPick.slot.replace("#", " · ") })}
                    </div>
                    <IconPicker
                      key={iconPick.slot}
                      value={selected.node.iconOverrides?.[iconPick.slot] ?? ""}
                      onChange={(tok) => applyTree((r) =>
                        updateBlockIconOverride(r, iconPick.id, iconPick.slot, tok))}
                    />
                    {/* Clearing must be reachable: the picker has no empty state. */}
                    <Button variant="ghost"
                      disabled={!selected.node.iconOverrides?.[iconPick.slot]}
                      onClick={() => applyTree((r) =>
                        updateBlockIconOverride(r, iconPick.id, iconPick.slot, undefined))}>
                      {t("layoutEditor.iconOverrideClear")}
                    </Button>
                  </div>
                )}

                </>
              ) : (
                <ThemeStyleFields>
                {/* Click-to-scope: the block chooses a look, the panel edits what that
                      look means. Keyed by block so switching selection resets it. */}
                  <BlockStyleFields
                    key={selected.node.id}
                    variant={selected.node.variant}
                    onVariantChange={(next) => updateVariant(selected.node.id, next)}
                    className={selected.node.className}
                    onClassNameChange={(next) => updateClassName(selected.node.id, next)}
                    headingFont={selected.node.headingFont}
                    onHeadingFontChange={(next) => updateHeadingFont(selected.node.id, next)}
                    isContainer={!!getBlock(selected.node.type)?.container}
                    onPreviewCss={setVariantCss}
                  />

                </ThemeStyleFields>
              )}
            </div>
          </div>
          ) : (
          <div className="lay__props lay__props--theme">
            <div className="lay__props-ident">
              <span className="lay__props-icon" aria-hidden="true"><FontAwesomeIcon icon={faPalette} /></span>
              <span className="lay__props-text">
                <b>{t("layoutEditor.sections.themeTitle")}</b>
                <span className="lay__props-path">{t("layoutEditor.sections.themeHint")}</span>
              </span>
            </div>
            <div className="lay__props-body"><ThemeStyleFields /></div>
          </div>
          )}
        </div>
      </div>

      {/* The catalogue. Rendered last and fixed-position, so it is never clipped by
          the rail's own scroll container the way an inline panel would be. */}
      <StudioTour open={tourOpen} hasSelection={!!selectedId} onClose={closeTour} />

      {browseTarget && (
        <BlockCatalogue
          templateKey={templateKey}
          parentType={browseTarget.parentId
            ? findNode(doc?.regions ?? {}, browseTarget.parentId)?.node.type
            : null}
          regionName={regionLabel(browseTarget.region, templateKey, t)}
          narrow={browseTarget.region === "aside"}
          onPick={(type) => addBlock(type, browseTarget.region, browseTarget.parentId)}
          onClose={() => setBrowseTarget(null)}
        />
      )}
    </div>
  );
}

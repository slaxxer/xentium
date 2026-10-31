/**
 * The site frame on the page: which mode, and the values the stylesheet reads.
 *
 * Two small stores, both for the same reason — `AppLayout` draws the frame, and it
 * sits ABOVE the two things that decide it:
 *
 * - the PAGE, which may wear its own frame. The shell does not know which template a
 *   route renders; the page's `LayoutRenderer` does, and says so here.
 * - the EDITOR, whose unsaved frame is pushed into the preview over the bridge, the
 *   same way the working layout document is.
 */
import { useLayoutEffect, useSyncExternalStore, type CSSProperties } from "react";
import {
  DEFAULT_SITE_FRAME,
  frameBackgroundCss,
  frameModeFor,
  isChromeTemplate,
  parseSiteFrame,
  type FrameMode,
  PAGE_ATTR,
  type LayoutDocument,
  type SiteFrame,
  type TemplateKey,
} from "@xentium/contracts";
import { usePublishedLayouts } from "./useLayout";

// ── Which page is on screen ────────────────────────────────────────────────

let pageTemplate: TemplateKey | null = null;
const pageListeners = new Set<() => void>();

function setPageTemplate(next: TemplateKey | null) {
  if (pageTemplate === next) return;
  pageTemplate = next;
  // Per-page design: the served stylesheet scopes a page's tokens to
  // `:root[data-xt-page="<key>"]` (`scopeSelector`), so the root says which page
  // this is, for as long as it is on screen. Pages without a layout carry none.
  if (typeof document !== "undefined") {
    if (next) document.documentElement.setAttribute(PAGE_ATTR, next);
    else document.documentElement.removeAttribute(PAGE_ATTR);
  }
  for (const fn of pageListeners) fn();
}

const subscribePage = (fn: () => void) => { pageListeners.add(fn); return () => { pageListeners.delete(fn); }; };
const pageSnapshot = () => pageTemplate;

/**
 * Declare the template this page renders, for the frame to follow.
 *
 * A LAYOUT effect, so the frame changes in the same paint as the page — a passive
 * effect would show one frame of the previous page's mode on every navigation.
 * Chrome is not a page, and is ignored.
 */
export function useRegisterPageTemplate(templateKey: TemplateKey): void {
  useLayoutEffect(() => {
    if (isChromeTemplate(templateKey)) return;
    setPageTemplate(templateKey);
    // Cleared only if nothing newer claimed it: the next page's effect can run
    // before this one's cleanup when React swaps routes.
    return () => { if (pageTemplate === templateKey) setPageTemplate(null); };
  }, [templateKey]);
}

export function usePageTemplate(): TemplateKey | null {
  return useSyncExternalStore(subscribePage, pageSnapshot, pageSnapshot);
}

// ── The page's band in the site header ──────────────────────────────────────

/** What the site header draws under its own blocks for the page on screen. */
export interface PageBand {
  document: LayoutDocument;
  context?: unknown;
}

let pageBand: PageBand | null = null;
const bandListeners = new Set<() => void>();

const subscribeBand = (fn: () => void) => { bandListeners.add(fn); return () => { bandListeners.delete(fn); }; };
const bandSnapshot = () => pageBand;

/**
 * Hand the page's `headerBand` region to the site header (`PubNav`), which sits
 * outside the page in the tree. A LAYOUT effect for the same reason as the page
 * mark: the band changes in the paint the page does.
 */
export function useRegisterPageBand(band: PageBand | null): void {
  useLayoutEffect(() => {
    if (!band) return;
    pageBand = band;
    for (const fn of bandListeners) fn();
    return () => {
      if (pageBand !== band) return;
      pageBand = null;
      for (const fn of bandListeners) fn();
    };
  }, [band]);
}

export function usePageBand(): PageBand | null {
  return useSyncExternalStore(subscribeBand, bandSnapshot, bandSnapshot);
}

// ── The editor's unsaved frame (preview only) ──────────────────────────────

let liveFrame: SiteFrame | null = null;
const liveListeners = new Set<() => void>();

export function setLivePreviewFrame(frame: unknown): void {
  liveFrame = frame ? parseSiteFrame(frame) : null;
  for (const fn of liveListeners) fn();
}

const subscribeLive = (fn: () => void) => { liveListeners.add(fn); return () => { liveListeners.delete(fn); }; };
const liveSnapshot = () => liveFrame;

/** The frame to draw: the editor's unsaved one in the preview, else the served one. */
export function useSiteFrame(): SiteFrame {
  const live = useSyncExternalStore(subscribeLive, liveSnapshot, liveSnapshot);
  const { data } = usePublishedLayouts();
  return live ?? (data?.frame ? parseSiteFrame(data.frame) : DEFAULT_SITE_FRAME);
}

// ── Rendering ──────────────────────────────────────────────────────────────

/**
 * An upload path as a URL — the rule `resolveImageSource` in coreBlocks applies.
 * Repeated rather than imported: coreBlocks imports LayoutRenderer, which imports this.
 */
const imageUrl = (source: string): string =>
  source.startsWith("http") || source.startsWith("/") ? source : `/uploads/${source}`;

export interface FramePresentation {
  mode: FrameMode;
  className: string;
  style: CSSProperties;
}

/**
 * The frame as classes and custom properties on `.app-layout`.
 *
 * Everything that varies is a custom property, so the modes themselves are plain CSS
 * in `AppLayout.scss` — and a theme's custom CSS can restyle a mode without knowing
 * any of this. The shadow is a NAME, resolved to a token there.
 */
export function presentFrame(frame: SiteFrame, templateKey: TemplateKey | null): FramePresentation {
  const mode = frameModeFor(frame, templateKey);
  const bg = frame.background;
  const image = bg.type === "image" && bg.image.trim() ? imageUrl(bg.image.trim()) : undefined;
  const classes = [
    "app-layout",
    `app-layout--frame-${mode}`,
    mode !== "full" && "app-layout--boxed",
    mode !== "full" && `app-layout--phone-${frame.phone}`,
    mode !== "full" && bg.fixed && "app-layout--bg-fixed",
  ].filter(Boolean);

  // Content widths apply in every mode, and only when changed: an inline property
  // would override a theme that sets `--content-max` in its own tokens.
  const widths = {
    ...(frame.contentWidth !== DEFAULT_SITE_FRAME.contentWidth ? { "--content-max": `${frame.contentWidth}px` } : {}),
    ...(frame.readingWidth !== DEFAULT_SITE_FRAME.readingWidth ? { "--content-narrow": `${frame.readingWidth}px` } : {}),
  } as CSSProperties;

  const style = mode === "full" ? widths : {
    ...widths,
    "--frame-max":     `${frame.maxWidth}px`,
    // `-r`/`-ov` are the admin's values; the stylesheet derives the used ones, so a
    // phone can cap them — an inline property would beat any media query.
    "--frame-r":       `${frame.radius}px`,
    "--frame-shadow":  `var(--frame-shadow-${frame.shadow})`,
    "--frame-ov":      `${frame.overlap}px`,
    "--frame-bg":      frameBackgroundCss(bg, image),
  } as CSSProperties;

  return { mode, className: classes.join(" "), style };
}

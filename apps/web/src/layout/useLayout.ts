/**
 * Published layout documents (ADR-0005).
 *
 * One request serves every template, cached for the session and invalidated by
 * the style-version SSE event — the same channel an appearance publish already
 * uses, so a layout change reaches open tabs without a second push mechanism or
 * any polling.
 *
 * `useLayoutDocument` never returns undefined. Before the fetch resolves, and if
 * it fails entirely, it returns the code default, so a page renders its stock
 * structure rather than flashing empty. That is the same fallback the server
 * applies, which keeps first paint and steady state identical for an untouched
 * template.
 */
import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  defaultLayoutFor,
  type AudienceView,
  type LayoutDocument,
  type TemplateKey,
} from "@nodevo/contracts";
import { api } from "../lib/api";

export const LAYOUTS_QUERY_KEY = ["layouts"] as const;

interface PublishedLayouts {
  /** Core's eight templates plus whatever templates enabled plugins registered. */
  templates: Record<string, LayoutDocument>;
  /** Only variants the site actually stores — an untouched site sends none. */
  variants: Partial<Record<string, Record<string, LayoutDocument>>>;
}

/**
 * The ACP editor previews by loading the REAL route in an iframe with this flag,
 * so every block gets its real context and the preview is the actual page rather
 * than an approximation. The flag only ever reaches the admin draft endpoint,
 * which is permission-gated — a visitor adding it by hand still gets published
 * layouts, because the request 403s and the query falls back to defaults.
 */
export const LAYOUT_PREVIEW_PARAM = "__layout";

/**
 * The two ways to render the DRAFT on a real route.
 *
 * `draft` is the Layout EDITOR's iframe: draft data plus the editor's own chrome —
 * region drop zones, hover outlines, the selection bridge.
 *
 * `preview` is the same data with none of that. It exists because "show me my site
 * with this theme" and "let me edit this layout" were one flag, so previewing a
 * staged theme painted empty-region drop targets labelled HEADER and FOOTER over
 * the page. An admin deciding whether to keep a theme was being shown the editor,
 * not the site.
 */
const DRAFT_MODES = new Set(["draft", "preview"]);

/** Which template the Layout Editor has open, named by the preview URL. */
export const LAYOUT_EDITING_PARAM = "__editing";

/**
 * The template being edited, or `null` when this is not the editor's own preview.
 *
 * Read from the URL rather than passed down, for the same reason the mode is: the
 * preview is a REAL route in an iframe, and the only channel it shares with the
 * editor at first paint is its address.
 */
export function editingTemplate(): TemplateKey | null {
  if (typeof window === "undefined") return null;
  if (layoutMode() !== "draft") return null;
  const key = new URLSearchParams(window.location.search).get(LAYOUT_EDITING_PARAM);
  return key ? (key as TemplateKey) : null;
}

function layoutMode(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(LAYOUT_PREVIEW_PARAM);
}

/** Render the DRAFT rather than what is published. Both modes. */
export function isDraftLayout(): boolean {
  const mode = layoutMode();
  return mode !== null && DRAFT_MODES.has(mode);
}

/**
 * Show the editor's affordances. `draft` only — never `preview`.
 *
 * ⚠ Keep this apart from `isDraftLayout`. They were one predicate, and every new
 * caller had to guess which meaning it wanted; the guess that put editor chrome on
 * a theme preview is the one that made the split necessary.
 */
export function isLayoutPreview(): boolean {
  return layoutMode() === "draft";
}

/**
 * Which arrangement the EDITOR is showing (preview only).
 *
 * Without it the preview would show a page's guest and member arrangements stacked —
 * the landing on top of the signed-in columns — which is not a view anyone ever has.
 *
 * Held as an `AudienceView`, not a synthetic viewer, so the preview hides exactly what
 * the TREE hides: both ask `audienceInView`. A concrete viewer would disagree, because
 * a groupless "member" cannot see a `groups`-restricted block that nonetheless belongs
 * to the member arrangement — the row would be in the tree and missing from the preview.
 *
 * `null` outside the editor, where the real viewer decides.
 */
let previewAudience: AudienceView | null = null;
const viewerListeners = new Set<() => void>();

export function setPreviewAudience(next: AudienceView | null): void {
  previewAudience = next;
  for (const fn of viewerListeners) fn();
}

function subscribeViewer(fn: () => void): () => void {
  viewerListeners.add(fn);
  return () => viewerListeners.delete(fn);
}

const viewerSnapshot = () => previewAudience;

export function usePreviewAudience(): AudienceView | null {
  return useSyncExternalStore(subscribeViewer, viewerSnapshot, viewerSnapshot);
}

/**
 * Live document pushed from the editor (preview only).
 *
 * The preview renders the admin's *working* document, not the saved one, so an
 * edit shows up immediately instead of after a save. The editor postMessages the
 * document on every change; `previewBridge` drops it here and the render picks it
 * up through `useSyncExternalStore`.
 */
/** Keyed `templateKey` or `templateKey|variant` — see `liveKey`. */
let liveDocs: Record<string, LayoutDocument> = {};
const liveListeners = new Set<() => void>();

/** One key per (template, variant), so previewing a page's own layout is distinct
 *  from previewing the template default. */
export const liveKey = (templateKey: TemplateKey, variant?: string): string =>
  variant ? `${templateKey}|${variant}` : templateKey;

export function setLivePreviewDocument(
  templateKey: TemplateKey,
  doc: LayoutDocument,
  variant?: string,
): void {
  liveDocs = { ...liveDocs, [liveKey(templateKey, variant)]: doc };
  for (const fn of liveListeners) fn();
}

function subscribeLive(fn: () => void): () => void {
  liveListeners.add(fn);
  return () => liveListeners.delete(fn);
}

const liveSnapshot = () => liveDocs;

export function usePublishedLayouts() {
  // DATA, so both modes — a preview that read published layouts would be a preview
  // of nothing.
  const preview = isDraftLayout();
  return useQuery<PublishedLayouts>({
    queryKey: preview ? [...LAYOUTS_QUERY_KEY, "draft"] : LAYOUTS_QUERY_KEY,
    queryFn:  () => api.get(preview ? "/admin/layouts" : "/layouts"),
    staleTime: Infinity,   // invalidated explicitly on the style-version event
    retry: false,          // a failure falls back to defaults; retrying blocks nothing
  });
}

/**
 * The document to render, defaulting while loading and on failure.
 *
 * `variant` names one instance of the template — a page slug for `page.detail`.
 * Resolution is the same two steps the server applies: the variant's own document,
 * then the template default, then the code default. Two steps and no cascade is the
 * whole point; a template hierarchy is what this design exists to avoid.
 */
export function useLayoutDocument(templateKey: TemplateKey, variant?: string): LayoutDocument {
  /**
   * ONE source for every document on screen: published on the site, staged in the
   * editor. The site header and footer are editable from a page's editor — click the
   * masthead and it opens — so they have to show what is staged, or an edit made two
   * clicks ago would not appear. The rule an admin can hold: the editor previews the
   * staged site, and Publish ships exactly that (it promotes every pending draft).
   *
   * ⚠ It briefly worked the other way — drafts for the open template, published for
   * the chrome around it — to explain a masthead that was missing from every preview.
   * That was the wrong half of the answer: the header was missing from the TREE, so
   * nothing said it had a staged version at all. It is in the tree now, and a pending
   * chrome draft says so where it is listed.
   */
  const { data } = usePublishedLayouts();
  const source = data;
  // In the preview, an unsaved document pushed by the editor wins — that is what
  // makes edits appear instantly rather than only after a save. Keyed by selector so
  // editing one page's layout does not bleed into another's preview.
  const live = useSyncExternalStore(subscribeLive, liveSnapshot, liveSnapshot);
  const key = liveKey(templateKey, variant);

  // The last fallback is the REGISTERED default, which is how a plugin template
  // renders its own shipped arrangement on first paint instead of a blank page: the
  // plugin's bundle registered it before the app mounted, while this query has not
  // come back yet.
  return live[key]
    ?? (variant ? source?.variants?.[templateKey]?.[variant] : undefined)
    ?? source?.templates?.[templateKey]
    ?? defaultLayoutFor(templateKey);
}

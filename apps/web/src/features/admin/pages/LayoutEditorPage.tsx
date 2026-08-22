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
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus, faRotateLeft, faRotateRight, faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { z } from "zod";
import {
  CORE_TEMPLATE_KEYS,
  DEFAULT_VARIANT,
  isChromeTemplate,
  regionsFor,
  requiredBlocksFor,
  templateAcceptsVariants,
  type BlockNode,
  type AudienceView,
  type BlockVariant,
  type BlockVisibility,
  type LayoutDocument,
  type LayoutDraftResponse,
  type LayoutSelector,
  type CoreTemplateKey,
  type TemplateKey,
} from "@nodevo/contracts";
import { api } from "../../../lib/api";
import { pagesApi } from "../../../lib/pagesApi";
import { articlesApi } from "../../../lib/articlesApi";
import { authStore } from "../../../lib/authStore";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { SchemaFields, defaultsFor, type FieldSchema } from "../../../components/SchemaFields";
import { acceptsChild, getBlock } from "../../../layout/blockRegistry";
import { shortcutFor } from "../../../layout/editorShortcuts";
import { LAYOUT_PREVIEW_PARAM } from "../../../layout/useLayout";
import {
  canNestInto,
  cloneBlock,
  collectIds,
  findNode,
  insertBlock,
  moveBlock,
  newBlockId,
  removeBlock,
  updateBlockProps,
  updateBlockVariant,
  updateBlockVisibility,
  type Regions,
} from "../../../layout/blockTree";
import { useAutosave } from "../../../hooks/useAutosave";
import { useLayoutHistory, type LayoutSnapshot } from "./useLayoutHistory";
import {
  BlockList,
  BlockPicker,
  type DragSrc,
  type DropAt,
  type TreeCtx,
} from "./LayoutTree";
import { BlockVisibilityFields } from "./BlockVisibility";
import { BlockStyleFields } from "./BlockStyle";
import "./LayoutEditorPage.scss";

/** The route each template previews at. Themes re-lay-out existing pages, so a
 *  template always has exactly one real URL to show. */
/**
 * Where each template previews.
 *
 * Only a FALLBACK for the three templates that render per instance — `page.detail`,
 * `profile` and `article.detail` need a real slug or username, resolved at runtime
 * below. Previously `profile` pointed at `/members` and `article.detail` at the
 * article index, so choosing either showed a page the blocks being arranged do not
 * even appear on.
 */
const PREVIEW_ROUTE: Record<CoreTemplateKey, string> = {
  "home":           "/",
  "article.index":  "/articles",
  "article.detail": "/articles",
  "page.detail":    "/",
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

/** JSON Schema for a block's props, straight from its registered Zod schema. */
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

export function LayoutEditorPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();

  const [templateKey, setTemplateKey] = useState<TemplateKey>("article.index");
  // "" = the template default. A variant is one instance of the template — a page
  // slug for `page.detail`.
  const [variant, setVariant] = useState<string>(DEFAULT_VARIANT);
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
  const [adding, setAdding] = useState<string | null>(null); // region awaiting a pick
  const previewRef = useRef<HTMLIFrameElement>(null);

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
    queryKey: ["acp-layout-templates"],
    queryFn:  () => api.get("/admin/layouts/templates"),
  });

  const qs = variant ? `?variant=${encodeURIComponent(variant)}` : "";

  const draftQuery = useQuery<LayoutDraftResponse>({
    queryKey: ["acp-layout", templateKey, variant],
    queryFn:  () => api.get(`/admin/layouts/${templateKey}${qs}`),
  });
  const draftDoc = draftQuery.data?.document;

  const statusQuery = useQuery<{ pending: LayoutSelector[] }>({
    queryKey: ["acp-layout-status"],
    queryFn:  () => api.get("/admin/layouts/draft-status"),
  });

  // `page.detail` needs real pages: one to preview the template default against, and
  // the full list to offer as variants. Fetched lazily so every other template costs
  // nothing.
  const supportsVariants = templateAcceptsVariants(templateKey);
  const pagesQuery = useQuery({
    queryKey: ["acp-layout-pages"],
    // EVERY page, not just the published ones. A page's layout is most worth
    // arranging BEFORE it goes live, and filtering to `published` meant a page
    // created minutes ago — still a draft, as every new page is — simply did not
    // appear, leaving "Default" as the only choice and no way to reach it.
    queryFn:  () => pagesApi.list({ limit: 100 }),
    enabled:  supportsVariants,
    // Short, because the journey that lands here is "create a page, go and lay it
    // out". A minute of cached list is a minute of the new page being missing.
    staleTime: 5_000,
  });
  /**
   * Alphabetical. The API orders by `updatedAt` — sensible for a management list,
   * useless in a picker, where the question is "where is the page called X".
   */
  const pages = useMemo(
    () => [...(pagesQuery.data?.data ?? [])].sort((a, b) => a.title.localeCompare(b.title)),
    [pagesQuery.data],
  );
  /** More pages than one request returns; the picker would silently omit the rest. */
  const pagesTruncated = (pagesQuery.data?.meta?.total ?? 0) > pages.length;

  /** Variants that already carry their own stored document, to mark in the picker. */
  const variantsQuery = useQuery<{ variant: string; scope: string }[]>({
    queryKey: ["acp-layout-variants", templateKey],
    queryFn:  () => api.get(`/admin/layouts/${templateKey}/variants`),
    enabled:  supportsVariants,
  });
  const customised = new Set((variantsQuery.data ?? []).map((v) => v.variant));

  /**
   * How many pages the template default actually reaches.
   *
   * It is a FALLBACK, not a broadcast: `resolve()` returns a page's own document
   * whenever it has one and only then looks at the default. So the reach is exactly
   * the pages that have never been laid out individually — which is what the picker
   * now says, because "all pages" read like an override and made editing it feel
   * dangerous in a way it is not.
   */
  const inheritingCount = pages.filter((p) => !customised.has(p.slug)).length;
  /** Suppressed until the lists land, so the count never flashes a wrong zero. */
  const inheritingKnown = !!pagesQuery.data && !!variantsQuery.data;

  /**
   * Previewing the default renders against SOME page; previewing a variant must
   * render against its own.
   *
   * A PUBLISHED one is preferred for the default, because `/p/:slug` refuses an
   * unpublished page to everyone including an admin (`canViewPage` checks the status
   * before it checks the viewer). Now that drafts are listed, taking the first page
   * blindly would point the template default's preview at a 404 on any site whose
   * most recent page happens to be a draft.
   */
  const previewPageSlug =
    variant || (pages.find((p) => p.status === "published") ?? pages[0])?.slug;

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

  /**
   * Messages from the preview iframe: an admin clicked a block, or dragged one.
   * The editor stays the single source of truth — the preview reports intent and
   * this applies it to the document, exactly as the tree does.
   */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return; // never trust a foreign frame
      const msg = e.data as {
        source?: string; type?: string; id?: string;
        region?: string; parentId?: string | null; index?: number;
        action?: "undo" | "redo";
      };
      if (msg?.source !== "nv-preview") return;

      if (msg.type === "select" && msg.id) setSelectedId(msg.id);

      if (msg.type === "move" && msg.id && msg.region && typeof msg.index === "number") {
        // Goes through the same `applyTree` the tree's own drags use, so a move made
        // in the preview is one undo step exactly like a move made in the rail. It
        // reads the document through `docRef`, which is why this listener can be
        // registered once and still never act on a stale document.
        latest.current.applyTree((r) => moveBlock(r, msg.id!, {
          region:   msg.region!,
          parentId: msg.parentId ?? null,
          index:    msg.index!,
        }));
        setSelectedId(msg.id);
      }

      // Ctrl+Z inside the preview. Keystrokes in an iframe never reach this document,
      // and the preview is precisely where blocks get dragged into the wrong place —
      // so the bridge forwards the shortcut rather than making an admin click the rail
      // first to be allowed to undo.
      if (msg.type === "shortcut") {
        if (msg.action === "undo") latest.current.undo();
        if (msg.action === "redo") latest.current.redo();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /**
   * Pending variant tokens, pushed into the preview as a stylesheet.
   *
   * The preview iframe loads the real route, which serves the PUBLISHED appearance CSS —
   * so a token edit staged in the appearance draft would be invisible here until
   * publish, which defeats the point of editing colours against a live preview. The
   * panel hands over the CSS it would produce and the bridge injects it.
   */
  const [styleCss, setStyleCss] = useState("");

  useEffect(() => {
    previewRef.current?.contentWindow?.postMessage(
      { source: "nv-editor", type: "tokens", css: styleCss },
      window.location.origin,
    );
  }, [styleCss]);

  /** Push the chosen audience into the preview whenever it changes. */
  useEffect(() => {
    previewRef.current?.contentWindow?.postMessage(
      { source: "nv-editor", type: "audience", audience },
      window.location.origin,
    );
  }, [audience]);

  // Selecting in the tree highlights the same block in the preview.
  useEffect(() => {
    previewRef.current?.contentWindow?.postMessage(
      { source: "nv-editor", type: "highlight", id: selectedId },
      window.location.origin,
    );
  }, [selectedId]);

  /**
   * Push the working document to the preview on every change, so an edit is
   * visible immediately instead of only after a save. The preview renders what
   * it is given; the save below is about persistence, not about seeing.
   */
  useEffect(() => {
    if (!doc) return;
    previewRef.current?.contentWindow?.postMessage(
      { source: "nv-editor", type: "document", templateKey, variant, document: doc },
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
  useAutosave({
    value: doc,
    savedValue: draftDoc,
    delay: 700,
    // Suspended while a conflict is unresolved: retrying on every keystroke would
    // hammer a write the server has already refused, and would bury the prompt that
    // is the only way out of it.
    onSave: (next) => { if (next && !conflict) save.mutate(next); },
  });

  const templateInfo = templatesQuery.data?.find((x) => x.key === templateKey);
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

  // ── Mutations ─────────────────────────────────────────────────────────────

  const save = useMutation({
    mutationFn: (next: LayoutDocument) =>
      api.put<LayoutDraftResponse>(`/admin/layouts/${templateKey}${qs}`, {
        document: next,
        baseVersion: versionRef.current,
      }),
    // What was WRITTEN is the new baseline — not whatever the editor holds now, which
    // may already have moved on while the request was in flight.
    onSuccess: (res, written) => {
      savedJsonRef.current = JSON.stringify(written);
      // The row moved on because WE moved it; without adopting the new revision the
      // very next autosave would conflict with our own write.
      versionRef.current = res.version;
      setDirty(JSON.stringify(docRef.current) !== savedJsonRef.current);
      qc.invalidateQueries({ queryKey: ["acp-layout-status"] });
      // A first save on a variant makes it "customised" in the picker.
      qc.invalidateQueries({ queryKey: ["acp-layout-variants", templateKey] });
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

  const publish = useMutation({
    mutationFn: () => api.post<{ published: LayoutSelector[] }>("/admin/layouts/publish"),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["acp-layout-status"] });
      // Publishing clears the draft server-side, so the editor's copy is stale.
      qc.invalidateQueries({ queryKey: ["acp-layout", templateKey, variant] });
      toast.success(
        res.published.length
          ? t("layoutEditor.published", { count: res.published.length })
          : t("layoutEditor.nothingPending"),
      );
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
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
      qc.invalidateQueries({ queryKey: ["acp-layout-variants", templateKey] });
      previewRef.current?.contentWindow?.location.reload();
      toast.success(t("layoutEditor.discardDone"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const revertTheme = useMutation({
    mutationFn: () => api.post<LayoutDocument>(`/admin/layouts/${templateKey}/revert-theme`),
    onSuccess: () => {
      history.clear();
      qc.invalidateQueries({ queryKey: ["acp-layout", templateKey, variant] });
      qc.invalidateQueries({ queryKey: ["acp-layout-status"] });
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
      qc.invalidateQueries({ queryKey: ["acp-layout-variants", templateKey] });
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
  const latest = useRef({ applyTree, undo: undoEdit, redo: redoEdit });
  latest.current = { applyTree, undo: undoEdit, redo: redoEdit };

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
    setAdding(null);
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

  const removeNode = (id: string) => {
    applyTree((r) => removeBlock(r, id));
    // Anything nested inside also just went away, so a selection pointing into it
    // would leave the settings panel describing a block that no longer exists. The
    // check reads `docRef`, which `commitDoc` has already advanced to the tree WITHOUT
    // the block — against the pre-removal tree every descendant still resolves, so the
    // only selection this could ever clear was the removed node itself.
    setSelectedId((s) => (s && findNode(docRef.current?.regions ?? {}, s) ? s : null));
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

  const toggleAdd = (key: string) => setAdding((cur) => (cur === key ? null : key));
  const closeAdd = () => setAdding(null);

  const treeCtx: TreeCtx = {
    t, templateKey, selectedId, dragId, dropAt, adding, required, audience,
    select: setSelectedId,
    startDrag, endDrag, hover, drop: dropHere,
    nudge, remove: removeNode, duplicate: duplicateNode, toggleAdd, closeAdd, add: addBlock,
  };

  async function confirmReset() {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("layoutEditor.resetTitle"),
      // Resetting a variant drops back to the template default; resetting the default
      // drops back to what shipped. Different enough to say out loud.
      body:  variant ? t("layoutEditor.resetVariantBody") : t("layoutEditor.resetBody"),
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
  const previewRoute =
    templateKey === "page.detail"    && previewPageSlug    ? `/p/${encodeURIComponent(previewPageSlug)}`
    : templateKey === "profile"        && previewUsername    ? `/u/${encodeURIComponent(previewUsername)}`
    : templateKey === "article.detail" && previewArticleSlug ? `/articles/${encodeURIComponent(previewArticleSlug)}`
    // A plugin says where its own page lives; core cannot know. `/` is the honest
    // fallback for a plugin that declared no route — it previews the chrome and shows
    // the admin that this template has no page to point at.
    : templateInfo?.previewRoute
      ?? PREVIEW_ROUTE[templateKey as CoreTemplateKey]
      ?? "/";
  const previewSrc = `${previewRoute}?${LAYOUT_PREVIEW_PARAM}=draft`;

  return (
    <div className="lay">
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.appearance")}</div>
          <h1 className="acp-page-title">{t("layoutEditor.title")}</h1>
        </div>
      </div>
      <p className="lay__intro">{t("layoutEditor.subtitle")}</p>

      {/* Toolbar */}
      <div className="lay__bar">
        <select
          className="acp-input lay__template"
          value={templateKey}
          onChange={(e) => {
            setTemplateKey(e.target.value as TemplateKey);
            // A variant key belongs to one template; carrying a page slug over to
            // `profile` would address a row that can never exist.
            setVariant(DEFAULT_VARIANT);
          }}
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

        {/* Which INSTANCE of the template is being edited. Only shown for templates
            that have instances: `page.detail` renders every custom page, so "Default"
            is the arrangement they all inherit and a page name is that page's own.
            A page with its own document is marked, so an admin can see at a glance
            which ones deviate. */}
        {supportsVariants && (
          <select
            className="acp-input lay__variant"
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
          >
            <option value={DEFAULT_VARIANT}>
              {t("layoutEditor.variantDefault")}
              {inheritingKnown ? ` (${inheritingCount})` : ""}
            </option>
            {pages.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title}
                {/* Unpublished is worth saying: the layout is fully editable, but
                    `/p/:slug` refuses an unpublished page to everyone, so the preview
                    pane will show "not found" until the page goes live. Better to name
                    that up front than to let it read as a broken editor. */}
                {p.status !== "published" ? ` · ${t("layoutEditor.variantUnpublished")}` : ""}
                {customised.has(p.slug) ? " ●" : ""}
              </option>
            ))}
          </select>
        )}

        {/* One request's worth of pages. Saying so beats a picker that quietly ends. */}
        {supportsVariants && pagesTruncated && (
          <span className="lay__status">{t("layoutEditor.variantTruncated")}</span>
        )}

        {/* The audience axis. Filters the tree and enforces in the preview, so
            "Home × Guests" is a place to compose the guest arrangement. */}
        <select
          className="acp-input lay__audience"
          value={audience}
          onChange={(e) => setAudience(e.target.value as AudienceView)}
          title={t("layoutEditor.audienceViewHint")}
        >
          <option value="guests">{t("layoutEditor.audienceView.guests")}</option>
          <option value="members">{t("layoutEditor.audienceView.members")}</option>
        </select>

        {/* Undo/redo. Icon-only with the shortcut in the tooltip — the keyboard is
            how these are actually used, but a control an admin can see is how they
            find out the keyboard works at all. */}
        <div className="lay__history">
          <button type="button" className="btn-ghost btn-sm" disabled={!history.canUndo}
            onClick={undoEdit} title={`${t("layoutEditor.undo")} (Ctrl+Z)`}
            aria-label={t("layoutEditor.undo")}>
            <FontAwesomeIcon icon={faRotateLeft} />
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={!history.canRedo}
            onClick={redoEdit} title={`${t("layoutEditor.redo")} (Ctrl+Shift+Z)`}
            aria-label={t("layoutEditor.redo")}>
            <FontAwesomeIcon icon={faRotateRight} />
          </button>
        </div>

        {/* Status only — the draft autosaves, so there is nothing to click.
            "Saving…" while the write is in flight, then the draft/live state. */}
        <span className="lay__status">
          {save.isPending
            ? t("layoutEditor.saving")
            : dirty
              ? t("layoutEditor.unsaved")
              : hasDraft
                ? t("layoutEditor.pending")
                : t("layoutEditor.clean")}
        </span>

        <div className="lay__bar-actions">
          {/* Only when the installed theme actually ships this template — a button that
              404s is worse than no button. */}
          {templateInfo?.hasTheme && !variant && (
            <button type="button" className="btn-ghost btn-sm"
              disabled={revertTheme.isPending}
              onClick={() => void confirmRevertTheme()}>
              <FontAwesomeIcon icon={faRotateLeft} /> {t("layoutEditor.revertTheme")}
            </button>
          )}
          {/* Disabled rather than hidden, matching Publish: both act on the draft, and
              a control that vanishes when there is nothing to do teaches an admin less
              than one that greys out. */}
          <button type="button" className="btn-ghost btn-sm"
            disabled={discard.isPending || !hasDraft}
            onClick={() => void confirmDiscard()}>
            <FontAwesomeIcon icon={faXmark} /> {t("layoutEditor.discard")}
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => void confirmReset()}>
            <FontAwesomeIcon icon={faRotateLeft} /> {t("layoutEditor.reset")}
          </button>
          <button type="button" className="btn-primary btn-sm"
            disabled={publish.isPending || pending.length === 0}
            onClick={() => publish.mutate()}>
            {publish.isPending ? t("layoutEditor.publishing") : t("layoutEditor.publish")}
          </button>
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
            <button type="button" className="btn-ghost btn-sm" onClick={takeTheirs}>
              {t("layoutEditor.conflictReload")}
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={takeMine}>
              {t("layoutEditor.conflictOverwrite")}
            </button>
          </div>
        </div>
      )}

      {/* The reach of what is about to be edited, stated where the editing happens.
          Shown only on the fallback itself — on a page's own layout there is nothing
          to warn about, since it affects exactly that page. */}
      {supportsVariants && !variant && inheritingKnown && (
        <p className="lay__variant-note">
          {t("layoutEditor.variantDefaultNote", { count: inheritingCount })}
        </p>
      )}

      <div className="lay__grid">
        {/* Structure + block settings share one narrow rail; the preview takes
            the rest, since that is what an admin is actually judging. */}
        <div className="lay__rail">
        {/* ── Structure ─────────────────────────────────────────────────── */}
        <div className="lay__tree">
          <div className="lay__pane-title">{t("layoutEditor.structure")}</div>
          {regions.map((region) => {
            const nodes = doc?.regions[region] ?? [];
            const addKey = `r:${region}`;
            return (
              <div
                className="lay__region"
                key={region}
                // Region-level target so a drop on the region's own chrome — its
                // heading, its padding, the "Empty" placeholder — appends rather
                // than doing nothing. Rows and containers stop propagation, so
                // this only fires when nothing more specific claimed the drop.
                onDragOver={(e) => hover(e, { region, parentId: null, index: nodes.length })}
                onDrop={dropHere}
              >
                <div className="lay__region-head">
                  <span>{t(`layoutEditor.region.${region}`, { defaultValue: region })}</span>
                  <button type="button" className="btn-ghost btn-sm"
                    onClick={() => toggleAdd(addKey)}
                    title={t("layoutEditor.addBlock")}>
                    <FontAwesomeIcon icon={faPlus} />
                  </button>
                </div>

                {adding === addKey && (
                  <BlockPicker
                    templateKey={templateKey} depth={1} t={t}
                    onPick={(type) => addBlock(type, region, null)}
                    onClose={closeAdd}
                  />
                )}

                <BlockList nodes={nodes} region={region} parentId={null} depth={1} ctx={treeCtx} />
              </div>
            );
          })}
        </div>

        {/* ── Props (under Structure, same rail) ────────────────────────── */}
        <div className="lay__props">
          <div className="lay__pane-title">{t("layoutEditor.blockSettings")}</div>
          {!selected ? (
            <div className="acp-hint">{t("layoutEditor.selectBlock")}</div>
          ) : (
            <>
              <div className="lay__props-head">
                {getBlock(selected.node.type)?.editorMeta?.label ?? selected.node.type}
              </div>
              <SchemaFields
                schema={schemaFor(selected.node.type)}
                values={selected.node.props}
                onChange={(next) => updateProps(selected.node.id, next)}
              />
              {Object.keys(schemaFor(selected.node.type)?.properties ?? {}).length === 0 && (
                <div className="acp-hint">{t("layoutEditor.noProps")}</div>
              )}
              {/* A required block may be moved anywhere but never restricted: an
                  audience would achieve by hiding exactly what deletion is
                  forbidden to do. Refused by the API too. */}
              {required.has(selected.node.type) ? (
                <div className="acp-hint lay__vis-note">{t("layoutEditor.audienceRequired")}</div>
              ) : (
                <BlockVisibilityFields
                  value={selected.node.visibility}
                  onChange={(next) => updateVisibility(selected.node.id, next)}
                />
              )}
              {/* Click-to-scope: the block chooses a look, the panel edits what that
                  look means. Keyed by block so switching selection resets the panel's
                  pending edits rather than carrying them to another block. */}
              <BlockStyleFields
                key={selected.node.id}
                variant={selected.node.variant}
                onVariantChange={(next) => updateVariant(selected.node.id, next)}
                isContainer={!!getBlock(selected.node.type)?.container}
                onPreviewCss={setStyleCss}
              />
            </>
          )}
        </div>
        </div>

        {/* ── Preview ───────────────────────────────────────────────────── */}
        <div className="lay__preview">
          <div className="lay__pane-title">
            {t("layoutEditor.preview")}
            <span className="lay__preview-url">{previewSrc}</span>
          </div>
          {/* The real route, so blocks receive real context. An iframe keeps ACP
              chrome CSS from bleeding into the site preview. Hover, click-select
              and drag inside it are wired by previewBridge over postMessage. */}
          {/* Re-push on load: the iframe starts by fetching the SAVED draft, so
              without this a reload would silently drop unsaved edits from view. */}
          <iframe
            ref={previewRef}
            src={previewSrc}
            title={t("layoutEditor.preview")}
            onLoad={() => {
              // A reload throws away the iframe's module state, so the working
              // document AND the chosen audience both have to be re-sent — otherwise
              // a reload silently drops unsaved edits from view and reverts the
              // preview to showing every audience.
              const win = previewRef.current?.contentWindow;
              if (!win) return;
              if (doc) {
                win.postMessage(
                  { source: "nv-editor", type: "document", templateKey, variant, document: doc },
                  window.location.origin,
                );
              }
              win.postMessage(
                { source: "nv-editor", type: "audience", audience },
                window.location.origin,
              );
              // Pending variant tokens live in the editor, not in the served CSS, so a
              // reload drops them unless they are re-sent with the rest.
              win.postMessage(
                { source: "nv-editor", type: "tokens", css: styleCss },
                window.location.origin,
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}

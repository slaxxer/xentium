/**
 * Layout renderer (ADR-0005).
 *
 * Walks a `LayoutDocument` and renders each region's blocks through the block
 * registry. The three failure rules live here, and they exist so that no stored
 * document — including one inside a theme we did not author — can take a site
 * down:
 *
 *  1. An invalid document falls back to the template's code default
 *     (`parseLayoutDocument`), never to nothing.
 *  2. An UNKNOWN block type is skipped, not fatal. A theme outliving a plugin,
 *     or a retired block, must leave the rest of the page intact. This is what
 *     makes stored documents forward-compatible across versions.
 *  3. A THROWING block degrades to a placeholder via an error boundary; its
 *     siblings still render.
 *
 * In production the skipped/failed cases render nothing at all. The placeholders
 * are for the ACP preview, where an admin needs to see that something is missing
 * rather than wonder why a region looks empty.
 */
import {
  Component,
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  audienceInView,
  isBlockVisibleTo,
  isRestricted,
  parseLayoutDocument,
  regionsFor,
  blockTypeClass,
  variantClass,
  type AudienceView,
  type BlockNode,
  type BlockViewer,
  type LayoutDocument,
  type TemplateKey,
} from "@nodevo/contracts";
import { authStore } from "../lib/authStore";
import { getBlock } from "./blockRegistry";
import { isLayoutPreview, usePreviewAudience } from "./useLayout";

/**
 * True inside the layout editor's preview iframe — which loads a REAL route with
 * `?__layout=draft`, not a mock page, so blocks get real context. Diagnostics and
 * the hover/drag affordances exist only here; the live site gets neither.
 */
const isEditorPreview = () =>
  typeof window !== "undefined" &&
  (window.location.pathname === "/__theme-preview" || isLayoutPreview());

// ── The document being rendered ──────────────────────────────────────────────

/**
 * The document the current region belongs to.
 *
 * Exists for one reason: a block that AGGREGATES other things has to know what the
 * document already places, or it double-renders. `pluginSlot` and `headerWidgets`
 * both draw every plugin widget registered for an outlet — and each of those widgets
 * is now also its own block (`layout/slotBlocks.tsx`), so an admin who positions one
 * individually would otherwise see it twice.
 *
 * Deliberately the DOCUMENT and not just the template key: reading it from context
 * means an aggregate consults the document actually on screen, including the unsaved
 * one the editor pushes into the preview. Looking the template up by key would show
 * the saved version and disagree with what the admin is looking at.
 */
const LayoutDocumentContext = createContext<LayoutDocument | null>(null);

export const useRenderedDocument = (): LayoutDocument | null => useContext(LayoutDocumentContext);

// ── Audience ────────────────────────────────────────────────────────────────

const EMPTY_GROUPS: readonly string[] = [];

/**
 * Who is looking.
 *
 * Read straight from the store rather than through `hooks/useAuth`, which calls
 * `api.tryRefresh()` at module import — the renderer must not drag a network request
 * into every context that renders a layout, including tests.
 */
function useBlockViewer(): BlockViewer {
  const { token, user, loaded } = useSyncExternalStore(authStore.subscribe, authStore.getSnapshot);
  return {
    signedIn: !!token,
    // FULL membership, not `visibleGroups`: hiding a badge is a display choice and
    // must never change what the user can see (BUGS.md #1).
    groupIds: user?.groups.map((g) => g.id) ?? EMPTY_GROUPS,
    // The in-memory access token is absent until the refresh resolves, so until then
    // `signedIn: false` means "unknown", not "guest".
    resolved: loaded,
  };
}

/** Hoisted so the wrapper's style object is stable across renders. */
const CONTENTS = { display: "contents" } as const;

// ── Per-block error boundary ────────────────────────────────────────────────

interface BoundaryProps { blockType: string; children: ReactNode }
interface BoundaryState { failed: boolean }

class BlockBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Surfacing this is worth the console noise: a silently blank region is far
    // harder to diagnose than a logged block failure.
    console.error(`[layout] block "${this.props.blockType}" failed to render:`, error);
  }

  render() {
    if (this.state.failed) {
      return isEditorPreview()
        ? <div className="nv-block-error">Block “{this.props.blockType}” failed to render.</div>
        : null;
    }
    return this.props.children;
  }
}

// ── Node rendering ──────────────────────────────────────────────────────────

function RenderNode({
  node,
  context,
  region,
  parentId,
  viewer,
  previewAudience,
}: {
  node: BlockNode;
  context: unknown;
  /** Owning region, carried down so a nested block knows where it lives. */
  region: string;
  /** Containing block, or null at region level. */
  parentId: string | null;
  viewer: BlockViewer;
  /** Set only in the editor: the arrangement being edited. */
  previewAudience: AudienceView | null;
}) {
  const def = getBlock(node.type);

  /**
   * Audience (ADR-0005 + Amendment 2). Narrowing only — when the audience admits the
   * viewer, the block's own gate below still decides whether it shows.
   *
   * Two contexts, two questions. On the live site: does THIS PERSON see it. In the
   * editor: does the block belong to the arrangement being edited — which is
   * `audienceInView`, exactly what the tree asks, so the preview can never show
   * something the tree hid or hide something the tree showed.
   */
  const restricted = isRestricted(node.visibility);
  const hidden = previewAudience
    ? !audienceInView(node.visibility, previewAudience)
    : !isBlockVisibleTo(node.visibility, viewer);
  if (restricted && hidden) return null;

  // Rule 2 — unknown type. The node stays in the document either way, so
  // re-enabling the plugin restores it exactly where the admin put it.
  if (!def) {
    return isEditorPreview()
      ? <div className="nv-block-missing">Block “{node.type}” is unavailable.</div>
      : null;
  }

  // Props are validated on save; re-validating on read applies the schema's
  // defaults so a block never sees a half-populated props object after a schema
  // gained a field.
  const parsed = def.schema.safeParse(node.props);
  const props = parsed.success ? parsed.data : node.props;

  const Block = def.component;
  const children = node.children?.length
    ? node.children.map((child) => (
        <RenderNode
          key={child.id} node={child} context={context}
          region={region} parentId={node.id} viewer={viewer} previewAudience={previewAudience}
        />
      ))
    : undefined;

  const rendered = (
    <BlockBoundary blockType={node.type}>
      <Block props={props as never} context={context} children={children} />
    </BlockBoundary>
  );

  /**
   * Style variant (ADR-0005). The class carries a token bucket, so everything inside
   * the block resolves `--c-card`, `--surface-bg` and friends from the variant.
   *
   * `display: contents` is load-bearing: custom properties still inherit through such
   * an element, but no box is generated — so the block's own element remains the one
   * its flex or grid parent sizes. A real wrapper box here would break the navbar's
   * flex rules and every `column.width` track.
   */
  const variant = node.variant ? variantClass(node.variant) : undefined;

  /**
   * The designer's own handle rides the SAME wrapper. It is deliberately not passed
   * into the block: a class threaded through 52 components would be honoured by core
   * blocks and silently ignored by every plugin block a theme wants to skin, and the
   * uniform target is the whole point of giving custom CSS something to select.
   *
   * So the handle is styled THROUGH — `.nav-tile > *`, `.nav-tile .nv-image` — since
   * the wrapper paints nothing. Descendant and `:hover` selectors behave normally,
   * because `:hover` matches an ancestor of the hovered box whether or not that
   * ancestor generates one.
   */
  const custom = node.className?.trim() || undefined;

  /**
   * The type class, on every block, always. It is the only hook a downloaded theme has
   * for the ~50 blocks that render into their parent's markup and emit no root class of
   * their own, and the only one that works without an admin adding a handle by hand.
   *
   * Making it unconditional is also what finally makes the sentence below true: the
   * wrapper used to exist for every block in the preview but only for a STYLED block on
   * the live site, so the two DOMs differed exactly where a theme author was least
   * likely to notice — CSS written while looking at the preview could break once
   * published.
   *
   * ⚠ Selectors match the DOM, not the box tree, so this wrapper sits between a
   * container block and its children for CSS purposes even though it generates no box.
   * A stylesheet may therefore never reach across a block boundary with `>`, `+` or
   * `~`. Guarded by `classContract.test.tsx`.
   */
  const wrapperClass = [blockTypeClass(node.type), variant, custom]
    .filter(Boolean).join(' ');

  /**
   * Which end of a row this block sits at, on the wrapper so a ROW can lay it out.
   *
   * On the wrapper rather than passed to the block for the same reason `variant` and
   * `className` are: a navbar is exactly where a plugin's block wants to be
   * placeable, and a prop threaded through 52 components would be honoured by core
   * and ignored by everything else. `navbar`'s CSS reads `[data-nv-align]`.
   *
   * Absent when unset — the attribute is never written empty, so "no alignment" and
   * "aligned to the start" stay the same thing in the DOM as they are in the document.
   */
  const align = node.align ? { "data-nv-align": node.align } : {};

  // In the editor preview each block ALSO needs identity in the DOM so hovering,
  // selecting and dragging can address it — the data attributes below.
  if (!isEditorPreview()) {
    return <div className={wrapperClass} style={CONTENTS} {...align}>{rendered}</div>;
  }
  return (
    <div
      className={wrapperClass}
      data-nv-block={node.id}
      data-nv-type={node.type}
      {...align}
      // Parentage is stamped rather than derived: a container's real element sits
      // BETWEEN its wrapper and its children's wrappers, so `:scope >` finds
      // nothing and an ancestor walk has to know which elements to skip. A flat
      // `[data-nv-parent="id"]` query is exact at any depth.
      data-nv-parent={parentId ?? ""}
      data-nv-region={region}
      // Marks a legal drop parent for the bridge. Only set when the block can
      // actually hold children, so hovering a leaf resolves to its region.
      {...(def.container ? { "data-nv-container": "1" } : {})}
      // Shown in the preview even when the audience excludes the admin looking at
      // it, so the flag is how anything downstream can tell it is conditional.
      {...(restricted ? { "data-nv-restricted": node.visibility!.audience } : {})}
      style={CONTENTS}
    >
      {rendered}
    </div>
  );
}

// ── Region + document ───────────────────────────────────────────────────────

/**
 * The HTML element a region renders as.
 *
 * A region named `aside` that emits a `<div>` is a landmark the page promised and did
 * not deliver: screen-reader users navigate by landmark, and search engines read them.
 * The name already says what the thing IS, so it should be that element.
 *
 * ⚠ `main` is deliberately absent. `AppLayout` already wraps the page in
 * `<main className="app-main">`, and a document may contain exactly ONE `<main>` —
 * emitting a second here would be invalid HTML on every page of the site.
 *
 * ⚠ Chrome regions are absent too, and are already inside the right landmark:
 * `chrome.header`'s zones sit in `<header>`/`<nav>`, `chrome.footer`'s in `<footer>`.
 * Nesting a second one would be legal and meaningless.
 */
const REGION_ELEMENT: Record<string, "header" | "aside" | "footer"> = {
  header: "header",
  aside:  "aside",
  footer: "footer",
};

/**
 * "bandAbove" → "Band above". A local humanise rather than a translation lookup:
 * this renders inside the PREVIEW, which is the public site with the editor's bridge
 * injected, and the site does not load the ACP's translation namespace. Reaching for
 * one would resolve to the raw key on the one surface that shows it.
 */
function humaniseRegion(region: string): string {
  // `main` is the KEY and `<main>` is the element, but "Body" is what it is called
  // everywhere an admin sees it — the editor's tree says Body too. The key stays
  // `main` because naming it `body` would fight the element it emits.
  if (region === "main") return "Body";
  const spaced = region.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function LayoutRegion({
  document: doc,
  region,
  context,
}: {
  document: LayoutDocument;
  region: string;
  context?: unknown;
}) {
  const viewer = useBlockViewer();
  const previewAudience = usePreviewAudience();
  const nodes = doc.regions[region] ?? [];

  /**
   * An empty region is invisible on the live site and VISIBLE in the editor.
   *
   * On the site that is obviously right — an empty region must not reserve space.
   * In the editor it was the reason a masthead band could not be clicked at all:
   * the band renders nothing until it holds something, so "the header" was a thing
   * an admin could see in the tree, could not see on the page, and had nowhere to
   * click. Every empty region had the same gap; the band just made it obvious.
   *
   * The placeholder carries `data-nv-region`, so it is already a legal drop target
   * (`DROP_PARENT`), and clicking it asks the editor to open the add-block picker
   * for this region.
   */
  if (nodes.length === 0) {
    if (!isLayoutPreview()) return null;
    const Empty = REGION_ELEMENT[region] ?? "div";
    return (
      <Empty className="nv-region nv-region--empty" data-nv-region={region} data-nv-empty={region}>
        <span>{humaniseRegion(region)}</span>
      </Empty>
    );
  }
  // The region owns the content column. Without it a bare block (one not wrapped
  // in a `section`) renders edge-to-edge while the page's own container stays
  // centred — blocks would otherwise each have to carry page layout, which is
  // how a block catalogue turns into a generic web builder.
  const Tag = REGION_ELEMENT[region] ?? "div";
  return (
    <LayoutDocumentContext.Provider value={doc}>
      <Tag className={`nv-region nv-region--${region}`} data-nv-region={region}>
        {nodes.map((node) => (
          <RenderNode
            key={node.id} node={node} context={context}
            region={region} parentId={null} viewer={viewer} previewAudience={previewAudience}
          />
        ))}
      </Tag>
    </LayoutDocumentContext.Provider>
  );
}

export interface LayoutRendererProps {
  templateKey: TemplateKey;
  /** Resolved by a host container — queries, permissions and visibility already applied. */
  context?: unknown;
  /**
   * Stored document. Omit for now: step 1 renders code defaults, and the
   * published-document endpoint arrives with the storage step.
   */
  document?: unknown;
  /** Regions to render, in order. Defaults to the template's declared regions. */
  regions?: readonly string[];
}

/**
 * Renders every region of a template in order. Pages that need to interleave
 * their own markup between regions should use `LayoutRegion` directly instead.
 */
export function LayoutRenderer({ templateKey, context, document: raw, regions }: LayoutRendererProps) {
  const { document: doc } = parseLayoutDocument(templateKey, raw ?? undefined);
  /**
   * Order comes from the TEMPLATE, never from the document's key order.
   *
   * `Object.keys(doc.regions)` looks equivalent and is not: the document round-trips
   * through a Postgres `jsonb` column, which normalises object key order (by key
   * length, then bytewise). A four-region template comes back as
   * `main, aside, footer, header` — so `header` rendered LAST on every page that had
   * a stored layout. Regions are declared by the template and are not
   * admin-editable, which is exactly why the template is the authority here.
   */
  const names = regions ?? regionsFor(templateKey);
  return (
    <>
      {names.map((region) => (
        <LayoutRegion key={region} document={doc} region={region} context={context} />
      ))}
    </>
  );
}

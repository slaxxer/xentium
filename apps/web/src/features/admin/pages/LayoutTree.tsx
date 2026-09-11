/**
 * The layout editor's structure tree (ADR-0005 + nesting).
 *
 * `BlockList` and `TreeNode` are mutually recursive, and they live here rather
 * than inside `LayoutEditorPage` for a specific reason: declared in the page's
 * body they would be a NEW component type on every render, so React would unmount
 * and remount the whole tree — which destroys a drag in progress, because the
 * element being dragged ceases to exist mid-gesture.
 *
 * They are deliberately dumb. Every edit goes back to the page through `TreeCtx`,
 * which keeps the working document in one place: the tree reports intent, exactly
 * as the preview iframe does.
 */
import { Fragment, type CSSProperties, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faPlus, faTrash, faArrowUp, faArrowDown, faEyeSlash, faClone, faGripVertical,
} from "@fortawesome/free-solid-svg-icons";
import { iconFor } from "../../../layout/blockIcons";
import {
  audienceInView,
  isChromeTemplate,
  isRestricted,
  type AudienceView,
  type BlockNode,
  type TemplateKey,
} from "@nodevo/contracts";
import { getBlock } from "../../../layout/blockRegistry";

/** Where a dragged block would land. `parentId: null` is the region's own list. */
export interface DropAt { region: string; parentId: string | null; index: number }

/** What is being dragged. The type is carried so a drop target can refuse it. */
export interface DragSrc { id: string; type: string }

/** Everything the recursive rows need, bundled to avoid threading a dozen props. */
export interface TreeCtx {
  t: ReturnType<typeof useTranslation>["t"];
  templateKey: TemplateKey;
  selectedId: string | null;
  dragId: string | null;
  dropAt: DropAt | null;
  /** Which "add block" picker is open: `r:<region>` or `c:<blockId>`. */
  required: Set<string>;
  /**
   * Which audience's arrangement is being edited. Rows outside it are not rendered —
   * but their INDICES are preserved, because every move is index-based.
   */
  audience: AudienceView;
  select: (id: string) => void;
  startDrag: (node: BlockNode) => void;
  endDrag: () => void;
  hover: (e: DragEvent<HTMLElement>, at: DropAt) => void;
  drop: (e: DragEvent<HTMLElement>) => void;
  nudge: (id: string, delta: number) => void;
  remove: (id: string) => void;
  /** Copy a block and everything inside it in beside itself. */
  duplicate: (id: string) => void;
  /**
   * Open the CATALOGUE for a target — a region, or a container inside it.
   *
   * Adding used to raise a dropdown under the row, which could show a name and a
   * type and nothing else, in a 288px rail. One `+` now means one thing everywhere:
   * the dialog, which has room for a block's shape and a sentence about it.
   */
  browse: (region: string, parentId: string | null) => void;
  add: (type: string, region: string, parentId: string | null) => void;
}

/** Depth drives indentation through a CSS variable, so the maths stays in SCSS. */
export const indent = (depth: number) => ({ "--lay-depth": depth }) as CSSProperties;

/**
 * What a region is CALLED, in the one place both the tabs and the library ask.
 *
 * A page's `main` is "Body" and the chrome's is not — the key stays `main` because it
 * emits `<main>`, so the label has to be looked up per template kind. `region` is the
 * last fallback so a plugin template's own region name still reads as something.
 */
export function regionLabel(region: string, templateKey: TemplateKey, t: TreeCtx["t"]): string {
  return t(
    isChromeTemplate(templateKey)
      ? `layoutEditor.region.${region}`
      : `layoutEditor.pageRegion.${region}`,
    { defaultValue: t(`layoutEditor.region.${region}`, { defaultValue: region }) },
  ) as string;
}

export function BlockList({
  nodes, region, parentId, depth, ctx,
}: {
  nodes: BlockNode[];
  region: string;
  parentId: string | null;
  depth: number;
  ctx: TreeCtx;
}) {
  const { dropAt } = ctx;
  const line = (index: number) =>
    dropAt && dropAt.region === region && dropAt.parentId === parentId && dropAt.index === index
      ? <div className="lay__dropline" style={indent(depth)} />
      : null;

  // Rows outside the chosen audience are skipped, NOT filtered out of the array:
  // `index` and `count` go straight into `moveBlock`, so re-indexing a filtered list
  // would land every drag one slot from where it was aimed.
  const inView = nodes.map((n) => audienceInView(n.visibility, ctx.audience));
  const lastVisible = inView.lastIndexOf(true);

  if (nodes.length === 0 || lastVisible === -1) {
    return (
      <>
        {line(0)}
        <div className="lay__empty" style={indent(depth)}>
          {ctx.t(
            nodes.length === 0
              ? (parentId == null ? "layoutEditor.emptyRegion" : "layoutEditor.emptyContainer")
              : "layoutEditor.emptyForAudience",
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {nodes.map((node, i) => (inView[i] ? (
        <Fragment key={node.id}>
          {line(i)}
          <TreeNode
            node={node} region={region} parentId={parentId}
            index={i} count={nodes.length} depth={depth} ctx={ctx}
          />
          {/* After the last VISIBLE row, so the append target still has an indicator
              even when hidden rows follow it. */}
          {i === lastVisible && line(nodes.length)}
        </Fragment>
      ) : null))}
    </>
  );
}

export function TreeNode({
  node, region, parentId, index, count, depth, ctx,
}: {
  node: BlockNode;
  region: string;
  parentId: string | null;
  index: number;
  count: number;
  depth: number;
  ctx: TreeCtx;
}) {
  const def = getBlock(node.type);
  const isContainer = !!def?.container;
  const children = node.children ?? [];
  const restricted = isRestricted(node.visibility);

  return (
    <>
      <div
        className={`lay__node${ctx.selectedId === node.id ? " is-selected" : ""}`
          + `${def ? "" : " is-missing"}${ctx.dragId === node.id ? " is-dragging" : ""}`
          + `${isContainer ? " is-container" : ""}`}
        style={indent(depth)}
        // Identifies the row the way the preview identifies a block, so the tree
        // is addressable too — by a test, and by anything later that needs to
        // reveal or scroll to a specific node.
        data-block-id={node.id}
        onClick={(e) => { e.stopPropagation(); ctx.select(node.id); }}
        draggable
        onDragStart={(e) => {
          ctx.startDrag(node);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.id);
        }}
        onDragEnd={ctx.endDrag}
        onDragOver={(e) => {
          // Top half inserts before this block, bottom half after — the indicator
          // then sits exactly where the block lands.
          const box = e.currentTarget.getBoundingClientRect();
          const after = e.clientY > box.top + box.height / 2;
          ctx.hover(e, { region, parentId, index: index + (after ? 1 : 0) });
        }}
        onDrop={ctx.drop}
      >
        {/* ONE slot, two jobs. At rest it says what KIND of block this is — a tree is
            scanned rather than read, and the glyph is what makes "the image one"
            findable without parsing every label. On hover it becomes the grip, which
            is the drag's affordance: the row has been draggable all along and nothing
            said so.
            ⚠ Sharing the slot is not decoration. A separate grip cost a permanent
            16px of a 288px rail that nests three deep, and the names paid for it —
            "Your card" rendered as "Your c". Reserving the width and revealing the
            grip on hover would have shifted every row sideways under the pointer.
            The arrows stay regardless: a drag is unavailable from a keyboard. */}
        <span className="lay__node-icon" aria-hidden="true">
          <FontAwesomeIcon icon={iconFor(node.type)} className="lay__node-icon-type" />
          <FontAwesomeIcon icon={faGripVertical} className="lay__node-icon-grip" />
        </span>
        <span className="lay__node-label">
          {/* `title` because the rail is 288px and nests: a long label ellipsises,
              and the full one has to stay reachable without opening anything. */}
          <span className="lay__node-name" title={def?.editorMeta?.label ?? node.type}>
            {def?.editorMeta?.label ?? node.type}
            {!def && <em> · {ctx.t("layoutEditor.unavailable")}</em>}
          </span>
          {/* The TYPE, under the name. A label is what a block is called and a type is
              what it IS — the two diverge exactly where it matters (`forum.categories`
              is "Forum categories" until a second plugin ships one), and the type is
              also what `docs/plugin-blocks.md` and a `.nvtheme` speak in. */}
          <code className="lay__node-type">{node.type}</code>
          {/* The preview does not hide a restricted block — an admin who limited
              one to a group they are not in would otherwise lose the ability to
              select it — so the TREE is where "this is conditional" is shown. */}
          {restricted && (
            <span
              className="lay__node-restricted"
              title={ctx.t(`layoutEditor.audience.${node.visibility!.audience}`)}
            >
              <FontAwesomeIcon icon={faEyeSlash} />
            </span>
          )}
        </span>
        <span className="lay__node-actions">
          {isContainer && (
            <button type="button"
              title={ctx.t("layoutEditor.addInside")} aria-label={ctx.t("layoutEditor.addInside")}
              onClick={(e) => { e.stopPropagation(); ctx.browse(region, node.id); }}>
              <FontAwesomeIcon icon={faPlus} />
            </button>
          )}
          {/* Icon-only, so each carries its own accessible name — and `disabled`
              is bounded by the block's OWN list: a block inside a column is first
              or last among that column's children, not the region's. */}
          <button type="button" disabled={index === 0}
            title={ctx.t("layoutEditor.moveUp")} aria-label={ctx.t("layoutEditor.moveUp")}
            onClick={(e) => { e.stopPropagation(); ctx.nudge(node.id, -1); }}>
            <FontAwesomeIcon icon={faArrowUp} />
          </button>
          <button type="button" disabled={index === count - 1}
            title={ctx.t("layoutEditor.moveDown")} aria-label={ctx.t("layoutEditor.moveDown")}
            onClick={(e) => { e.stopPropagation(); ctx.nudge(node.id, 1); }}>
            <FontAwesomeIcon icon={faArrowDown} />
          </button>
          {/* Duplicating IS offered on a required block: the rule is that a template
              must never have ZERO of one, not that it may not have two — a header
              with a second nav cluster is a layout, not a broken page. */}
          <button type="button"
            title={ctx.t("layoutEditor.duplicateBlock")} aria-label={ctx.t("layoutEditor.duplicateBlock")}
            onClick={(e) => { e.stopPropagation(); ctx.duplicate(node.id); }}>
            <FontAwesomeIcon icon={faClone} />
          </button>
          {/* Required blocks may be MOVED anywhere — including into a container —
              but never removed: a header with no way into the site and no way to
              sign in is a locked door. */}
          {!ctx.required.has(node.type) && (
            <button type="button" className="lay__danger"
              title={ctx.t("layoutEditor.removeBlock")} aria-label={ctx.t("layoutEditor.removeBlock")}
              onClick={(e) => { e.stopPropagation(); ctx.remove(node.id); }}>
              <FontAwesomeIcon icon={faTrash} />
            </button>
          )}
        </span>
      </div>

      {isContainer && (
        // Its own drop target, so a drop on the container's padding appends
        // INSIDE it rather than bubbling out to the region.
        <div
          className="lay__children"
          style={indent(depth)}
          onDragOver={(e) => ctx.hover(e, { region, parentId: node.id, index: children.length })}
          onDrop={ctx.drop}
        >
          <BlockList nodes={children} region={region} parentId={node.id} depth={depth + 1} ctx={ctx} />
        </div>
      )}
    </>
  );
}

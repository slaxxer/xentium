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
import {
  Fragment, useEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus, faTrash, faArrowUp, faArrowDown, faEyeSlash, faMagnifyingGlass, faClone,
} from "@fortawesome/free-solid-svg-icons";
import {
  audienceInView,
  isRestricted,
  type AudienceView,
  type BlockNode,
  type TemplateKey,
} from "@nodevo/contracts";
import { getBlock, listPlaceableBlocks } from "../../../layout/blockRegistry";


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
  adding: string | null;
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
  toggleAdd: (key: string) => void;
  /** Close whichever picker is open, without adding — the Escape path. */
  closeAdd: () => void;
  add: (type: string, region: string, parentId: string | null) => void;
}

/** Depth drives indentation through a CSS variable, so the maths stays in SCSS. */
export const indent = (depth: number) => ({ "--lay-depth": depth }) as CSSProperties;

/**
 * Category order: the frame first, then what fills it, then where the data comes
 * from. It follows how a page gets built, which is a better ordering than the
 * alphabet for the one list an admin reads top to bottom.
 */
const CATEGORY_ORDER = ["structure", "content", "data", "plugin"] as const;

/**
 * The block picker: search, then grouped results.
 *
 * It was a flat button list, written when there were a handful of blocks; there are
 * over fifty now and a template routinely offers thirty, which is more than anyone
 * reads. The category was already on every block — it was rendered as a subtitle on
 * each row, where it did nothing but repeat itself — so grouping by it costs no new
 * metadata.
 *
 * Keyboard-first: the search field takes focus on open, ↑/↓ walk the results and
 * Enter commits, so adding a known block is type-three-letters-Enter and never
 * requires the mouse.
 */
export function BlockPicker({
  templateKey, parentType, depth, t, onPick, onClose,
}: {
  templateKey: TemplateKey;
  /** The container being added into; omitted at region level. */
  parentType?: string;
  depth: number;
  t: TreeCtx["t"];
  onPick: (type: string) => void;
  /** Escape closes the picker without adding anything. */
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Both directions of the parent/child relationship are applied by the registry,
  // so a `column` never shows up in a region and a `columns` row offers only tracks.
  const items = useMemo(
    () => listPlaceableBlocks(templateKey, parentType),
    [templateKey, parentType],
  );

  // Matched on the TYPE as well as the label: a theme author who knows a block is
  // `profileStats` should not have to work out what it is called in the UI, and the
  // type is on the row precisely so it can be searched for.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((b) =>
      b.editorMeta!.label.toLowerCase().includes(q) || b.type.toLowerCase().includes(q));
  }, [items, query]);

  /**
   * Grouped for display, each row carrying its position in the flattened list.
   *
   * The cursor indexes the flattened order, so it has to be assigned while the groups
   * are built — computing it afterwards with an `indexOf` per row would be both
   * quadratic and a second source of truth for what "next" means.
   */
  const groups = useMemo(() => {
    let i = 0;
    return CATEGORY_ORDER
      .map((category) => ({
        category,
        rows: matches
          .filter((b) => b.editorMeta!.category === category)
          // Alphabetical within a group. Registration order is an implementation
          // detail of which file imported first, which is not findable by anyone.
          .sort((a, b) => a.editorMeta!.label.localeCompare(b.editorMeta!.label))
          .map((block) => ({ block, index: i++ })),
      }))
      .filter((g) => g.rows.length > 0);
  }, [matches]);

  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  // Clamped rather than reset: narrowing the search shortens the list under the
  // cursor, and an index past the end would leave Enter committing nothing.
  const active = count === 0 ? -1 : Math.min(cursor, count - 1);

  useEffect(() => { setCursor(0); }, [query]);
  // Focused on open so the picker can be driven straight from the keyboard — the `+`
  // was clicked, which means the next act is choosing, not aiming.
  useEffect(() => { inputRef.current?.focus(); }, []);
  // Optional call: the list only scrolls once it overflows, so keeping the cursor in
  // view is an enhancement — and jsdom does not implement `scrollIntoView` at all, so
  // an unguarded call would throw in every test that opens the picker.
  useEffect(() => { activeRef.current?.scrollIntoView?.({ block: "nearest" }); }, [active]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = groups.flatMap((g) => g.rows).find((r) => r.index === active);
      if (row) onPick(row.block.type);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (count === 0) return;
      // Wraps: the list is short, and a cursor that stops dead at either end costs
      // more keystrokes than it saves.
      setCursor((c) => (Math.min(c, count - 1) + (e.key === "ArrowDown" ? 1 : -1) + count) % count);
    }
  };

  return (
    <div className="lay__picker" style={indent(depth)}>
      <div className="lay__picker-search">
        <FontAwesomeIcon icon={faMagnifyingGlass} />
        <input
          ref={inputRef}
          className="acp-input"
          type="text"
          value={query}
          placeholder={t("layoutEditor.searchBlocks")}
          aria-label={t("layoutEditor.searchBlocks")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="lay__picker-list">
        {/* Two different emptinesses: nothing may be placed here at all, or nothing
            matches what was typed. Saying "no blocks available" to someone with a
            typo in the search box would send them looking for the wrong problem. */}
        {items.length === 0 && <div className="acp-hint">{t("layoutEditor.noBlocks")}</div>}
        {items.length > 0 && count === 0 && (
          <div className="acp-hint">{t("layoutEditor.noMatches", { query: query.trim() })}</div>
        )}

        {groups.map(({ category, rows }) => (
          <div className="lay__picker-group" key={category}>
            <div className="lay__picker-group-title">{t(`layoutEditor.category.${category}`)}</div>
            {rows.map(({ block, index }) => (
              <button
                key={block.type}
                ref={index === active ? activeRef : undefined}
                type="button"
                className={`lay__picker-item${index === active ? " is-active" : ""}`}
                // The pointer moves the cursor too, so Enter always commits the row
                // being looked at rather than one the keyboard left behind.
                onMouseEnter={() => setCursor(index)}
                onClick={() => onPick(block.type)}
              >
                <b>{block.editorMeta!.label}</b>
                {/* The category used to sit here and now names the group instead, so
                    the slot shows something that varies per row: which plugin
                    contributed the block, or the type the search also matches. */}
                <span>{block.pluginId ?? block.type}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
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
  const addKey = `c:${node.id}`;
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
        <span className="lay__node-label">
          {def?.editorMeta?.label ?? node.type}
          {!def && <em> · {ctx.t("layoutEditor.unavailable")}</em>}
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
              onClick={(e) => { e.stopPropagation(); ctx.toggleAdd(addKey); }}>
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

      {ctx.adding === addKey && (
        <BlockPicker
          templateKey={ctx.templateKey} parentType={node.type} depth={depth + 1} t={ctx.t}
          onPick={(type) => ctx.add(type, region, node.id)}
          onClose={ctx.closeAdd}
        />
      )}

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

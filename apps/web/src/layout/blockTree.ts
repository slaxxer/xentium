/**
 * Block tree operations (ADR-0005, step 4 + nesting).
 *
 * Every edit the layout editor makes is one of these, and they live apart from
 * the editor because this is where the bugs are: index arithmetic and recursive
 * walks typecheck, lint and build cleanly while silently dropping a block one
 * slot from where the admin aimed, or nesting a container inside itself.
 *
 * Two rules hold throughout:
 *
 *  - **Addressing is by id.** A block is reached by id, never by an index path.
 *    Ids are already stable across reordering and are already what the preview
 *    iframe reports back, so one lookup serves the tree, the preview and the
 *    keyboard buttons. An index path would have to be recomputed after every
 *    edit and would be wrong the moment two edits raced.
 *  - **Everything is pure.** Each function returns a new `Regions`; the input is
 *    never mutated. An operation that cannot be applied returns the ORIGINAL
 *    object by reference, so a caller can cheaply tell "nothing happened" and a
 *    stale drag becomes a no-op rather than a corruption.
 */
import {
  MAX_BLOCK_DEPTH,
  type BlockNode,
  type BlockVariant,
  type BlockVisibility,
} from "@nodevo/contracts";

export type Regions = Record<string, BlockNode[]>;

/** Where a block should end up. `parentId: null` means the region's own list. */
export interface DropTarget {
  region: string;
  /** A container block's id, or null/undefined for region level. */
  parentId?: string | null;
  /** Index in the destination list, as the admin sees it before the move. */
  index: number;
}

export interface NodeLocation {
  node: BlockNode;
  region: string;
  parentId: string | null;
  index: number;
  /** 1 for a block sitting directly in a region. */
  depth: number;
  /** Siblings, including the node itself — a live reference into the tree. */
  list: BlockNode[];
}

// ── Lookup ──────────────────────────────────────────────────────────────────

function walk(
  list: BlockNode[],
  id: string,
  region: string,
  parentId: string | null,
  depth: number,
): NodeLocation | null {
  for (let i = 0; i < list.length; i++) {
    const node = list[i]!;
    if (node.id === id) return { node, region, parentId, index: i, depth, list };
    if (node.children?.length) {
      const hit = walk(node.children, id, region, node.id, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Locate a block anywhere in the document. `list` points INTO `regions`. */
export function findNode(regions: Regions, id: string): NodeLocation | null {
  for (const [region, nodes] of Object.entries(regions)) {
    const hit = walk(nodes, id, region, null, 1);
    if (hit) return hit;
  }
  return null;
}

/** Levels in the subtree rooted at `node`, counting `node` itself as one. */
export function subtreeHeight(node: BlockNode): number {
  if (!node.children?.length) return 1;
  let deepest = 0;
  for (const child of node.children) deepest = Math.max(deepest, subtreeHeight(child));
  return 1 + deepest;
}

/** True if `id` is `node` or sits anywhere beneath it. */
export function containsId(node: BlockNode, id: string): boolean {
  if (node.id === id) return true;
  return (node.children ?? []).some((child) => containsId(child, id));
}

/** Every id in the document — the editor uses it to mint one that cannot collide. */
/**
 * A block id nothing in the document is using.
 *
 * `taken` is MUTATED, so a caller minting several ids in one pass (cloning a subtree)
 * cannot hand out the same one twice. Collisions are astronomically unlikely but not
 * impossible, and a duplicate id silently makes selection and every subsequent move
 * act on whichever node comes first — the bug class this module exists to prevent.
 */
export function newBlockId(taken: Set<string>): string {
  let id = `b${Math.random().toString(36).slice(2, 10)}`;
  while (taken.has(id)) id = `b${Math.random().toString(36).slice(2, 10)}`;
  taken.add(id);
  return id;
}

/**
 * A deep copy of a block, every node in it given a fresh id.
 *
 * `structuredClone` rather than a spread: a spread shares nested prop objects and the
 * `visibility.groups` array between the original and the copy, so editing one would
 * silently edit the other. Props are coarse by design, but "by design" is not the same
 * as "enforced", and this is not the place to depend on it.
 */
export function cloneBlock(node: BlockNode, taken: Set<string>): BlockNode {
  const copy = structuredClone(node) as BlockNode;
  const reid = (n: BlockNode) => {
    n.id = newBlockId(taken);
    for (const child of n.children ?? []) reid(child);
  };
  reid(copy);
  return copy;
}

export function collectIds(regions: Regions): Set<string> {
  const out = new Set<string>();
  const visit = (nodes: BlockNode[]) => {
    for (const n of nodes) {
      out.add(n.id);
      if (n.children?.length) visit(n.children);
    }
  };
  for (const nodes of Object.values(regions)) visit(nodes);
  return out;
}

// ── Internals ───────────────────────────────────────────────────────────────

/**
 * The list a target names, created on demand.
 *
 * A region absent from the document is normal (an untouched region has no key)
 * and a container that has never held anything has no `children`, so both are
 * materialised here rather than being treated as failures. Returns null only when
 * the named parent does not exist at all — a stale drag.
 */
function resolveList(regions: Regions, target: DropTarget): BlockNode[] | null {
  if (target.parentId == null) {
    regions[target.region] ??= [];
    return regions[target.region]!;
  }
  const parent = findNode(regions, target.parentId);
  if (!parent) return null;
  parent.node.children ??= [];
  return parent.node.children;
}

/**
 * Drop `children: []` left behind by a move or a delete.
 *
 * An empty array and an absent one render identically, so keeping both shapes
 * around would make two equal documents compare as different — and draft-vs-live
 * "pending" status is a `JSON.stringify` comparison, which would then report a
 * change after an edit that undid itself.
 */
function prune(nodes: BlockNode[]): void {
  for (const node of nodes) {
    if (!node.children) continue;
    if (node.children.length === 0) delete node.children;
    else prune(node.children);
  }
}

const clone = (regions: Regions): Regions => structuredClone(regions);

function finish(regions: Regions): Regions {
  for (const nodes of Object.values(regions)) prune(nodes);
  return regions;
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Move a block to a new position, possibly into or out of a container.
 *
 * `target.index` is expressed against the destination list as the admin sees it —
 * before the block is lifted out. Within one list, removing it first shifts
 * everything after it down by one, so a downward move has to compensate; without
 * that, a block dragged to the bottom lands second-to-last.
 *
 * Refused (returning `regions` unchanged) when the move would:
 *  - reference a block or parent that is not there — a stale drag,
 *  - put a container inside itself or inside its own descendant, which builds a
 *    cycle that renders until the stack runs out,
 *  - push the moved subtree past `maxDepth`. The moved node carries its children,
 *    so the check is against the subtree's HEIGHT, not the node alone.
 */
export function moveBlock(
  regions: Regions,
  id: string,
  target: DropTarget,
  opts: { maxDepth?: number } = {},
): Regions {
  const maxDepth = opts.maxDepth ?? MAX_BLOCK_DEPTH;

  const found = findNode(regions, id);
  if (!found) return regions;
  if (target.parentId != null && containsId(found.node, target.parentId)) return regions;

  const parentDepth = target.parentId == null ? 0 : findNode(regions, target.parentId)?.depth ?? -1;
  if (parentDepth < 0) return regions;
  if (parentDepth + subtreeHeight(found.node) > maxDepth) return regions;

  const next = clone(regions);
  const src = findNode(next, id)!;
  // Resolved BEFORE the removal: when the destination is the source's own list
  // this must be the same array, and when it is a container's `children` the
  // lookup has to happen while the tree is still intact.
  const dest = resolveList(next, target);
  if (!dest) return regions;

  const sameList = dest === src.list;
  src.list.splice(src.index, 1);
  const insertAt = sameList && src.index < target.index ? target.index - 1 : target.index;
  dest.splice(Math.max(0, Math.min(insertAt, dest.length)), 0, src.node);

  return finish(next);
}

/**
 * Add a new block at a target position.
 *
 * Refuses for the same depth reason as a move: a seeded container (a `columns`
 * arriving with its `column` children) is more than one level tall.
 */
export function insertBlock(
  regions: Regions,
  node: BlockNode,
  target: DropTarget,
  opts: { maxDepth?: number } = {},
): Regions {
  const maxDepth = opts.maxDepth ?? MAX_BLOCK_DEPTH;
  const parentDepth = target.parentId == null ? 0 : findNode(regions, target.parentId)?.depth ?? -1;
  if (parentDepth < 0) return regions;
  if (parentDepth + subtreeHeight(node) > maxDepth) return regions;

  const next = clone(regions);
  const dest = resolveList(next, target);
  if (!dest) return regions;
  dest.splice(Math.max(0, Math.min(target.index, dest.length)), 0, node);
  return finish(next);
}

/** Remove a block and everything nested inside it. */
export function removeBlock(regions: Regions, id: string): Regions {
  const found = findNode(regions, id);
  if (!found) return regions;

  const next = clone(regions);
  const src = findNode(next, id)!;
  src.list.splice(src.index, 1);
  return finish(next);
}

/** Replace one block's props, at any depth. */
export function updateBlockProps(
  regions: Regions,
  id: string,
  props: Record<string, unknown>,
): Regions {
  if (!findNode(regions, id)) return regions;
  const next = clone(regions);
  findNode(next, id)!.node.props = props;
  return next;
}

/**
 * Set or clear a block's audience.
 *
 * A rule that restricts nobody is DELETED rather than stored as
 * `{ audience: 'everyone' }`. Absent and default mean the same thing to the
 * renderer, so keeping both shapes would make two identical layouts compare
 * unequal — and draft-vs-live "pending" status is a `JSON.stringify`, so setting a
 * restriction and removing it again would leave the draft looking changed forever.
 */
export function updateBlockVisibility(
  regions: Regions,
  id: string,
  visibility: BlockVisibility | undefined,
): Regions {
  if (!findNode(regions, id)) return regions;
  const next = clone(regions);
  const { node } = findNode(next, id)!;
  if (!visibility || visibility.audience === "everyone") delete node.visibility;
  else node.visibility = visibility;
  return next;
}

/**
 * Set or clear a block's style variant.
 *
 * Same rule as the audience above: "no variant" is the ABSENCE of the field, never a
 * stored default. Draft-vs-live pending status is a `JSON.stringify` comparison, so
 * applying a variant and taking it off again has to leave the document byte-identical.
 */
export function updateBlockVariant(
  regions: Regions,
  id: string,
  variant: BlockVariant | undefined,
): Regions {
  if (!findNode(regions, id)) return regions;
  const next = clone(regions);
  const { node } = findNode(next, id)!;
  if (!variant) delete node.variant;
  else node.variant = variant;
  return next;
}

/**
 * Whether a block may be dropped into a container, ignoring what the container
 * accepts — that part is the registry's call, not the tree's.
 *
 * Exposed so the editor can decide which drop targets to OFFER, rather than
 * letting an admin aim at one that the move would then silently refuse.
 */
export function canNestInto(
  regions: Regions,
  id: string,
  parentId: string | null,
  opts: { maxDepth?: number } = {},
): boolean {
  const maxDepth = opts.maxDepth ?? MAX_BLOCK_DEPTH;
  const found = findNode(regions, id);
  if (!found) return false;
  if (parentId == null) return subtreeHeight(found.node) <= maxDepth;
  if (containsId(found.node, parentId)) return false;
  const parent = findNode(regions, parentId);
  if (!parent) return false;
  return parent.depth + subtreeHeight(found.node) <= maxDepth;
}

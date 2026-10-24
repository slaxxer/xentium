/**
 * The sections model (ADR-0012): how the editor TEACHES a page, over the same
 * document the renderer has always read.
 *
 * A page is a stack of sections; a section has columns; a column has blocks. Two
 * levels and no more, so an admin never has to assemble a two-column band out of
 * three container blocks in the right order. Nothing here changes what is stored:
 *
 *   section ─ blocks                       one column
 *   section ─ columns ─ column ─ blocks    two or three
 *
 * A top-level `columns` row (how the home and members pages ship) is a section in
 * its own right, and a top-level leaf is a full-width block. Anything else at the top
 * — a plugin container, the guest landing's surface — is a GROUP: rendered, movable as
 * a whole, edited through the Outline, never flattened behind the admin's back.
 *
 * Pure functions over `Regions`, like `blockTree`: they return the input unchanged
 * when they refuse, so the editor's "did anything happen" check is a reference compare.
 */
import type { BlockNode, BlockVariant } from "@xentium/contracts";
import { collectIds, findNode, newBlockId, type Regions } from "./blockTree";

// ── Column layouts ──────────────────────────────────────────────────────────

export const SECTION_LAYOUTS = {
  one:    ["1"],
  half:   ["1", "1"],
  twoOne: ["2", "1"],
  oneTwo: ["1", "2"],
  three:  ["1", "1", "1"],
} as const satisfies Record<string, readonly ("1" | "2")[]>;

export type SectionLayout = keyof typeof SECTION_LAYOUTS;
export const SECTION_LAYOUT_KEYS = Object.keys(SECTION_LAYOUTS) as SectionLayout[];

/** What a top-level node IS to the editor. */
export type SectionKind = "section" | "columns" | "block" | "group";

/** Only meaningful for a node at the top of a region. */
export function sectionKind(node: BlockNode, isContainer: (type: string) => boolean): SectionKind {
  if (node.type === "section") return "section";
  if (node.type === "columns") return "columns";
  return isContainer(node.type) ? "group" : "block";
}

/** The `columns` row a section shows its tracks through, if it has exactly that shape. */
function rowOf(node: BlockNode): BlockNode | null {
  if (node.type === "columns") return node;
  if (node.type === "section" && node.children?.length === 1 && node.children[0]!.type === "columns") {
    return node.children[0]!;
  }
  return null;
}

/**
 * Which of the five shapes a section is in, or null for one the picker cannot name
 * (an `auto` or rail-width track, four tracks). A null still renders and stays
 * editable; the picker just shows no shape as chosen.
 */
export function sectionLayoutOf(node: BlockNode): SectionLayout | null {
  const row = rowOf(node);
  if (!row) return node.type === "section" ? "one" : null;
  const widths = (row.children ?? []).map((c) => (c.type === "column" ? String(c.props.width ?? "1") : "?"));
  for (const key of SECTION_LAYOUT_KEYS) {
    const want = SECTION_LAYOUTS[key];
    if (want.length === widths.length && want.every((w, i) => w === widths[i])) return key;
  }
  return null;
}

/**
 * Give a section (or a top-level `columns` row) one of the five shapes.
 *
 * ⚠ Blocks are NEVER dropped: going from three columns to two moves the third
 * column's blocks to the end of the second, and to one stacks them all. Existing
 * column nodes keep their ids and other props (`sticky`), so an undo or a theme
 * comparison sees the same tracks re-weighted rather than new ones.
 */
export function setSectionLayout(regions: Regions, id: string, layout: SectionLayout): Regions {
  const at = findNode(regions, id);
  if (!at || (at.node.type !== "section" && at.node.type !== "columns")) return regions;
  if (sectionLayoutOf(at.node) === layout) return regions;

  const next = structuredClone(regions);
  const node = findNode(next, id)!.node;
  const taken = collectIds(next);

  const row = rowOf(node);
  const oldColumns = row ? (row.children ?? []).filter((c) => c.type === "column") : [];
  const lanes: BlockNode[][] = row ? oldColumns.map((c) => c.children ?? []) : [node.children ?? []];

  const weights = SECTION_LAYOUTS[layout];
  const want = weights.length;
  const nextLanes: BlockNode[][] = Array.from({ length: want }, (_, i) => [...(lanes[i] ?? [])]);
  for (let i = want; i < lanes.length; i++) nextLanes[want - 1]!.push(...lanes[i]!);

  const tracks = nextLanes.map((children, i): BlockNode => {
    const old = oldColumns[i];
    const col: BlockNode = old
      ? { ...old, props: { ...old.props, width: weights[i] } }
      : { id: newBlockId(taken), type: "column", props: { width: weights[i], sticky: false } };
    if (children.length) col.children = children; else delete col.children;
    return col;
  });

  if (node.type === "columns") {
    // A bare row stays a row: it is a section only to the editor, and wrapping it in
    // a `section` would change what a theme comparison sees for no visible reason.
    node.children = tracks;
  } else if (want === 1) {
    const only = nextLanes[0]!;
    if (only.length) node.children = only; else delete node.children;
  } else {
    const keep = row && row !== node ? row : null;
    const cols: BlockNode = keep
      ? { ...keep, children: tracks }
      : { id: newBlockId(taken), type: "columns", props: { gap: "md" }, children: tracks };
    node.children = [cols];
  }
  return next;
}

/**
 * The lists blocks are dropped into, for one section: its columns, or the section
 * itself when it has one. Empty for a group or a leaf.
 */
export function sectionLanes(node: BlockNode): BlockNode[] {
  const row = rowOf(node);
  if (row) return (row.children ?? []).filter((c) => c.type === "column");
  return node.type === "section" ? [node] : [];
}

// ── Ready-made sections ─────────────────────────────────────────────────────

export const SECTION_PRESETS = ["hero", "features", "textBlock", "callToAction", "emptyOne", "emptyTwo"] as const;
export type SectionPreset = (typeof SECTION_PRESETS)[number];

/** The shape each preset shows in the library tile. */
export const PRESET_LAYOUT: Record<SectionPreset, SectionLayout> = {
  hero: "half", features: "three", textBlock: "one", callToAction: "one", emptyOne: "one", emptyTwo: "half",
};

/** The words a preset starts with, in the admin's language at the moment it is added. */
export interface PresetText {
  eyebrow: string;
  title: string;
  body: string;
  featureTitle: string;
  featureBody: string;
  ctaTitle: string;
  ctaBody: string;
}

const paragraph = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/**
 * A preset as a fresh subtree, with ids not already in `taken`.
 *
 * The text is a LITERAL in the admin's language, exactly what they would have typed:
 * it is content for this site, not a translation core owns. Double-click replaces it.
 */
export function buildPreset(preset: SectionPreset, words: PresetText, taken: Set<string>): BlockNode {
  const id = () => newBlockId(taken);
  const block = (type: string, props: Record<string, unknown>, children?: BlockNode[]): BlockNode =>
    children ? { id: id(), type, props, children } : { id: id(), type, props };
  const section = (props: Record<string, unknown>, children: BlockNode[], variant?: BlockVariant): BlockNode => {
    const s = block("section", { width: "normal", padding: "lg", ...props }, children.length ? children : undefined);
    if (variant) s.variant = variant;
    return s;
  };
  const row = (lanes: BlockNode[][], weights: readonly string[]): BlockNode =>
    block("columns", { gap: "md" }, lanes.map((kids, i) =>
      block("column", { width: weights[i] ?? "1", sticky: false }, kids.length ? kids : undefined)));
  const heading = (text: string, level: 1 | 2 | 3, align: "start" | "center" = "start") =>
    block("heading", { text, level, align });
  const text = (body: string) => block("richText", { content: paragraph(body) });

  switch (preset) {
    case "hero":
      return section({}, [row([
        [block("eyebrow", { text: words.eyebrow, align: "start" }), heading(words.title, 1), text(words.body)],
        [block("image", { source: "", ratio: "4:3" })],
      ], SECTION_LAYOUTS.half)]);
    case "features":
      return section({}, [row([0, 1, 2].map(() => [heading(words.featureTitle, 3), text(words.featureBody)]), SECTION_LAYOUTS.three)]);
    case "textBlock":
      return section({}, [heading(words.title, 2), text(words.body)]);
    case "callToAction":
      return section({ width: "wide" }, [heading(words.ctaTitle, 2, "center"), text(words.ctaBody)], "accent");
    case "emptyOne":
      return section({}, []);
    case "emptyTwo":
      return section({}, [row([[], []], SECTION_LAYOUTS.half)]);
  }
}

// ── What publishing would change ────────────────────────────────────────────

/** A live block the draft no longer has, and where it was, so it can be put back. */
export interface RemovedBlock {
  node: BlockNode;
  region: string;
  parentId: string | null;
  index: number;
}

export interface LayoutChanges {
  /** Blocks that are new (the outermost of a new subtree), edited, or moved somewhere else. */
  changed: Set<string>;
  /** Blocks that are live but gone from the draft: the outermost of each removed subtree. */
  removed: RemovedBlock[];
}

interface Placed { node: BlockNode; parent: string; region: string; index: number }

function placements(regions: Regions): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const visit = (nodes: BlockNode[], parent: string, region: string) => {
    nodes.forEach((n, index) => {
      out.set(n.id, { node: n, parent, region, index });
      if (n.children?.length) visit(n.children, `b:${n.id}`, region);
    });
  };
  for (const [region, nodes] of Object.entries(regions)) visit(nodes ?? [], `r:${region}`, region);
  return out;
}

/** A node's own settings, without its children: an edit inside a section is not the section's. */
const ownJson = (n: BlockNode) => { const { children: _c, ...own } = n; return JSON.stringify(own); };

/** Indices of the longest increasing run: the blocks that kept their relative order. */
function longestIncreasing(seq: number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (seq[tails[mid]!]! < seq[i]!) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let k = tails.length ? tails[tails.length - 1]! : -1; k >= 0; k = prev[k]!) keep.add(k);
  return keep;
}

/**
 * Compare the draft against what is live, block by block.
 *
 * "Moved" is judged by RELATIVE order within a list, not by index: adding one block
 * at the top shifts every index below it, and marking all of those as changed would
 * bury the one change that happened.
 */
export function layoutChanges(draft: Regions, live: Regions): LayoutChanges {
  const now = placements(draft);
  const before = placements(live);
  const changed = new Set<string>();

  // A new section arrives with its columns and blocks; it is ONE change, marked once.
  const added = new Set([...now.keys()].filter((id) => !before.has(id)));
  const insideNew = (parent: string) => parent.startsWith("b:") && added.has(parent.slice(2));
  for (const [id, at] of now) {
    const was = before.get(id);
    if (!was) { if (!insideNew(at.parent)) changed.add(id); continue; }
    if (was.parent !== at.parent || ownJson(was.node) !== ownJson(at.node)) changed.add(id);
  }

  // Reordered within the same list: whatever is outside the longest run that kept its order.
  const lists = new Map<string, string[]>();
  for (const [id, at] of now) {
    const was = before.get(id);
    if (was && was.parent === at.parent) (lists.get(at.parent) ?? lists.set(at.parent, []).get(at.parent)!).push(id);
  }
  const liveIndex = new Map<string, number>();
  const indexOf = (nodes: BlockNode[]) => nodes.forEach((n, i) => { liveIndex.set(n.id, i); if (n.children) indexOf(n.children); });
  Object.values(live).forEach((ns) => indexOf(ns ?? []));
  for (const ids of lists.values()) {
    const keep = longestIncreasing(ids.map((id) => liveIndex.get(id)!));
    ids.forEach((id, i) => { if (!keep.has(i)) changed.add(id); });
  }

  const removed: RemovedBlock[] = [];
  for (const [id, was] of before) {
    if (now.has(id)) continue;
    const parentId = was.parent.startsWith("b:") ? was.parent.slice(2) : null;
    // Inside something that was removed as a whole: putting the parent back brings it.
    if (parentId && !now.has(parentId)) continue;
    removed.push({ node: was.node, region: was.region, parentId, index: was.index });
  }
  return { changed, removed };
}

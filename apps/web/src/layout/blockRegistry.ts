/**
 * Block registry (ADR-0005).
 *
 * Maps a `BlockNode.type` to the component that renders it. Mirrors
 * `plugins/slotRegistry.ts` deliberately: plugins register blocks the same way
 * they register slots, and this module is exposed through `host-globals` and the
 * plugin SDK from day one — retrofitting a registry into a public API later is
 * expensive, building it that way now costs nothing.
 *
 * Blocks RENDER; the host FETCHES. A block receives its typed props plus the
 * template's context, which a host container has already resolved — including
 * the permission and visibility checks. A block that queries on its own would
 * move access control into theme-authored configuration.
 */
import type { ComponentType } from "react";
import type { ZodType } from "zod";

/** What every block component receives. `context` is typed per template. */
export interface BlockProps<P = Record<string, unknown>, C = unknown> {
  props: P;
  context: C;
  /** Present so a block can render its own children (containers only). */
  children?: React.ReactNode;
}

export interface BlockDefinition<P = any, C = any> {
  /** Registry key. Core blocks are bare (`heading`); plugin blocks are namespaced. */
  type: string;
  /**
   * Owning plugin. Set it and disabling the plugin removes the block; omit it
   * for core blocks. Ownership is explicit rather than derived from the type
   * prefix because a plugin id (`nodevo-forum`) and its namespace (`forum.`)
   * are not the same string.
   */
  pluginId?: string;
  /** Prop contract. Validated on save AND used to generate the editor form. */
  schema: ZodType<P>;
  component: ComponentType<BlockProps<P, C>>;
  /** True for `section` / `columns` / `column` — the editor allows nesting into these. */
  container?: boolean;
  /**
   * Child types a container accepts. Omit to accept anything placeable.
   *
   * `columns` uses it to accept only `column`, so a bare block can never land
   * where a track belongs. A plugin container gets the same restriction for free.
   */
  childTypes?: string[];
  /** Editor-facing metadata. Absent for blocks that exist but aren't user-placeable. */
  editorMeta?: {
    label: string;
    category: "structure" | "content" | "data" | "plugin";
    /** Restrict to templates whose context this block needs. Omit = any. */
    allowedTemplates?: string[];
    /**
     * Container types this block may be placed inside. Omit to allow both region
     * level and any container.
     *
     * The counterpart to `childTypes`, and the reason `column` never shows up in a
     * region's block picker: a track outside its row has nothing to occupy.
     */
    onlyInside?: string[];
    /**
     * "Designed for the body's width" — a whole page-width layout in itself.
     *
     * ADVISORY, never a rule. The picker says so when the block is being added to
     * the rail (or a narrow track) and then adds it anyway if that is what the admin
     * wants: a `section` in a rail is a perfectly good way to give it a background,
     * and the one thing worse than a cramped block is an editor that refuses a
     * layout its own renderer can draw. Marking is what a rule would have got wrong.
     */
    wide?: boolean;
  };
}

const blocks = new Map<string, BlockDefinition>();

export function registerBlock<P, C>(def: BlockDefinition<P, C>): void {
  blocks.set(def.type, def as BlockDefinition);
}

export function deregisterBlock(type: string): void {
  blocks.delete(type);
}

/**
 * Drop every block a plugin registered — mirrors `slotRegistry.deregister`.
 *
 * Documents that reference the removed types are NOT touched: the renderer skips
 * an unknown block and keeps it in place, so re-enabling the plugin restores it
 * exactly where the admin put it. Disabling a plugin must never silently edit a
 * layout somebody built.
 */
export function deregisterBlocksFor(pluginId: string): void {
  for (const [type, def] of blocks) {
    if (def.pluginId === pluginId) blocks.delete(type);
  }
}

export function getBlock(type: string): BlockDefinition | undefined {
  return blocks.get(type);
}

export function listBlocks(): BlockDefinition[] {
  return [...blocks.values()];
}

/**
 * Placeable blocks for the editor's block picker.
 *
 * `parentType` is the container being added into, or undefined for region level.
 * Both directions of the relationship are consulted — what the child will sit
 * inside (`onlyInside`) and what the parent accepts (`childTypes`) — so a picker
 * never offers a drop the tree would then refuse.
 */
export function listPlaceableBlocks(templateKey: string, parentType?: string): BlockDefinition[] {
  const parent = parentType ? blocks.get(parentType) : undefined;
  return listBlocks().filter((b) => {
    const meta = b.editorMeta;
    if (!meta) return false;
    if (meta.allowedTemplates && !meta.allowedTemplates.includes(templateKey)) return false;
    if (parentType) {
      if (!parent?.container) return false;
      if (parent.childTypes && !parent.childTypes.includes(b.type)) return false;
      if (meta.onlyInside && !meta.onlyInside.includes(parentType)) return false;
    } else if (meta.onlyInside) {
      return false; // needs a container; a region is not one
    }
    return true;
  });
}

/** Whether a container accepts a given child type — the drag-time counterpart. */
export function acceptsChild(parentType: string | null, childType: string): boolean {
  const child = blocks.get(childType);
  if (parentType == null) return !child?.editorMeta?.onlyInside;
  const parent = blocks.get(parentType);
  if (!parent?.container) return false;
  if (parent.childTypes && !parent.childTypes.includes(childType)) return false;
  const only = child?.editorMeta?.onlyInside;
  return !only || only.includes(parentType);
}

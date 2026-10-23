/**
 * Edge-art registry: the shapes an edge can be drawn in, and the plugin extensions
 * that draw more than a shape.
 *
 * Core's own shapes are registered through the same `registerEdgeShape` a plugin uses
 * (see `edgeArt.tsx`), exactly as core templates seed the template registry — one path,
 * so a plugin shape is never a second-class citizen in the renderer or the editor.
 *
 * Exposed to plugins as `window.__XENTIUM_HOST__.webEdgeRegistry`. A plugin must
 * externalize `@web/layout/edgeRegistry` and `@web/layout/edgeArt`: a bundled copy
 * would register into a Map nothing reads. Authoring: `docs/plugin-edge-art.md`.
 */
import type { ComponentType, ReactNode } from "react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { CORE_EDGE_SHAPES, PLUGIN_EDGE_SHAPE, type EdgeArt } from "@xentium/contracts";

/**
 * One unit of a repeating shape, drawn RIGHT TO LEFT from `(x, base)` to `(x - w, base)`
 * as SVG path commands. `i` is the unit's index, so a unit that varies does so the same
 * way every time it comes round — which is what lets a band loop without a seam.
 */
export interface EdgeUnit {
  /** The band's depth the units hang from, for a band `H` tall. */
  base: (H: number) => number;
  unit: (x: number, w: number, H: number, i: number) => string;
}

export interface EdgeShapeDef {
  /** Core: a bare name. Plugin: `<namespace>.<name>`. */
  id: string;
  /** Set by a plugin, so `deregisterEdgeFor` can find what it added. */
  pluginId?: string;
  /** i18n key for the editor's tile (a plugin uses its own namespace, `ns:key`). */
  labelKey: string;
  /**
   * How it is drawn — exactly one of:
   * - `unit`: a repeating unit; the admin picks how many fit across (`count`).
   * - `path`: one outline filling a `W`×`H` band from its top edge down.
   */
  unit?: EdgeUnit;
  path?: (W: number, H: number) => string;
  /** Repeating shapes: units across when `count` is absent. */
  defaultCount?: number;
  /**
   * A band of it can slide sideways without a seam. True for any `unit` shape whose
   * units depend only on their index (draw it twice over with `period`); a `path` has
   * no unit to repeat.
   */
  seamless?: boolean;
  /** The editor's tile shows this icon instead of a miniature of the shape. */
  icon?: IconDefinition;
  /**
   * What a site WITHOUT this plugin draws instead. The editor stores it on the edge when
   * the admin picks the shape, so a theme carrying it degrades on purpose.
   */
  fallback?: EdgeArt["fallback"];
}

/** What a plugin's inspector section is handed. */
export interface EdgeInspectorProps {
  /** The edge on the side being edited; absent when that side has none yet. */
  edge: EdgeArt | undefined;
  /** This extension's own settings (`edge.ext[namespace]`), unparsed. */
  ext: unknown;
  /** Replace this extension's settings; `undefined` removes them. */
  setExt: (next: Record<string, unknown> | undefined) => void;
  /** Replace the whole edge — for presets. `undefined` removes it. */
  write: (next: EdgeArt | undefined) => void;
}

export interface EdgeExtension {
  /** The key it owns under `edge.ext`. */
  namespace: string;
  pluginId: string;
  /**
   * Draw the edge yourself. Return `null` to leave it to core (or the next extension).
   * `drawCore()` is core's own drawing, to wrap or to draw beside. Anything drawn
   * BESIDE the box (not inside it) must carry the class `xt-edge-layer`, so host blocks
   * leave its positioning alone.
   */
  render?: (args: {
    edge: EdgeArt; side: "top" | "bottom"; ext: unknown; drawCore: () => ReactNode;
    /** The moment to draw for: the visitor's clock, or the date and hour the editor previews. */
    now: Date;
  }) => ReactNode | null;
  /**
   * Whether these settings change with the time of day. When any edge in the open
   * document says yes, the editor offers "Viewing at" to preview other hours.
   */
  usesTime?: (ext: unknown) => boolean;
  /**
   * Whether the edge draws at all at `now`; `false` hides it as if it were not there
   * (no box, no room kept for it). Absent = always. Every extension must agree.
   */
  shows?: (args: { edge: EdgeArt; ext: unknown; now: Date }) => boolean;
  /**
   * A day, as `MM-DD`, worth previewing these settings on — for art that shows only
   * part of the year. When any edge in the open document names one, the editor offers
   * "Viewing on" with it.
   */
  viewDate?: (ext: unknown) => string | null;
  /** Above the shape picker; shown even when the side has no edge yet (presets). */
  InspectorTop?: ComponentType<EdgeInspectorProps>;
  /** Below the core settings, when the side has an edge. */
  Inspector?: ComponentType<EdgeInspectorProps>;
}

const shapes = new Map<string, EdgeShapeDef>();
const extensions = new Map<string, EdgeExtension>();

const isCore = (id: string) => (CORE_EDGE_SHAPES as readonly string[]).includes(id);

/**
 * Register a shape. THROWS on a bad or taken id, like `registerTemplate`: a plugin that
 * half-registers is worse than one that fails its enable loudly.
 */
export function registerEdgeShape(def: EdgeShapeDef): void {
  if (def.pluginId) {
    if (!PLUGIN_EDGE_SHAPE.test(def.id)) throw new Error(`Edge shape "${def.id}" must be "<namespace>.<name>".`);
  } else if (!isCore(def.id)) {
    throw new Error(`Edge shape "${def.id}" is not a core shape; a plugin shape needs a pluginId.`);
  }
  if (!!def.unit === !!def.path) throw new Error(`Edge shape "${def.id}" needs exactly one of unit or path.`);
  const taken = shapes.get(def.id);
  if (taken && taken.pluginId !== def.pluginId) throw new Error(`Edge shape "${def.id}" is already registered.`);
  shapes.set(def.id, def);
}

export function registerEdgeExtension(ext: EdgeExtension): void {
  const taken = extensions.get(ext.namespace);
  if (taken && taken.pluginId !== ext.pluginId) throw new Error(`Edge extension "${ext.namespace}" is already registered.`);
  extensions.set(ext.namespace, ext);
}

/** Remove everything a plugin added. Its edges stay in every document. */
export function deregisterEdgeFor(pluginId: string): void {
  for (const [id, def] of shapes) if (def.pluginId === pluginId) shapes.delete(id);
  for (const [ns, ext] of extensions) if (ext.pluginId === pluginId) extensions.delete(ns);
}

export const edgeShape = (id: string): EdgeShapeDef | undefined => shapes.get(id);
/** In registration order: core's first, then each plugin's. */
export const edgeShapes = (): EdgeShapeDef[] => [...shapes.values()];
export const edgeExtensions = (): EdgeExtension[] => [...extensions.values()];

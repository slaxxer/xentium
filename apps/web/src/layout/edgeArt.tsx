/**
 * Edge art: a shape drawn along a block's top or bottom edge.
 *
 * ## Where it is drawn
 *
 * Every block sits in a `display: contents` wrapper (see `RenderNode`), which has no
 * box — so the art cannot be positioned against it. It is PORTALLED into the block's
 * own root element instead, which is the box the art belongs to. A root that is not
 * positioned gets `xt-edge-host` (`position: relative`); one that already is — the
 * sticky navbar — is left alone, so edge art never un-sticks anything.
 *
 * ## How it is drawn
 *
 * A box (position, height, opacity) holding a coloured fill masked by an SVG path
 * stretched to the block's width. The path is drawn once per shape, height and count;
 * `preserveAspectRatio="none"` lets one path serve every width. An `image` edge is a
 * plain background strip on the box itself.
 *
 * ## Shapes and plugins
 *
 * Every shape — core's included — comes from `edgeRegistry`. A plugin may register more
 * and may draw an edge itself (an extension's `render`); this module exports the pieces
 * it builds from, so a plugin's drawing sits exactly where core's would. An edge whose
 * shape is not registered (its plugin is off) draws its `fallback`, or nothing, and is
 * kept in the document either way.
 *
 * Decoration only: `pointer-events: none`, `aria-hidden`, hidden under
 * `forced-colors`. Under `prefers-reduced-motion` it is still drawn — static art is not
 * motion, and hiding it gave those visitors a different site.
 */
import { useLayoutEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  EDGE_DEFAULT_COUNT,
  type BlockEdges, type EdgeArt, type EdgeShape,
} from "@xentium/contracts";
import { edgeExtensions, edgeShape, registerEdgeShape, type EdgeUnit } from "./edgeRegistry";
import "./edgeArt.scss";

/** The width every path is drawn at. Stretched to the real width by the mask. */
export const PATH_W = 1200;

/** Options that change the OUTLINE, as opposed to how it is painted. */
export interface PathOptions {
  /** Units across, for the repeating shapes. Absent = the shape's default. */
  count?: number;
  /** Shift along the edge, as a fraction of one unit (0–1). */
  phase?: number;
  /**
   * Units before the pattern repeats; default `count`. A band drawn at twice the count
   * with `period` = the count is two identical halves — what a seamless slide needs,
   * even for a shape whose units vary.
   */
  period?: number;
}

/** A deterministic random sequence: the same block draws the same way on every screen. */
const seeded = (seed: number) => () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
/**
 * A random number in [0, 1) fixed to unit `i` and slot `k`, so a varying unit looks the
 * same wherever and whenever it is drawn. Exported for plugin shapes.
 */
export const unitRand = (i: number, k: number): number => seeded(1000 + i * 97 + k * 13)();

const f = (n: number) => n.toFixed(1);

// ── Core shapes ────────────────────────────────────────────────────────────

const wave: EdgeUnit = {
  base: (H) => H / 2,
  // Two half-waves per unit: down then up.
  unit: (x, w, H) => ` Q ${f(x - w / 4)} ${f(H)} ${f(x - w / 2)} ${f(H / 2)} Q ${f(x - w * 3 / 4)} 0 ${f(x - w)} ${f(H / 2)}`,
};
const zigzag: EdgeUnit = {
  base: (H) => H * 0.12,
  unit: (x, w, H) => ` L ${f(x - w / 2)} ${f(H)} L ${f(x - w)} ${f(H * 0.12)}`,
};
const scallops: EdgeUnit = {
  base: (H) => H * 0.2,
  // A cubic close to a half-ellipse hanging from the band.
  unit: (x, w, H) => {
    const b = H * 0.2, d = b + (H - b) * 1.33;
    return ` C ${f(x)} ${f(d)} ${f(x - w)} ${f(d)} ${f(x - w)} ${f(b)}`;
  },
};

/** Drips: a band along the edge with drops of varying width and length — its own rhythm. */
function dripsPath(W: number, H: number): string {
  const rand = seeded(11);
  const band = Math.max(4, H * 0.14);
  let d = `M0 0 H${W} V${band}`;
  let x = W;
  while (x > 0) {
    x -= 14 + rand() * 46;
    if (x <= 8) break;
    const w = 8 + rand() * 14;
    const L = band + (H - band) * (0.3 + rand() * 0.7);
    d += ` L${x.toFixed(1)} ${band.toFixed(1)} C ${x.toFixed(1)} ${(L * 0.75).toFixed(1)} ${(x - w * 0.05).toFixed(1)} ${L.toFixed(1)} ${(x - w / 2).toFixed(1)} ${L.toFixed(1)}`
      + ` C ${(x - w * 0.95).toFixed(1)} ${L.toFixed(1)} ${(x - w).toFixed(1)} ${(L * 0.75).toFixed(1)} ${(x - w).toFixed(1)} ${band.toFixed(1)}`;
    x -= w;
  }
  return `${d} L0 ${band.toFixed(1)} Z`;
}

const PEAKS = [[1, 0.3], [0.9, 0.75], [0.72, 0.35], [0.52, 1], [0.32, 0.45], [0.15, 0.85], [0, 0.4]];

// Registered in the order the editor offers them. `image` is not a drawn shape and
// is offered on its own.
const label = (id: string) => `layoutEditor.edge.shape.${id}`;
registerEdgeShape({ id: "slant", labelKey: label("slant"), path: (W, H) => `M0 0 H${W} L0 ${H} Z` });
registerEdgeShape({ id: "curve", labelKey: label("curve"), path: (W, H) => `M0 0 H${W} Q ${W / 2} ${2 * H} 0 0 Z` });
registerEdgeShape({ id: "wave", labelKey: label("wave"), unit: wave, defaultCount: EDGE_DEFAULT_COUNT.wave, seamless: true });
registerEdgeShape({ id: "zigzag", labelKey: label("zigzag"), unit: zigzag, defaultCount: EDGE_DEFAULT_COUNT.zigzag, seamless: true });
registerEdgeShape({ id: "scallops", labelKey: label("scallops"), unit: scallops, defaultCount: EDGE_DEFAULT_COUNT.scallops, seamless: true });
registerEdgeShape({
  id: "peaks", labelKey: label("peaks"),
  path: (W, H) => `M0 0 H${W} ` + PEAKS.map(([x, y]) => `L${Math.round(x! * W)} ${Math.round(y! * H)}`).join(" ") + " Z",
});
registerEdgeShape({ id: "drips", labelKey: label("drips"), path: dripsPath });
// No outline: an edge that only carries plugin art. Offered as the editor's "None".
registerEdgeShape({ id: "blank", labelKey: label("none"), path: () => "" });

// ── Drawing ────────────────────────────────────────────────────────────────

/**
 * The shape an edge actually draws: its own when registered, else its fallback, else
 * none. `image` is not a drawn shape and resolves to itself.
 */
export function resolveEdgeShape(edge: EdgeArt): EdgeShape | null {
  if (edge.shape === "image" || edgeShape(edge.shape)) return edge.shape;
  return edge.fallback ?? null;
}

/**
 * The outline of a registered shape, as an SVG path filling the band from its top edge
 * down. An unregistered shape draws nothing (an empty path).
 */
export function edgePath(shape: string, W: number, H: number, opts: PathOptions = {}): string {
  const def = edgeShape(shape);
  if (!def) return "";
  if (def.path) return def.path(W, H);
  const repeating = def.unit!;
  const n = Math.max(1, Math.round(opts.count ?? def.defaultCount ?? 8));
  const w = W / n;
  // Start one unit PAST the right edge (less the phase) and run past the left one:
  // the viewBox crops the overhang, so a shifted band still covers the whole edge.
  let x = W + w * (1 - (opts.phase ?? 0));
  let d = "";
  let i = 0;
  const right = x;
  while (x > -w) {
    const p = opts.period ?? n;
    d += repeating.unit(x, w, H, ((i % p) + p) % p);
    x -= w;
    i++;
  }
  return `M${f(x)} 0 H${f(right)} V${f(repeating.base(H))}${d} Z`;
}

const maskCache = new Map<string, string>();

/** The shape as a CSS `mask-image` value. */
export function edgeMask(shape: string, H: number, W = PATH_W, opts: PathOptions = {}): string {
  const key = `${shape}|${W}|${H}|${opts.count ?? ""}|${opts.phase ?? 0}|${opts.period ?? ""}`;
  let mask = maskCache.get(key);
  if (!mask) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='none'><path d='${edgePath(shape, W, H, opts)}'/></svg>`;
    mask = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
    maskCache.set(key, mask);
  }
  return mask;
}

const imageUrl = (source: string): string =>
  source.startsWith("http") || source.startsWith("/") ? source : `/uploads/${source}`;

/**
 * Where an edge sits and which way it points. Exported so a plugin drawing beside an
 * edge (particles…) is placed and flipped exactly like the edge, and travels the way
 * its shape points.
 */
export function edgePlacement(edge: EdgeArt, side: "top" | "bottom", mirror = edge.mirror): CSSProperties {
  const out = edge.direction === "out";
  // Every path is drawn hanging DOWN from its top edge. Art that should rise upward —
  // over the block from its bottom edge, or above it from its top — is that path
  // flipped vertically.
  const flipY = (side === "bottom" && !out) || (side === "top" && out);
  const position: CSSProperties = side === "bottom"
    ? (out ? { top: "100%" } : { bottom: 0 })
    : (out ? { bottom: "100%" } : { top: 0 });
  return {
    ...position,
    // The height travels as custom properties so the stylesheet can swap in the phone
    // height under its breakpoint; an inline `height` would beat any media query.
    ["--xt-edge-h" as string]: `${edge.height}px`,
    ...(edge.mobileHeight !== undefined ? { ["--xt-edge-h-sm" as string]: `${edge.mobileHeight}px` } : {}),
    transform: `scale(${mirror ? -1 : 1}, ${flipY ? -1 : 1})`,
    ...(edge.opacity !== undefined && edge.opacity < 100 ? { opacity: edge.opacity / 100 } : {}),
  };
}

/** The inline style for one edge's BOX. */
export function edgeStyle(edge: EdgeArt, side: "top" | "bottom"): CSSProperties {
  const base = edgePlacement(edge, side);
  if (edge.shape !== "image") return base;
  if (!edge.image.trim()) return { display: "none" };
  const stretch = edge.fit === "stretch";
  return {
    ...base,
    backgroundImage: `url("${imageUrl(edge.image.trim()).replace(/["\\]/g, "\\$&")}")`,
    backgroundRepeat: stretch ? "no-repeat" : "repeat-x",
    backgroundSize: stretch ? "100% 100%" : "auto 100%",
  };
}

/** The edge's colour: one flat colour, or two as a left-to-right gradient. */
export const edgePaint = (edge: EdgeArt): string => {
  const [c1, c2] = edge.colors;
  return c2 ? `linear-gradient(90deg, ${c1}, ${c2})` : c1!;
};

/** The painted fill inside the box: the edge's colour, masked by its shape. */
export function edgeFill(edge: EdgeArt): CSSProperties | null {
  if (edge.shape === "image" || edge.shape === "blank" || !edgeShape(edge.shape)) return null;
  const mask = edgeMask(edge.shape, edge.height, PATH_W, { count: edge.count });
  return { background: edgePaint(edge), WebkitMaskImage: mask, maskImage: mask };
}

/**
 * The box's classes. A plugin drawing its own box uses these, so host rules that look
 * for `.xt-edge` (a section dropping its corner clip) still find it.
 */
export const edgeClassName = (edge: EdgeArt, side: "top" | "bottom"): string =>
  `xt-edge xt-edge--${side}${edge.mobileHeight === 0 ? " xt-edge--phone-hidden" : ""}`;

// ── "Viewing on" (editor only) ─────────────────────────────────────────────

/**
 * The date the editor's preview pretends it is, as `MM-DD`; null = today. For plugin
 * art that shows only part of the year (`EdgeExtension.viewDate`), which is hidden
 * most of the year — exactly when an admin arranges things.
 */
let previewDate: string | null = null;
const dateListeners = new Set<() => void>();

export function setPreviewDate(md: string | null): void {
  previewDate = md;
  for (const fn of dateListeners) fn();
}

const subscribeDate = (fn: () => void) => { dateListeners.add(fn); return () => { dateListeners.delete(fn); }; };
const dateSnapshot = () => previewDate;

export const usePreviewDate = () => useSyncExternalStore(subscribeDate, dateSnapshot, dateSnapshot);

/**
 * "Viewing at": the hour the editor's preview pretends it is (0–23); null = now. For
 * plugin art that follows the visitor's clock — a sun by day, stars by night.
 */
let previewHour: number | null = null;

export function setPreviewHour(hour: number | null): void {
  previewHour = hour;
  for (const fn of dateListeners) fn();
}

const hourSnapshot = () => previewHour;
const usePreviewHour = () => useSyncExternalStore(subscribeDate, hourSnapshot, hourSnapshot);

/** The moment edge art is drawn for: now, or the date and hour the editor previews. */
function previewNow(md: string | null, hour: number | null): Date {
  const on = md ? dateFromMonthDay(md) : new Date();
  if (hour !== null) on.setHours(hour, 0, 0, 0);
  return on;
}

/** `MM-DD` as a date in the current year. */
export const dateFromMonthDay = (md: string): Date => {
  const [m, d] = md.split("-").map(Number);
  return new Date(new Date().getFullYear(), (m ?? 1) - 1, d ?? 1, 12);
};

/** Whether one edge draws at `on` (default: now). Core always draws; a plugin may say no. */
export function edgeShows(edge: EdgeArt | undefined, on: Date = new Date()): edge is EdgeArt {
  if (!edge) return false;
  return edgeExtensions().every((x) => !x.shows || x.shows({ edge, ext: edge.ext?.[x.namespace], now: on }));
}

// ── The layer ──────────────────────────────────────────────────────────────

/**
 * Draw a block's edges into its root element.
 *
 * `wrapper` is the block's `display: contents` wrapper; its first element child is
 * the block's own box. Re-resolved after every render, because a block can swap its
 * root element (a loading state for the real thing).
 */
export function EdgeArtLayer({ edges, wrapper }: { edges: BlockEdges; wrapper: HTMLDivElement | null }) {
  const md = usePreviewDate();
  const hour = usePreviewHour();
  const on = previewNow(md, hour);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const el = wrapper?.firstElementChild;
    const next = el instanceof HTMLElement ? el : null;
    if (next !== host) setHost(next);
    if (!next) return;
    // Only a STATIC root needs a positioning context. A sticky or relative one already
    // is one — overriding it would un-stick the navbar.
    if (getComputedStyle(next).position === "static") next.classList.add("xt-edge-host");
  });

  const top = edgeShows(edges.top, on) ? edges.top : undefined;
  const bottom = edgeShows(edges.bottom, on) ? edges.bottom : undefined;

  // How far an OUTWARD top edge reaches above the box, as variables on it, so a block
  // that must not cover what is above it (the footer) can keep that much room.
  // Drawing stays the same either way: an outward edge still hangs over its neighbour.
  const outTop = top && top.direction === "out" && top.shape !== "blank" ? top : undefined;
  useLayoutEffect(() => {
    if (!host) return;
    if (!outTop) {
      host.style.removeProperty("--xt-edge-out-top");
      host.style.removeProperty("--xt-edge-out-top-sm");
      return;
    }
    host.style.setProperty("--xt-edge-out-top", `${outTop.height}px`);
    host.style.setProperty("--xt-edge-out-top-sm", `${outTop.mobileHeight ?? outTop.height}px`);
  }, [host, outTop?.height, outTop?.mobileHeight, !!outTop]);

  // The same for an OUTWARD bottom edge: the navbar keeps that much room below it, so
  // its edge does not cover the alert bar or the page under it.
  const outBottom = bottom && bottom.direction === "out" && bottom.shape !== "blank" ? bottom : undefined;

  // A block ABOVE the sticky navbar (the masthead) whose edge hangs down onto it has to
  // sit above the navbar, or the navbar paints over the edge. Only then: a block below
  // the navbar must keep scrolling under it. Re-checked every render, because the
  // editor can move the masthead to the other side of the navbar.
  useLayoutEffect(() => {
    if (!host) return;
    const nav = host.ownerDocument.querySelector(".pub-nav");
    const navFollows = !!nav && nav !== host && !host.contains(nav)
      && !!(host.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING);
    host.classList.toggle("xt-edge-host--over-nav", !!outBottom && navFollows);
  });

  useLayoutEffect(() => {
    if (!host) return;
    if (!outBottom) {
      host.style.removeProperty("--xt-edge-out-bottom");
      host.style.removeProperty("--xt-edge-out-bottom-sm");
      return;
    }
    host.style.setProperty("--xt-edge-out-bottom", `${outBottom.height}px`);
    host.style.setProperty("--xt-edge-out-bottom-sm", `${outBottom.mobileHeight ?? outBottom.height}px`);
  }, [host, outBottom?.height, outBottom?.mobileHeight, !!outBottom]);

  if (!host || (!top && !bottom)) return null;

  return createPortal(
    <>
      {top && <Edge edge={top} side="top" now={on} />}
      {bottom && <Edge edge={bottom} side="bottom" now={on} />}
    </>,
    host,
  );
}

/**
 * One edge. Its shape is resolved first (an unregistered one draws its fallback), then
 * each extension may draw it; the first that answers wins, else core does.
 */
function Edge({ edge: stored, side, now }: { edge: EdgeArt; side: "top" | "bottom"; now: Date }) {
  const shape = resolveEdgeShape(stored);
  if (!shape) return null;
  const edge = shape === stored.shape ? stored : { ...stored, shape };
  const drawCore = () => <CoreEdge edge={edge} side={side} />;
  for (const ext of edgeExtensions()) {
    const drawn: ReactNode = ext.render?.({ edge, side, ext: edge.ext?.[ext.namespace], drawCore, now });
    if (drawn != null) return <>{drawn}</>;
  }
  return drawCore();
}

/** Core's drawing: the box and, for a drawn shape, its one masked fill. */
function CoreEdge({ edge, side }: { edge: EdgeArt; side: "top" | "bottom" }) {
  const fill = edgeFill(edge);
  return (
    <span className={edgeClassName(edge, side)} aria-hidden="true" style={edgeStyle(edge, side)}>
      {fill && <span className="xt-edge__fill" style={fill} />}
    </span>
  );
}

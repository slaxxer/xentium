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
 * A coloured (or gradient) layer masked by an SVG path, stretched to the block's
 * width. The path is drawn once per shape and height; `preserveAspectRatio="none"`
 * lets one path serve every width. An `image` edge is a plain background strip.
 *
 * Decoration only: `pointer-events: none`, `aria-hidden`, and hidden entirely under
 * `prefers-reduced-motion` and `forced-colors` (see `edgeArt.scss`).
 */
import { useLayoutEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { inSeason, type BlockEdges, type EdgeArt, type EdgeShape } from "@xentium/contracts";
import "./edgeArt.scss";

/** The width every path is drawn at. Stretched to the real width by the mask. */
const PATH_W = 1200;

/** The outline of one shape, as an SVG path filling the band from its top edge down. */
export function edgePath(shape: Exclude<EdgeShape, "image">, W: number, H: number): string {
  if (shape === "slant") return `M0 0 H${W} L0 ${H} Z`;
  if (shape === "wave") {
    let d = `M0 0 H${W} V${H / 2}`;
    const n = 8, w = W / n;
    let x = W;
    for (let i = 0; i < n; i++) {
      d += ` Q ${x - w / 2} ${i % 2 ? 0 : H} ${x - w} ${H / 2}`;
      x -= w;
    }
    return `${d} Z`;
  }
  if (shape === "peaks") {
    const P = [[1, 0.3], [0.9, 0.75], [0.72, 0.35], [0.52, 1], [0.32, 0.45], [0.15, 0.85], [0, 0.4]];
    return `M0 0 H${W} ` + P.map(([x, y]) => `L${Math.round(x! * W)} ${Math.round(y! * H)}`).join(" ") + " Z";
  }
  // Drips: a band along the edge with drops of varying width and length. Seeded, so
  // the same block drips the same way on every render and every visitor's screen.
  let seed = 11;
  const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
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

const maskCache = new Map<string, string>();

/** The shape as a CSS `mask-image` value. */
export function edgeMask(shape: Exclude<EdgeShape, "image">, H: number, W = PATH_W): string {
  const key = `${shape}|${W}|${H}`;
  let mask = maskCache.get(key);
  if (!mask) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='none'><path d='${edgePath(shape, W, H)}'/></svg>`;
    mask = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
    maskCache.set(key, mask);
  }
  return mask;
}

const imageUrl = (source: string): string =>
  source.startsWith("http") || source.startsWith("/") ? source : `/uploads/${source}`;

/** The inline style for one edge. Exported for the editor's shape tiles and tests. */
export function edgeStyle(edge: EdgeArt, side: "top" | "bottom"): CSSProperties {
  const out = edge.direction === "out";
  // Every path is drawn hanging DOWN from its top edge. Art that should rise upward —
  // over the block from its bottom edge, or above it from its top — is that path
  // flipped vertically.
  const flipY = (side === "bottom" && !out) || (side === "top" && out);
  const position: CSSProperties = side === "bottom"
    ? (out ? { top: "100%" } : { bottom: 0 })
    : (out ? { bottom: "100%" } : { top: 0 });
  const base: CSSProperties = {
    ...position,
    height: `${edge.height}px`,
    transform: `scale(${edge.mirror ? -1 : 1}, ${flipY ? -1 : 1})`,
  };
  if (edge.shape === "image") {
    if (!edge.image.trim()) return { display: "none" };
    const stretch = edge.fit === "stretch";
    return {
      ...base,
      backgroundImage: `url("${imageUrl(edge.image.trim()).replace(/["\\]/g, "\\$&")}")`,
      backgroundRepeat: stretch ? "no-repeat" : "repeat-x",
      backgroundSize: stretch ? "100% 100%" : "auto 100%",
    };
  }
  const mask = edgeMask(edge.shape, edge.height);
  const [c1, c2] = edge.colors;
  return {
    ...base,
    background: c2 ? `linear-gradient(90deg, ${c1}, ${c2})` : c1,
    WebkitMaskImage: mask,
    maskImage: mask,
  };
}

// ── "Viewing on" (editor only) ─────────────────────────────────────────────

/**
 * The date the editor's preview pretends it is, as `MM-DD`; null = today. Seasonal
 * art is hidden most of the year, which is exactly when an admin arranges things.
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

/** `MM-DD` as a date in the current year. */
export const dateFromMonthDay = (md: string): Date => {
  const [m, d] = md.split("-").map(Number);
  return new Date(new Date().getFullYear(), (m ?? 1) - 1, d ?? 1, 12);
};

/** Whether one edge draws on `on` (default: today). */
export function edgeShows(edge: EdgeArt | undefined, on: Date = new Date()): edge is EdgeArt {
  if (!edge) return false;
  return !edge.season || inSeason(edge.season, on);
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
  const on = md ? dateFromMonthDay(md) : new Date();
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
  if (!host || (!top && !bottom)) return null;

  return createPortal(
    <>
      {top && <span className="xt-edge xt-edge--top" aria-hidden="true" style={edgeStyle(top, "top")} />}
      {bottom && <span className="xt-edge xt-edge--bottom" aria-hidden="true" style={edgeStyle(bottom, "bottom")} />}
    </>,
    host,
  );
}

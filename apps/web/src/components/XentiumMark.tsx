import { useId } from "react";
import "./XentiumMark.scss";

/**
 * The Xentium icon — the woven X on its ember tile — drawn inline, so it is crisp at
 * any size and a theme can dress it (Theme Studio → Colours → Logo icon: a border and
 * a shadow, see `.xt-logo-fx`).
 *
 * It is the DEFAULT logo of every install: the header, the sign-in pages, the
 * maintenance and 404 pages show it until an admin uploads their own. The ACP and the
 * installer always show it — they are Xentium's, not the site's.
 *
 * Geometry from the brand files (public/brand): tile radius 30% (25% at small sizes),
 * glyph 56% of the tile (68% small) so it stays legible as a favicon-sized mark.
 */
export function XentiumMark({ size = 32, className = "", title, brand = false }: {
  size?: number; className?: string; title?: string;
  /** Always Xentium's own colours, whatever the site set — for the ACP and the installer. */
  brand?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const small = size <= 32;
  const glyph = small ? { t: 16, s: 1.4167 } : { t: 22, s: 1.1667 };
  return (
    <svg className={`xt-mark${brand ? " xt-mark--brand" : ""} ${className}`} width={size} height={size} viewBox="0 0 100 100"
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={`xtm-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="xt-mark__from" />
          <stop offset="1" className="xt-mark__to" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx={small ? 25 : 30} fill={`url(#xtm-${id})`} />
      <g transform={`translate(${glyph.t} ${glyph.t}) scale(${glyph.s})`}>
        <g fill="none" className="xt-mark__glyph" strokeWidth="9" strokeLinecap="round">
          <path d="M8 8 L40 40" />
          <path d="M40 8 L32.5 15.5 M15.5 32.5 L8 40" />
        </g>
      </g>
    </svg>
  );
}

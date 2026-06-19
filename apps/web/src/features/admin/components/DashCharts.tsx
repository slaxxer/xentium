// ACP Dashboard — pure-SVG, token-aware chart primitives (ported from the Nebula
// prototype). No chart library: keeps the bundle lean and every colour a token.
import { useCallback, useEffect, useId, useRef, useState } from "react";

export const fmtK = (n: number): string => {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return "" + Math.round(n);
};
export const fmtFull = (n: number): string => Math.round(n).toLocaleString("en-US");

/** Measure the rendered width of a container (charts are responsive to it). */
function useMeasure(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((es) => { for (const e of es) setW(e.contentRect.width); });
    ro.observe(ref.current);
    setW(ref.current.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/* ===================== Sparkline (KPI cards) ===================== */
export function Sparkline({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
  const [ref, w] = useMeasure();
  const gid = useId();
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const H = height, padY = 4;
  const n = data.length;
  let path = "", area = "";
  if (w > 0 && n > 1) {
    const span = (max - min) || 1;
    const x = (i: number) => (i / (n - 1)) * w;
    const y = (v: number) => padY + (H - padY * 2) * (1 - (v - min) / span);
    const pts = data.map((v, i) => [x(i), y(v)] as const);
    path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    area = `M0 ${H} ` + pts.map((p) => "L" + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") + ` L${w} ${H} Z`;
  }
  return (
    <div ref={ref} style={{ width: "100%", height: H }}>
      {w > 0 && (
        <svg width={w} height={H} style={{ display: "block" }}>
          <defs>
            <linearGradient id={gid} x1={0} y1={0} x2={0} y2={1}>
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gid})`} />
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

/* ===================== Area chart (traffic) ===================== */
export function AreaChart({ labels, values, compare, color, height = 280, unit = "" }: {
  labels: string[]; values: number[]; compare?: number[] | null; color: string; height?: number; unit?: string;
}) {
  const [ref, w] = useMeasure();
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const padL = 46, padR = 16, padT = 16, padB = 30;
  const n = values.length;
  const allMax = Math.max(...values, ...(compare || []), 1);
  const max = niceMax(allMax);
  const iw = Math.max(w - padL - padR, 0), ih = H - padT - padB;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  const y = (v: number) => padT + ih * (1 - v / max);

  const mkLine = (arr: number[]) => arr.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
  const line = w > 0 ? mkLine(values) : "";
  const area = w > 0 ? `${mkLine(values)} L${x(n - 1).toFixed(1)} ${(padT + ih).toFixed(1)} L${x(0).toFixed(1)} ${(padT + ih).toFixed(1)} Z` : "";
  const cmpLine = (w > 0 && compare) ? mkLine(compare) : "";

  const grid = [0, 0.25, 0.5, 0.75, 1];
  const tickEvery = Math.max(1, Math.ceil(n / 7));

  const onMove = useCallback((e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left + padL;
    let idx = Math.round((mx - padL) / (iw / Math.max(n - 1, 1)));
    idx = Math.max(0, Math.min(n - 1, idx));
    setHover(idx);
  }, [iw, n]);

  return (
    <div ref={ref} style={{ width: "100%", height: H, position: "relative" }}>
      {w > 0 && (
        <svg width={w} height={H} style={{ display: "block", overflow: "visible" }}>
          <defs>
            <linearGradient id={gid} x1={0} y1={0} x2={0} y2={1}>
              <stop offset="0%" stopColor={color} stopOpacity={0.26} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {grid.map((g, i) => {
            const yy = padT + ih * g;
            const val = max * (1 - g);
            return (
              <g key={i}>
                <line x1={padL} y1={yy} x2={w - padR} y2={yy} stroke="var(--c-rowline)" strokeWidth={1} />
                <text x={padL - 9} y={yy + 4} textAnchor="end" className="chart-axis">{fmtK(val)}</text>
              </g>
            );
          })}
          {labels.map((lb, i) => (i % tickEvery === 0 || i === n - 1) ? (
            <text key={"x" + i} x={x(i)} y={H - 9} textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"} className="chart-axis">{lb}</text>
          ) : null)}
          {cmpLine && <path d={cmpLine} fill="none" stroke="var(--c-fg-subtle)" strokeWidth={1.6} strokeDasharray="4 5" opacity={0.7} />}
          <path d={area} fill={`url(#${gid})`} />
          <path d={line} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          {hover != null && (
            <g>
              <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + ih} stroke={color} strokeWidth={1} opacity={0.4} />
              <circle cx={x(hover)} cy={y(values[hover]!)} r={5} fill="var(--c-card)" stroke={color} strokeWidth={2.5} />
            </g>
          )}
          <rect x={padL} y={padT} width={Math.max(iw, 0)} height={ih} fill="transparent"
            onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
      )}
      {hover != null && w > 0 && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(x(hover), 60), w - 60), top: y(values[hover]!) - 12 }}>
          <span className="chart-tip__lbl">{labels[hover]}</span>
          <span className="chart-tip__val">
            <i style={{ background: color }} />{fmtFull(values[hover]!) + (unit ? " " + unit : "")}
          </span>
          {compare && <span className="chart-tip__cmp">{"prev: " + fmtFull(compare[hover] ?? 0)}</span>}
        </div>
      )}
    </div>
  );
}

/* ===================== Bar chart (registrations) ===================== */
export function BarChart({ labels, values, color, height = 200 }: {
  labels: string[]; values: number[]; color: string; height?: number;
}) {
  const [ref, w] = useMeasure();
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const padL = 34, padR = 8, padT = 14, padB = 26;
  const n = values.length;
  const max = niceMax(Math.max(...values, 1));
  const iw = Math.max(w - padL - padR, 0), ih = H - padT - padB;
  const gap = n ? Math.min(10, iw / n * 0.32) : 0;
  const bw = n ? (iw / n) - gap : 0;
  const y = (v: number) => padT + ih * (1 - v / max);
  const grid = [0, 0.5, 1];
  const tickEvery = Math.max(1, Math.ceil(n / 7));

  return (
    <div ref={ref} style={{ width: "100%", height: H, position: "relative" }}>
      {w > 0 && (
        <svg width={w} height={H} style={{ display: "block", overflow: "visible" }}>
          {grid.map((g, i) => {
            const yy = padT + ih * g;
            return (
              <g key={i}>
                <line x1={padL} y1={yy} x2={w - padR} y2={yy} stroke="var(--c-rowline)" strokeWidth={1} />
                <text x={padL - 8} y={yy + 4} textAnchor="end" className="chart-axis">{fmtK(max * (1 - g))}</text>
              </g>
            );
          })}
          {values.map((v, i) => {
            const bx = padL + i * (bw + gap) + gap / 2;
            const bh = Math.max((v / max) * ih, 1);
            const active = hover === i;
            return (
              <rect key={i} x={bx} y={padT + ih - bh} width={Math.max(bw, 1)} height={bh} rx={Math.min(5, bw / 2)}
                fill={color} opacity={hover == null ? 0.9 : active ? 1 : 0.4}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                style={{ transition: "opacity .12s" }} />
            );
          })}
          {labels.map((lb, i) => (i % tickEvery === 0 || i === n - 1) ? (
            <text key={"x" + i} x={padL + i * (bw + gap) + gap / 2 + bw / 2} y={H - 8} textAnchor="middle" className="chart-axis">{lb}</text>
          ) : null)}
        </svg>
      )}
      {hover != null && w > 0 && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(padL + hover * (bw + gap) + bw / 2, 50), w - 50), top: y(values[hover]!) - 14 }}>
          <span className="chart-tip__lbl">{labels[hover]}</span>
          <span className="chart-tip__val"><i style={{ background: color }} />{fmtFull(values[hover]!) + " joined"}</span>
        </div>
      )}
    </div>
  );
}

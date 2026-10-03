import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { compact, dayLabel, niceMax } from "./dashboardModel";

const PAD_L = 36, PAD_R = 4, PAD_T = 8, PAD_B = 24;

/**
 * Bars for this period, a dashed line for the one before. Drawn in SVG at the
 * container's measured width so bars stay crisp at any size; hover shows the
 * day's value and the previous period's.
 */
export function PulseChart({ days, values, compare, color, unit, showCompare, height }: {
  days: string[];
  values: number[];
  compare: number[];
  color: string;
  unit: (n: number) => string;
  showCompare: boolean;
  height: number;
}) {
  const { t, i18n } = useTranslation("acp");
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const n = values.length;
  const max = niceMax(Math.max(1, ...values, ...(showCompare ? compare : [])));
  const iw = Math.max(w - PAD_L - PAD_R, 0), ih = height - PAD_T - PAD_B;
  const slot = n ? iw / n : 0, gap = Math.min(6, slot * 0.32), bw = Math.max(slot - gap, 1);
  const y = (v: number) => PAD_T + ih * (1 - v / max);
  const cx = (i: number) => PAD_L + i * slot + slot / 2;
  const every = Math.max(1, Math.ceil(n / 7));
  const line = showCompare ? compare.map((v, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ") : "";

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left) / (slot || 1)))));
  };

  return (
    <div className="dsh-chart" ref={ref} style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={t("dashboard.chartLabel", { total: values.reduce((a, b) => a + b, 0) })}>
          {[0, 0.5, 1].map((g) => (
            <line key={g} className="dsh-chart__grid" x1={PAD_L} x2={w - PAD_R} y1={PAD_T + ih * g} y2={PAD_T + ih * g} />
          ))}
          {values.map((v, i) => {
            const bh = v > 0 ? Math.max((v / max) * ih, 3) : 2;
            return (
              <rect key={i} x={PAD_L + i * slot + gap / 2} y={PAD_T + ih - bh} width={bw} height={bh} rx={Math.min(4, bw / 2)}
                className={v > 0 ? "dsh-chart__bar" : "dsh-chart__bar is-zero"}
                style={{ fill: v > 0 ? color : undefined, opacity: hover == null ? 0.9 : hover === i ? 1 : 0.4 }} />
            );
          })}
          {line && <path d={line} className="dsh-chart__cmp" />}
          <rect x={PAD_L} y={0} width={iw} height={height} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
      )}
      {w > 0 && [0, 0.5, 1].map((g) => (
        <span key={g} className="dsh-chart__ylab" style={{ top: PAD_T + ih * g - 7 }}>{compact(max * (1 - g), i18n.language)}</span>
      ))}
      {w > 0 && days.map((d, i) => ((n - 1 - i) % every === 0 ? (
        <span key={d} className="dsh-chart__xlab" style={{ left: cx(i) }}>{dayLabel(d, i18n.language)}</span>
      ) : null))}
      {hover != null && hover < n && (
        <div className="dsh-chart__tip" style={{ left: Math.min(Math.max(cx(hover), 70), w - 70), top: y(values[hover]!) - 12 }}>
          <span className="dsh-chart__tipday">{dayLabel(days[hover]!, i18n.language)}</span>
          <span><i style={{ background: color }} />{unit(values[hover]!)}</span>
          {showCompare && <span className="dsh-chart__tipprev">{t("dashboard.previous", { n: compare[hover] ?? 0 })}</span>}
        </div>
      )}
    </div>
  );
}

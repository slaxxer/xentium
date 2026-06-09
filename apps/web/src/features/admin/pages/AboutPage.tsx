import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { AcpIcon } from "./acpIcons";
import "./acpSystem.scss";
import "./AboutPage.scss";

interface HealthData {
  status: string;
  uptime: number;
  env: string;
}

const STACK: { key: string; value: string }[] = [
  { key: "runtime",  value: "Node.js LTS + TypeScript" },
  { key: "backend",  value: "Express 5 + Prisma 7" },
  { key: "database", value: "PostgreSQL 17 + Redis 7" },
  { key: "frontend", value: "React 19 + Vite + TanStack Query" },
  { key: "queues",   value: "BullMQ" },
  { key: "license",  value: "Open Source" },
];

const RESOURCES: { key: string; icon: string; href: string }[] = [
  { key: "docs",        icon: "book",      href: "https://nodevo.io/docs" },
  { key: "github",      icon: "github",    href: "https://github.com/nodevo/nodevo" },
  { key: "changelog",   icon: "changelog", href: "https://nodevo.io/changelog" },
  { key: "marketplace", icon: "bag",       href: "https://nodevo.io/plugins" },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const loadColor = (v: number) =>
  v >= 85 ? "var(--c-danger)" : v >= 65 ? "var(--c-warn)" : "var(--c-accent)";

function formatUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function Gauge({
  label, value, suffix = "%", sub, color,
}: {
  label: string; value: number; suffix?: string; sub: string; color?: string;
}) {
  const r = 46, c = 2 * Math.PI * r;
  const off = c * (1 - clamp(value, 0, 100) / 100);
  const col = color || loadColor(value);
  return (
    <div className="ab-gauge">
      <div className="ab-gauge__ring">
        <svg width={108} height={108} viewBox="0 0 108 108">
          <circle cx={54} cy={54} r={r} fill="none" stroke="var(--c-rowline)" strokeWidth={9} />
          <circle
            cx={54} cy={54} r={r} fill="none" stroke={col} strokeWidth={9} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={off}
            transform="rotate(-90 54 54)"
            style={{ transition: "stroke-dashoffset .8s cubic-bezier(.4,0,.2,1), stroke .4s" }}
          />
        </svg>
        <div className="ab-gauge__num">
          <b style={{ color: col }}>
            {Math.round(value)}
            <span style={{ fontSize: 13, fontWeight: 700 }}>{suffix}</span>
          </b>
          <span>{label}</span>
        </div>
      </div>
      <div className="ab-gauge__sub">{sub}</div>
    </div>
  );
}

function Spark({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const W = 600, H = 46;
  const step = W / (data.length - 1);
  const pts = data.map((v, i): [number, number] => [i * step, H - (v / max) * (H - 6) - 3]);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  return (
    <svg className="ab-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="ab-sparkfill" x1={0} y1={0} x2={0} y2={1}>
          <stop offset="0%" stopColor="var(--c-accent)" stopOpacity={0.28} />
          <stop offset="100%" stopColor="var(--c-accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#ab-sparkfill)" />
      <polyline
        points={line} fill="none" stroke="var(--c-accent)" strokeWidth={2.2}
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function AboutPage() {
  const { t } = useTranslation("acp");
  const { data: health } = useQuery<HealthData>({
    queryKey: ["api-health"],
    queryFn: () => api.get("/health"),
    refetchInterval: 30_000,
  });

  // Live uptime: seeded from the real /health value, ticking locally between refetches.
  const [uptime, setUptime] = useState(0);
  useEffect(() => { if (health) setUptime(health.uptime); }, [health?.uptime]);
  useEffect(() => {
    const id = setInterval(() => setUptime((u) => u + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // NOTE: CPU / memory / queue / throughput / latency are sample figures animated
  // client-side — there is no host-metrics endpoint yet (see redesign README).
  const [cpu, setCpu]         = useState(34);
  const [mem, setMem]         = useState(58);
  const [queue, setQueue]     = useState(22);
  const [pending, setPending] = useState(12);
  const [rps, setRps]         = useState(46);
  const [latency, setLatency] = useState(38);
  const [spark, setSpark]     = useState<number[]>(
    () => Array.from({ length: 40 }, (_, i) => 40 + Math.sin(i / 3) * 12 + Math.random() * 8),
  );

  useEffect(() => {
    const tick = setInterval(() => {
      setCpu((v) => clamp(v + (Math.random() - 0.5) * 16, 12, 88));
      setMem((v) => clamp(v + (Math.random() - 0.5) * 7, 44, 74));
      setQueue((v) => clamp(v + (Math.random() - 0.5) * 22, 4, 70));
      setPending((v) => clamp(Math.round(v + (Math.random() - 0.5) * 8), 0, 40));
      const r = clamp(46 + (Math.random() - 0.5) * 30, 18, 92);
      setRps(Math.round(r));
      setLatency(Math.round(clamp(38 + (Math.random() - 0.5) * 26, 14, 90)));
      setSpark((p) => [...p.slice(1), r]);
    }, 1800);
    return () => clearInterval(tick);
  }, []);

  const online = !!health;
  const isOk   = health?.status === "ok";
  const isDev  = !!health?.env && health.env !== "production";

  return (
    <div>
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("about.eyebrow")}</p>
          <h1 className="pg-title">{t("about.title")}</h1>
          <p className="pg-sub">{t("about.subtitle")}</p>
        </div>
      </div>

      <div className="ab">
        {/* hero */}
        <div className="ab-hero">
          <div className="ab-hero__glow" />
          <div className="ab-hero__mark"><AcpIcon name="zap" size={32} stroke={2} /></div>
          <div className="ab-hero__id">
            <h2>Nodevo</h2>
            <p className="ab-hero__meta">
              <b>v1.0.0</b> · {t("about.tagline")}
            </p>
          </div>
          <span className={`ab-pill${online ? "" : " ab-pill--idle"}`}>
            {online && <span className="ab-pill__dot" />}
            {online ? t("about.apiOnline") : t("about.connecting")}
          </span>
        </div>

        {/* stack + api status */}
        <div className="ab-grid">
          <div className="ab-card">
            <div className="ab-card__head">
              <AcpIcon name="layers" size={18} />
              <h3>{t("about.techStack")}</h3>
            </div>
            <div className="ab-dl">
              {STACK.map((s) => (
                <div key={s.key} className="ab-dl__row">
                  <span className="ab-dl__k">{t(`about.stack.${s.key}`)}</span>
                  <span className="ab-dl__v">{s.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="ab-card">
            <div className="ab-card__head">
              <AcpIcon name="activity" size={18} />
              <h3>{t("about.apiStatus")}</h3>
              <span className="ab-card__aside">{t("about.live")}</span>
            </div>
            <div className="ab-dl">
              <div className="ab-dl__row">
                <span className="ab-dl__k">{t("about.dl.status")}</span>
                <span className={`ab-dl__v${isOk ? " is-ok" : ""}`}>{health?.status ?? "—"}</span>
              </div>
              <div className="ab-dl__row">
                <span className="ab-dl__k">{t("about.dl.environment")}</span>
                <span className={`ab-dl__v${isDev ? " is-dev" : ""}`}>{health?.env ?? "—"}</span>
              </div>
              <div className="ab-dl__row">
                <span className="ab-dl__k">{t("about.dl.uptime")}</span>
                <span className="ab-dl__v">{health ? formatUptime(uptime) : "—"}</span>
              </div>
              <div className="ab-dl__row">
                <span className="ab-dl__k">{t("about.dl.latency")}</span>
                <span className="ab-dl__v">{latency} ms</span>
              </div>
            </div>
          </div>
        </div>

        {/* system health */}
        <div className="ab-card">
          <div className="ab-card__head">
            <AcpIcon name="cpu" size={18} />
            <h3>{t("about.systemHealth")}</h3>
            <span className="ab-card__aside">{t("about.updatesEvery2s")}</span>
          </div>
          <div className="ab-health__grid">
            <Gauge label={t("about.gauge.cpu")} value={cpu} sub={t("about.gauge.vcpu")} />
            <Gauge label={t("about.gauge.memory")} value={mem} sub={t("about.gauge.memUsage", { used: Math.round((mem / 100) * 2048) })} />
            <Gauge
              label={t("about.gauge.queue")} value={queue} sub={t("about.gauge.jobsPending", { count: pending })}
              color={queue >= 65 ? "var(--c-warn)" : "var(--c-accent2)"}
            />
          </div>
          <Spark data={spark} />
          <div className="ab-meterline">
            <b>{t("about.throughput")}</b>
            <span>{t("about.reqPerSec", { count: rps })}</span>
          </div>
        </div>

        {/* resources */}
        <div className="ab-card">
          <div className="ab-card__head">
            <AcpIcon name="book" size={18} />
            <h3>{t("about.resources")}</h3>
          </div>
          <div className="ab-res">
            {RESOURCES.map((r) => (
              <a key={r.key} className="ab-reslink" href={r.href} target="_blank" rel="noopener noreferrer">
                <span className="ab-reslink__ic"><AcpIcon name={r.icon} size={18} /></span>
                <span className="ab-reslink__t">
                  <b>{t(`about.resourceLinks.${r.key}.label`)}</b>
                  <span>{t(`about.resourceLinks.${r.key}.sub`)}</span>
                </span>
                <AcpIcon name="external" size={15} className="ab-reslink__ext" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

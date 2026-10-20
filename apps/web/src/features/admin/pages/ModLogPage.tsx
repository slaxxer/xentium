import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faUserPen, faBan, faTriangleExclamation, faFileLines, faFolderOpen, faGear,
  faChevronRight, faMagnifyingGlass, faDownload, faRobot,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { Username } from "../../../components/Username";
import { Button } from "../../../components/AcpControls";
import { api, apiDownload } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { timeAgo } from "../../../lib/time";
import { uiLocale } from "../../../lib/i18n";
import { caseTitle } from "../../modcp/modData";
import "./ModLogPage.scss";

/**
 * ACP · Moderation · Moderation Log: what the team and the automatic checks did.
 *
 * Read-only by design (the log is append-only). Entries read as sentences ("Slaxxer
 * banned spamhost42"), grouped by day, with a kind per action (the API groups the
 * action keys), filters for kind, period, who did it and a search, and the details
 * one click away. Targets come named from the API: a member, an article, a comment's
 * author, a case's type.
 */

const KINDS = ["account", "ban", "warning", "content", "case"] as const;
type Kind = (typeof KINDS)[number];
type EntryKind = Kind | "other";
type Period = "today" | "7d" | "30d" | "all";

interface Entry {
  id: string;
  action: string;
  kind: EntryKind;
  createdAt: string;
  reason: string | null;
  meta: unknown;
  actor: { type: "user" | "system"; id: string | null; username: string | null; badgeColor: string | null };
  target: { kind: string; id: string | null; label: string | null; badgeColor?: string | null; href?: string | null; detail?: string | null };
}
interface Page { data: Entry[]; meta: { page: number; totalPages: number; total: number }; counts: Record<"all" | Kind, number> }
interface Summary { total: number; bans: number; lifted: number; warnings: number; pardoned: number; automatic: number; actors: { id: string; username: string }[] }

const KIND_ICON: Record<EntryKind, IconDefinition> = {
  account: faUserPen, ban: faBan, warning: faTriangleExclamation, content: faFileLines, case: faFolderOpen, other: faGear,
};

const PAGE_SIZE = 30;

/** The start of the period, in the viewer's own day. */
function sinceOf(p: Period): string | null {
  if (p === "all") return null;
  const d = new Date();
  if (p === "today") d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - (p === "7d" ? 7 : 30));
  return d.toISOString();
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function ModLogPage() {
  const { t } = useTranslation("acp");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [period, setPeriod] = useState<Period>("7d");
  const [actor, setActor] = useState("");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Search after typing stops, not on every key.
  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const filter = useMemo(() => {
    const p = new URLSearchParams();
    if (kind !== "all") p.set("kind", kind);
    if (actor) p.set("actor", actor);
    const since = sinceOf(period);
    if (since) p.set("since", since);
    if (q) p.set("q", q);
    return p;
  }, [kind, actor, period, q]);

  const { data: summary } = useQuery<Summary>({ queryKey: ["acp-modlog", "summary"], queryFn: () => api.get("/admin/modlog/summary") });
  const log = useInfiniteQuery<Page>({
    queryKey: ["acp-modlog", filter.toString()],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(filter);
      p.set("page", String(pageParam));
      p.set("limit", String(PAGE_SIZE));
      return api.get(`/admin/modlog?${p.toString()}`);
    },
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  });

  const entries = log.data?.pages.flatMap((p) => p.data) ?? [];
  const counts = log.data?.pages[0]?.counts;

  // Grouped by the viewer's day, newest first (the API already sorts).
  const days = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    const groups: { key: string; label: string; items: Entry[] }[] = [];
    for (const e of entries) {
      const d = new Date(e.createdAt);
      const key = dayKey(d);
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) {
        const label = key === dayKey(today) ? t("modLog.today")
          : key === dayKey(yesterday) ? t("modLog.yesterday")
          : d.toLocaleDateString(uiLocale(), { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
        g = { key, label, items: [] };
        groups.push(g);
      }
      g.items.push(e);
    }
    return groups;
  }, [entries, t]);

  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  async function exportCsv() {
    try {
      await apiDownload(`/admin/modlog/export.csv?${filter.toString()}`, "moderation-log.csv");
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  const pct = summary && summary.total > 0 ? Math.round((summary.automatic / summary.total) * 100) : 0;

  return (
    <div className="mlp">
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("modLog.eyebrow")}</p>
          <h1 className="pg-title">{t("modLog.title")}</h1>
          <p className="pg-sub">{t("modLog.sub")}</p>
        </div>
        <Button variant="ghost" icon={faDownload} className="mlp-export" onClick={exportCsv}>{t("modLog.export")}</Button>
      </div>

      <section className="mlp-stats" aria-label={t("modLog.statsLabel")}>
        <Stat value={summary?.total} label={t("modLog.statActions")} sub={t("modLog.statActionsSub")} />
        <Stat value={summary?.bans} label={t("modLog.statBans")} sub={t("modLog.statBansSub", { count: summary?.lifted ?? 0 })} tone="danger" />
        <Stat value={summary?.warnings} label={t("modLog.statWarnings")} sub={t("modLog.statWarningsSub", { count: summary?.pardoned ?? 0 })} tone="warn" />
        <Stat value={summary ? `${pct}%` : undefined} label={t("modLog.statAuto")} sub={t("modLog.statAutoSub")} tone="accent" />
      </section>

      <section className="mlp-filters" aria-label={t("modLog.filtersLabel")}>
        <div className="mlp-filters__row">
          <label className="mlp-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("modLog.searchPh")} aria-label={t("modLog.searchLabel")} />
          </label>
          <label className="mlp-by">
            <span>{t("modLog.doneBy")}</span>
            <select className="acp-select" value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">{t("modLog.byAnyone")}</option>
              <option value="staff">{t("modLog.byStaff")}</option>
              <option value="system">{t("modLog.bySystem")}</option>
              {(summary?.actors ?? []).map((a) => <option key={a.id} value={a.id}>{a.username}</option>)}
            </select>
          </label>
          <div className="acp-seg acp-seg--auto" role="radiogroup" aria-label={t("modLog.periodLabel")}>
            {(["today", "7d", "30d", "all"] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={period === p} className={period === p ? "is-on" : ""} onClick={() => setPeriod(p)}>
                {t(`modLog.period.${p}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="mlp-kinds" role="radiogroup" aria-label={t("modLog.kindLabel")}>
          {(["all", ...KINDS] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`mlp-kind mlp-kind--${k}${kind === k ? " is-on" : ""}`} onClick={() => setKind(k)}>
              <span className="mlp-kind__dot" aria-hidden="true" />
              {t(`modLog.kinds.${k}`)}
              {counts && <span className="mlp-kind__n">{counts[k]}</span>}
            </button>
          ))}
        </div>
      </section>

      {log.isLoading ? (
        <p className="mlp-muted">{t("modLog.loading")}</p>
      ) : days.length === 0 ? (
        <div className="mlp-empty">
          <p>{t("modLog.empty")}</p>
          {(period !== "all" || kind !== "all" || actor || q) && (
            <Button variant="ghost" onClick={() => { setPeriod("all"); setKind("all"); setActor(""); setQuery(""); }}>{t("modLog.showEverything")}</Button>
          )}
        </div>
      ) : (
        <div className="mlp-days">
          {days.map((day) => (
            <section key={day.key} className="mlp-day" aria-label={day.label}>
              <header className="mlp-day__head">
                <h2>{day.label}</h2>
                <span>{t("modLog.entries", { count: day.items.length })}</span>
              </header>
              <div className="mlp-card">
                {day.items.map((e) => <Row key={e.id} e={e} open={open.has(e.id)} onToggle={() => toggle(e.id)} />)}
              </div>
            </section>
          ))}
          {log.hasNextPage && (
            <div className="mlp-more">
              <Button variant="ghost" disabled={log.isFetchingNextPage} onClick={() => log.fetchNextPage()}>
                {log.isFetchingNextPage ? t("modLog.loading") : t("modLog.older")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, sub, tone }: { value: number | string | undefined; label: string; sub: string; tone?: "danger" | "warn" | "accent" }) {
  return (
    <div className={`mlp-stat${tone ? ` mlp-stat--${tone}` : ""}`}>
      <b>{value ?? "–"}</b>
      <span className="mlp-caps">{label}</span>
      <span className="mlp-muted">{sub}</span>
    </div>
  );
}

/** One entry: the sentence, its kind, and the details when opened. */
function Row({ e, open, onToggle }: { e: Entry; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation("acp");
  const key = e.action.replace(/\./g, "_");
  const label = t(`modLog.actions.${key}`, { defaultValue: e.action.split(".").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") });
  const verb = t(`modLog.verbs.${key}`, { defaultValue: "" });
  const auto = e.actor.type === "system";
  const created = new Date(e.createdAt);
  const target = targetText(e, t);

  const facts: [string, string][] = [
    [t("modLog.fact.action"), label],
    [t("modLog.fact.when"), created.toLocaleString(uiLocale(), { dateStyle: "full", timeStyle: "short" })],
    [t("modLog.fact.by"), auto ? t("modLog.automatic") : e.actor.username ?? t("modLog.unknown")],
    ...(target.name ? [[t("modLog.fact.target"), target.detail ? `${target.name} (${target.detail})` : target.name] as [string, string]] : []),
    ...(e.reason ? [[t("modLog.fact.reason"), e.reason] as [string, string]] : []),
    ...metaFacts(e.meta),
  ];

  return (
    <div className={`mlp-row${open ? " is-open" : ""}`}>
      <button type="button" className="mlp-row__hit" aria-expanded={open} onClick={onToggle}>
        <span className={`mlp-icon mlp-icon--${e.kind}`} aria-hidden="true"><FontAwesomeIcon icon={KIND_ICON[e.kind]} /></span>
        <span className="mlp-row__text">
          <span className="mlp-row__sentence">
            {auto
              ? <b className="mlp-auto"><FontAwesomeIcon icon={faRobot} /> {t("modLog.automatic")}</b>
              : <Username username={e.actor.username ?? t("modLog.unknown")} badgeColor={e.actor.badgeColor} className="mlp-name" />}
            {" "}
            {verb
              ? <span className="mlp-verb">{verb}</span>
              : <span className="mlp-verb">{label.toLowerCase()}:</span>}
            {target.name && <>{" "}{e.target.kind === "user"
              ? <Username username={target.name} badgeColor={e.target.badgeColor ?? null} className="mlp-name" />
              : <b className="mlp-target">{target.name}</b>}</>}
          </span>
          <span className="mlp-row__meta">
            <span className={`mlp-pill mlp-pill--${e.kind}`}>{t(`modLog.kinds.${e.kind}`)}</span>
            {target.detail && <span className="mlp-muted">{target.detail}</span>}
            {e.reason && <span className="mlp-reason">{e.reason}</span>}
          </span>
        </span>
        <span className="mlp-row__time">
          <b>{created.toLocaleTimeString(uiLocale(), { hour: "2-digit", minute: "2-digit" })}</b>
          <span>{timeAgo(created)}</span>
        </span>
        <FontAwesomeIcon icon={faChevronRight} className="mlp-row__chev" aria-hidden />
      </button>
      {open && (
        <dl className="mlp-facts">
          {facts.map(([k, v]) => (
            <div key={k} className="mlp-facts__row"><dt>{k}</dt><dd>{v}</dd></div>
          ))}
          {e.target.href && (
            <div className="mlp-facts__row">
              <dt>{t("modLog.fact.open")}</dt>
              <dd>
                {e.target.href.startsWith("/admin")
                  ? <Link to={e.target.href}>{t(`modLog.openTarget.${e.target.kind}`, { defaultValue: t("modLog.openTarget.other") })}</Link>
                  : <a href={e.target.href} target="_blank" rel="noreferrer">{t(`modLog.openTarget.${e.target.kind}`, { defaultValue: t("modLog.openTarget.other") })}</a>}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

type T = (k: string, o?: Record<string, unknown>) => string;

/** How the target reads in the sentence, and what goes beside it. */
function targetText(e: Entry, t: T): { name: string | null; detail: string | null } {
  const tg = e.target;
  switch (tg.kind) {
    case "user": return { name: tg.label ?? t("modLog.deletedMember"), detail: null };
    case "case": return { name: tg.label ? caseTitle(tg.label) : t("modLog.aCase"), detail: tg.detail ?? null };
    case "article": return { name: tg.label ? `“${tg.label}”` : t("modLog.anArticle"), detail: null };
    case "article_comment": return { name: tg.label ?? t("modLog.deletedMember"), detail: tg.detail ? t("modLog.onArticle", { title: tg.detail }) : null };
    case "profile_comment": return { name: tg.label ?? t("modLog.deletedMember"), detail: tg.detail ? t("modLog.onProfile", { name: tg.detail }) : null };
    case "ip": return { name: tg.label, detail: null };
    case "none": return { name: null, detail: null };
    default: return { name: tg.label, detail: null };
  }
}

/** Plain values in the entry's meta, as extra facts (nested objects are left out). */
function metaFacts(meta: unknown): [string, string][] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  return Object.entries(meta as Record<string, unknown>)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 8)
    .map(([k, v]) => [k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()), String(v)]);
}

/**
 * ACP → System → Activity Log: who did what in the admin panel, newest first.
 *
 * Two kinds of row share one timeline: a MOVEMENT (an admin opened an ACP page) and an
 * ACP ACTION (a POST/PUT/PATCH/DELETE under /api/admin, with its status, and why it
 * failed when it did). Reading aids, all presentation over the same rows:
 *   - rows are grouped by day;
 *   - a run of rows by the same person names them once (the actor column goes quiet);
 *   - three or more page views in a row by one person fold into "Browsed N pages",
 *     which opens in place;
 *   - an action reads as a sentence (`activityHumanize`), its path underneath.
 * Pages are named from the ACP nav, so plugin pages get their own labels for free.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faChevronDown, faMagnifyingGlass, faCheck } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { Pager } from "../../../components/Pager";
import { UserAvatar } from "../../../components/UserAvatar";
import { useAcpNav, type NavItem } from "../useAcpNav";
import { browserOf, humanize } from "./activityHumanize";
import type { PaginationMeta } from "@xentium/contracts";
import "./ActivityLogPage.scss";

type Category = "page_visit" | "acp_action";
const METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
type Since = "" | "1h" | "24h" | "7d";
const SINCE_MS: Record<Exclude<Since, "">, number> = { "1h": 3600e3, "24h": 86400e3, "7d": 7 * 86400e3 };

interface ActivityRow {
  id: string;
  category: Category;
  userId: string | null;
  username: string | null;
  method: string | null;
  path: string;
  status: number | null;
  ip: string | null;
  userAgent: string | null;
  error: { code?: string; message?: string } | null;
  createdAt: string;
}
interface Actor { username: string; avatar: string | null; group: { key: string; name: string } | null }
interface ListResponse {
  data: ActivityRow[];
  meta: PaginationMeta;
  counts: { all: number; page_visit: number; acp_action: number };
  actors: Record<string, Actor>;
  targets: Record<string, string>;
}
interface Facets {
  users: Array<{ userId: string; count: number } & Actor>;
  ips: Array<{ ip: string; count: number; usernames: string[] }>;
  methods: Record<string, number>;
}

/** One line of the timeline: a single row, or a fold of consecutive page views. */
type Item =
  | { kind: "row"; row: ActivityRow }
  | { kind: "visits"; rows: ActivityRow[] };

/** Fold length at which consecutive page views by one person become "Browsed N pages". */
const FOLD_AT = 3;
/** A pause longer than this ends a fold: two sittings are two lines. */
const FOLD_GAP_MS = 15 * 60e3;

function dayKey(d: Date) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

/** Rows (newest first) → days → items, folding runs of page views. */
function toDays(rows: ActivityRow[]): Array<{ key: string; date: Date; items: Item[]; count: number }> {
  const days: Array<{ key: string; date: Date; rows: ActivityRow[] }> = [];
  for (const r of rows) {
    const d = new Date(r.createdAt);
    const k = dayKey(d);
    const last = days[days.length - 1];
    if (last?.key === k) last.rows.push(r);
    else days.push({ key: k, date: d, rows: [r] });
  }
  return days.map(({ key, date, rows: dayRows }) => {
    const items: Item[] = [];
    let i = 0;
    while (i < dayRows.length) {
      const r = dayRows[i]!;
      if (r.category === "page_visit") {
        let j = i;
        while (
          j < dayRows.length && dayRows[j]!.category === "page_visit" && dayRows[j]!.userId === r.userId
          && (j === i || +new Date(dayRows[j - 1]!.createdAt) - +new Date(dayRows[j]!.createdAt) <= FOLD_GAP_MS)
        ) j++;
        if (j - i >= FOLD_AT) { items.push({ kind: "visits", rows: dayRows.slice(i, j) }); i = j; continue; }
      }
      items.push({ kind: "row", row: r });
      i++;
    }
    return { key, date, items, count: dayRows.length };
  });
}

/** ACP page names by path, longest match first. The dashboard (`/admin`) matches only itself. */
function usePageNames(): (path: string) => string | null {
  const nav = useAcpNav();
  const { t } = useTranslation("acp");
  return useMemo(() => {
    const entries: Array<{ to: string; label: string }> = [];
    const add = (to: string, label: string) => entries.push({ to, label: t(label) });
    for (const item of nav as NavItem[]) {
      if (item.to) add(item.to, item.label);
      for (const c of item.children ?? []) {
        add(c.to, c.label);
        for (const w of c.within ?? []) add(w.to, w.label);
      }
    }
    entries.sort((a, b) => b.to.length - a.to.length);
    return (path: string) => {
      const p = path.split(/[?#]/)[0]!.replace(/\/$/, "") || "/";
      for (const e of entries) {
        if (e.to === "/admin" ? p === "/admin" : p === e.to || p.startsWith(`${e.to}/`)) return e.label;
      }
      return null;
    };
  }, [nav, t]);
}

/** A pill that opens a menu of choices — the filter bar's one control. */
function FilterMenu({ label, active, children, onClear, clearLabel }: {
  label: ReactNode; active: boolean; children: (close: () => void) => ReactNode; onClear?: () => void; clearLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className="act-menu" ref={ref}>
      <button type="button" className={`act-pill${active ? " is-on" : ""}`} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        <span>{label}</span><FontAwesomeIcon icon={faChevronDown} className="act-pill__chev" />
      </button>
      {open && (
        <div className="act-menu__pop" role="menu">
          {children(close)}
          {active && onClear && (
            <button type="button" className="act-menu__clear" onClick={() => { onClear(); close(); }}>{clearLabel}</button>
          )}
        </div>
      )}
    </div>
  );
}

function MenuOption({ on, onPick, children }: { on: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} className={`act-opt${on ? " is-on" : ""}`} onClick={onPick}>
      <span className="act-opt__body">{children}</span>
      {on && <FontAwesomeIcon icon={faCheck} className="act-opt__check" />}
    </button>
  );
}

const time = (d: string) => new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

export function ActivityLogPage() {
  const { t, i18n } = useTranslation("acp");
  const pageName = usePageNames();

  const [category, setCategory] = useState<"" | Category>("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [user, setUser] = useState("");
  const [since, setSince] = useState<Since>("");
  const [methods, setMethods] = useState<string[]>([]);
  const [result, setResult] = useState<"" | "ok" | "err">("");
  const [ip, setIp] = useState("");
  const [page, setPage] = useState(1);
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());

  // Search waits for a pause in typing.
  useEffect(() => {
    const id = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  /** Every filter change starts again from page 1. */
  const refilter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["acp-activity", { category, q, user, since, methods, result, ip, page }],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: "50" });
      if (category) p.set("category", category);
      if (q) p.set("q", q);
      if (user) p.set("user", user);
      if (since) p.set("since", new Date(Date.now() - SINCE_MS[since]).toISOString());
      if (methods.length) p.set("methods", methods.join(","));
      if (result) p.set("result", result);
      if (ip) p.set("ip", ip);
      return api.get(`/admin/activity?${p}`);
    },
    placeholderData: keepPreviousData,
  });
  const { data: facets } = useQuery<Facets>({
    queryKey: ["acp-activity-facets"],
    queryFn: () => api.get("/admin/activity/facets"),
    staleTime: 60_000,
  });

  const days = useMemo(() => toDays(data?.data ?? []), [data]);
  const actors = data?.actors ?? {};
  const targets = data?.targets ?? {};
  const anyFilter = !!(q || user || since || methods.length || result || ip);
  const clearAll = () => { setSearch(""); setQ(""); setUser(""); setSince(""); setMethods([]); setResult(""); setIp(""); setPage(1); };

  const dayLabel = (d: Date) => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400e3);
    const k = dayKey(d);
    return k === dayKey(today) ? t("activity.today") : k === dayKey(yesterday) ? t("activity.yesterday") : null;
  };
  const longDate = (d: Date) => d.toLocaleDateString(i18n.language, { weekday: "long", month: "short", day: "numeric" });

  const pickedUser = facets?.users.find((u) => u.userId === user);
  const sinceLabel: Record<Since, string> = { "": t("activity.anyTime"), "1h": t("activity.lastHour"), "24h": t("activity.last24h"), "7d": t("activity.last7d") };

  /** The actor cell, or the quiet rail when this row continues the previous person's run. */
  const actorCell = (r: ActivityRow, continues: boolean) => {
    if (continues) return <div className="act-actor act-actor--cont" aria-hidden="true" />;
    const a = r.userId ? actors[r.userId] : undefined;
    const name = a?.username ?? r.username;
    const tag = a?.group && a.group.key !== "admin" && a.group.key !== "member" ? a.group.name : null;
    const device = [r.ip, browserOf(r.userAgent)].filter(Boolean).join(" · ");
    return (
      <div className="act-actor">
        <UserAvatar user={{ username: name ?? "?", avatar: a?.avatar ?? null }} size={28} />
        <div className="act-actor__text">
          <div className="act-actor__name">
            {name ? `@${name}` : t("activity.unknownUser")}
            {tag && <span className="act-tag">{tag}</span>}
          </div>
          {device && <div className="act-actor__device" title={r.userAgent ?? undefined}>{device}</div>}
        </div>
      </div>
    );
  };

  const resultCell = (r: ActivityRow) =>
    r.status == null ? <span className="act-result act-result--none">—</span>
      : <span className={`act-result ${r.status >= 400 ? "act-result--err" : "act-result--ok"}`}>{r.status}</span>;

  const visitAction = (r: ActivityRow) => (
    <div className="act-action act-action--visit">
      <span className="act-muted">{t("activity.viewed")}</span>
      <b>{pageName(r.path) ?? r.path}</b>
      <code className="act-path">{r.path}</code>
    </div>
  );

  const actionAction = (r: ActivityRow) => {
    const h = humanize(r.method, r.path, targets);
    const failed = (r.status ?? 0) >= 400;
    return (
      <div className="act-action">
        <div className="act-action__line">
          {r.method && <span className={`act-method act-method--${r.method.toLowerCase()}`}>{r.method}</span>}
          <span className={failed ? "act-verb act-verb--err" : "act-verb"}>{t(`activity.verb.${h.verbKey}`, { area: h.area })}</span>
          {h.target && <b className="act-target">{h.target}</b>}
          {failed && r.error?.message && <span className="act-error">{r.error.message}</span>}
        </div>
        <code className="act-path">{r.path}</code>
      </div>
    );
  };

  const renderRow = (r: ActivityRow, continues: boolean, nested = false) => (
    <div key={r.id} className={`act-row${r.category === "page_visit" ? " act-row--visit" : ""}${nested ? " act-row--nested" : ""}`}>
      <div className="act-time">{time(r.createdAt)}</div>
      {actorCell(r, continues)}
      {r.category === "page_visit" ? visitAction(r) : actionAction(r)}
      <div className="act-cell-result">{resultCell(r)}</div>
    </div>
  );

  const renderFold = (rows: ActivityRow[], continues: boolean) => {
    const id = rows[0]!.id;
    const open = openFolds.has(id);
    const newest = new Date(rows[0]!.createdAt).getTime();
    const oldest = new Date(rows[rows.length - 1]!.createdAt).getTime();
    const min = Math.round((newest - oldest) / 60e3);
    // Oldest first, the way they were walked; a page reopened in a row reads "Users ×3".
    const trail: string[] = [];
    let last = "", times = 0;
    for (const r of rows.slice().reverse()) {
      const name = pageName(r.path) ?? r.path;
      if (name === last) { times++; trail[trail.length - 1] = `${name} ×${times}`; continue; }
      last = name; times = 1; trail.push(name);
    }
    const shown = trail.slice(0, 4);
    const toggle = () => setOpenFolds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    return (
      <div key={`fold-${id}`} className="act-fold">
        <div className="act-row act-row--visit">
          <div className="act-time">
            {time(rows[0]!.createdAt)}
            {min >= 1 && <small>{t("activity.span", { min })}</small>}
          </div>
          {actorCell(rows[0]!, continues)}
          <div className="act-action act-action--visit">
            <span className="act-muted">{t("activity.browsed")}</span>
            <b>{t("activity.pages", { count: rows.length })}</b>
            <span className="act-trail">
              {shown.join(" → ")}
              {trail.length > shown.length && ` ${t("activity.more", { count: trail.length - shown.length })}`}
            </span>
            <button type="button" className="act-fold__toggle" aria-expanded={open} onClick={toggle}>
              {open ? t("activity.hide") : t("activity.show")}
              <FontAwesomeIcon icon={faChevronDown} className={open ? "is-up" : ""} />
            </button>
          </div>
          <div className="act-cell-result"><span className="act-result act-result--none">—</span></div>
        </div>
        {open && rows.map((r) => renderRow(r, true, true))}
      </div>
    );
  };

  const tabs: Array<{ key: "" | Category; label: string; count?: number }> = [
    { key: "", label: t("activity.all"), count: data?.counts.all },
    { key: "acp_action", label: t("activity.acpActions"), count: data?.counts.acp_action },
    { key: "page_visit", label: t("activity.movements"), count: data?.counts.page_visit },
  ];

  return (
    <div className="act">
      <div className="pg-head act-head">
        <div>
          <p className="pg-eyebrow">{t("nav.system")}</p>
          <h1 className="pg-title">{t("nav.activityLog")}</h1>
          <p className="pg-sub">{t("activity.lede")}</p>
        </div>
        <div className="acp-seg acp-seg--auto act-tabs" role="tablist">
          {tabs.map((tab) => (
            <button key={tab.key || "all"} type="button" role="tab" aria-selected={category === tab.key}
              className={category === tab.key ? "is-on" : ""} onClick={() => refilter(setCategory)(tab.key)}>
              {tab.label}{tab.count != null && <span className="act-tabs__n">{tab.count.toLocaleString()}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="act-card">
        <div className="act-bar">
          <label className="act-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("activity.search")} aria-label={t("activity.search")} />
          </label>

          <FilterMenu label={pickedUser ? `@${pickedUser.username}` : t("activity.fUser")} active={!!user}
            onClear={() => refilter(setUser)("")} clearLabel={t("activity.clearFilter")}>
            {(close) => (
              <>
                <MenuOption on={!user} onPick={() => { refilter(setUser)(""); close(); }}>{t("activity.anyUser")}</MenuOption>
                {facets?.users.map((u) => (
                  <MenuOption key={u.userId} on={user === u.userId} onPick={() => { refilter(setUser)(u.userId); close(); }}>
                    <UserAvatar user={u} size={20} /> <span>@{u.username}</span><small>{u.count}</small>
                  </MenuOption>
                ))}
              </>
            )}
          </FilterMenu>

          <FilterMenu label={since ? sinceLabel[since] : t("activity.fDate")} active={!!since}
            onClear={() => refilter(setSince)("")} clearLabel={t("activity.clearFilter")}>
            {(close) => (["", "1h", "24h", "7d"] as Since[]).map((s) => (
              <MenuOption key={s || "any"} on={since === s} onPick={() => { refilter(setSince)(s); close(); }}>{sinceLabel[s]}</MenuOption>
            ))}
          </FilterMenu>

          <FilterMenu label={methods.length ? methods.join(", ") : t("activity.fMethod")} active={methods.length > 0}
            onClear={() => refilter(setMethods)([])} clearLabel={t("activity.clearFilter")}>
            {() => METHODS.map((m) => (
              <MenuOption key={m} on={methods.includes(m)}
                onPick={() => refilter(setMethods)(methods.includes(m) ? methods.filter((x) => x !== m) : [...methods, m])}>
                <span className={`act-method act-method--${m.toLowerCase()}`}>{m}</span>
                <small>{facets?.methods[m] ?? 0}</small>
              </MenuOption>
            ))}
          </FilterMenu>

          <FilterMenu label={result ? t(`activity.${result}`) : t("activity.fResult")} active={!!result}
            onClear={() => refilter(setResult)("")} clearLabel={t("activity.clearFilter")}>
            {(close) => (["", "ok", "err"] as const).map((r) => (
              <MenuOption key={r || "any"} on={result === r} onPick={() => { refilter(setResult)(r); close(); }}>
                {r ? t(`activity.${r}`) : t("activity.anyResult")}
              </MenuOption>
            ))}
          </FilterMenu>

          <FilterMenu label={ip || t("activity.fIp")} active={!!ip}
            onClear={() => refilter(setIp)("")} clearLabel={t("activity.clearFilter")}>
            {(close) => (
              <>
                <MenuOption on={!ip} onPick={() => { refilter(setIp)(""); close(); }}>{t("activity.anyIp")}</MenuOption>
                {facets?.ips.map((x) => (
                  <MenuOption key={x.ip} on={ip === x.ip} onPick={() => { refilter(setIp)(x.ip); close(); }}>
                    <code>{x.ip}</code>
                    {x.usernames.length > 0 && <span className="act-muted">{x.usernames.map((n) => `@${n}`).join(", ")}</span>}
                    <small>{x.count}</small>
                  </MenuOption>
                ))}
              </>
            )}
          </FilterMenu>

          {anyFilter && <button type="button" className="act-clear-all" onClick={clearAll}>{t("activity.clearAll")}</button>}
        </div>

        <div className="act-row act-row--head" aria-hidden="true">
          <div>{t("activity.colTime")}</div>
          <div>{t("activity.colActor")}</div>
          <div>{t("activity.colAction")}</div>
          <div className="act-cell-result">{t("activity.colResult")}</div>
        </div>

        {isLoading ? (
          <div className="act-empty">{t("activity.loading")}</div>
        ) : days.length === 0 ? (
          <div className="act-empty">{anyFilter || category ? t("activity.noMatch") : t("activity.empty")}</div>
        ) : days.map((day) => {
          let prevUser: string | null | undefined;
          return (
            <section key={day.key} className="act-day">
              <header className="act-day__head">
                <span>
                  {dayLabel(day.date) && <b>{dayLabel(day.date)}</b>}
                  <span>{longDate(day.date)}</span>
                </span>
                <small>{t("activity.entries", { count: day.count })}</small>
              </header>
              {day.items.map((item) => {
                const first = item.kind === "row" ? item.row : item.rows[0]!;
                const continues = prevUser !== undefined && first.userId === prevUser;
                prevUser = first.userId;
                return item.kind === "row" ? renderRow(item.row, continues) : renderFold(item.rows, continues);
              })}
            </section>
          );
        })}

        {data?.meta && data.meta.total > 0 && (
          <Pager page={page} totalPages={data.meta.totalPages} onPage={setPage}
            label={t("activity.pagination", { page: data.meta.page, totalPages: data.meta.totalPages, total: data.meta.total.toLocaleString() })} />
        )}
      </div>
    </div>
  );
}

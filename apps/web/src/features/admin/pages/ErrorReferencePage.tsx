/**
 * ACP → System → Error reference: a member sends you a code, you find out what it
 * means AND what happened to them.
 *
 * Type the code (suggestions as you type) and, optionally, who sent it. The answer
 * is the code's documentation — what happened, the likely cause, how to fix it, with
 * buttons to the ACP pages the fix names — and below it what the server actually
 * logged for that code in the last seven days: that member's occurrences, or
 * everyone's, each with its request context. With nothing typed, the codes the
 * server logged most recently are listed, because that is usually the one.
 *
 * `?code=` (and `?member=`) deep-link straight to an answer; the fatal-error overlay
 * links here that way.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faArrowRight, faChevronDown, faMagnifyingGlass, faUser, faXmark } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { UserAvatar } from "../../../components/UserAvatar";
import { useAcpNav } from "../useAcpNav";
import "./ErrorReferencePage.scss";
import { Button } from "../../../components/AcpControls";

interface XecEntry {
  msg:    string;
  desc:   string;
  cause:  string;
  fix:    string;
  sev:    "Error" | "Warning" | "Info" | "Critical";
  domain: string;
}

/**
 * Structural metadata for each core XEC code: severity (drives the badge colour)
 * and domain (drives filtering). The human-readable text — msg/desc/cause/fix —
 * lives in the `acp` locale bundle under `errorRef.codes.<CODE>` and is resolved
 * per language at render time (see `coreCatalog` below). Plugin-registered codes
 * arrive fully-formed from the server and are merged in as-is.
 */
const META: Record<string, { sev: XecEntry["sev"]; domain: string }> = {
  // API
  "XEC-API-4001": { sev:"Warning", domain:"API" },
  "XEC-API-4003": { sev:"Warning", domain:"API" },
  "XEC-API-4004": { sev:"Info", domain:"API" },
  "XEC-API-4009": { sev:"Warning", domain:"API" },
  "XEC-API-4290": { sev:"Warning", domain:"API" },
  "XEC-API-5000": { sev:"Error", domain:"API" },
  // Auth
  "XEC-AUTH-1001": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-1002": { sev:"Info", domain:"Auth" },
  "XEC-AUTH-1003": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-1004": { sev:"Error", domain:"Auth" },
  "XEC-AUTH-1005": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-1006": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-2001": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-2002": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-2003": { sev:"Warning", domain:"Auth" },
  "XEC-AUTH-1007": { sev:"Warning", domain:"Auth" },
  // Permissions
  "XEC-PERM-1001": { sev:"Warning", domain:"Permissions" },
  "XEC-PERM-1040": { sev:"Warning", domain:"Permissions" },
  "XEC-PERM-1041": { sev:"Warning", domain:"Permissions" },
  "XEC-PERM-1042": { sev:"Warning", domain:"Permissions" },
  // Articles
  "XEC-ARTICLE-3001": { sev:"Info", domain:"Articles" },
  "XEC-ARTICLE-3002": { sev:"Info", domain:"Articles" },
  "XEC-ARTICLE-3003": { sev:"Warning", domain:"Articles" },
  // Storage
  "XEC-STORE-7001": { sev:"Warning", domain:"Storage" },
  "XEC-STORE-7002": { sev:"Warning", domain:"Storage" },
  "XEC-STORE-7003": { sev:"Warning", domain:"Storage" },
  "XEC-STORE-7004": { sev:"Error", domain:"Storage" },
  // Plugin
  "XEC-PLUGIN-2001": { sev:"Error", domain:"Plugin Engine" },
  "XEC-PLUGIN-2002": { sev:"Error", domain:"Plugin Engine" },
  "XEC-PLUGIN-2003": { sev:"Warning", domain:"Plugin Engine" },
  "XEC-PLUGIN-2004": { sev:"Warning", domain:"Plugin Engine" },
  "XEC-PLUGIN-2005": { sev:"Warning", domain:"Plugin Engine" },
  "XEC-PLUGIN-2006": { sev:"Info", domain:"Plugin Engine" },
  "XEC-PLUGIN-2010": { sev:"Error", domain:"Plugin Engine" },
  "XEC-PLUGIN-2011": { sev:"Error", domain:"Plugin Engine" },
  "XEC-PLUGIN-2012": { sev:"Error", domain:"Plugin Engine" },
  "XEC-PLUGIN-2013": { sev:"Error", domain:"Plugin Engine" },
  "XEC-PLUGIN-2020": { sev:"Info", domain:"Plugin Engine" },
  "XEC-PLUGIN-2030": { sev:"Error", domain:"Plugin Engine" },
  // Core
  "XEC-CORE-8001": { sev:"Error", domain:"Core" },
  "XEC-CORE-8002": { sev:"Warning", domain:"Core" },
  "XEC-CORE-8010": { sev:"Info", domain:"Core" },
  // Legal documents
  "XEC-LEGAL-3501": { sev:"Info", domain:"Legal" },
  "XEC-LEGAL-3502": { sev:"Warning", domain:"Legal" },
  // Queue / background jobs
  "XEC-QUEUE-5000": { sev:"Error", domain:"Queue" },
  "XEC-QUEUE-5001": { sev:"Warning", domain:"Queue" },
  // License / Marketplace
  "XEC-LICENSE-9001": { sev:"Warning", domain:"License" },
  "XEC-LICENSE-9002": { sev:"Warning", domain:"License" },
  "XEC-LICENSE-9003": { sev:"Warning", domain:"License" },
  "XEC-LICENSE-9004": { sev:"Warning", domain:"License" },
  "XEC-LICENSE-9005": { sev:"Info", domain:"License" },
  "XEC-LICENSE-9006": { sev:"Error", domain:"License" },
  "XEC-LICENSE-9007": { sev:"Warning", domain:"License" },
  "XEC-LICENSE-9008": { sev:"Warning", domain:"License" },
  "XEC-LICENSE-9009": { sev:"Warning", domain:"License" },
};

type Entry = XecEntry & { code: string };

interface Occurrence {
  id: string;
  method: string | null;
  url: string | null;
  requestId: string | null;
  context: unknown;
  createdAt: string;
  user: { username: string; avatar: string | null } | null;
}
interface Lookup {
  member: { id: string; username: string } | null;
  counts: { all: number; mine: number; people: number };
  items: Occurrence[];
}
interface RecentCode { code: string; lastAt: string; count24h: number; username: string | null }

const DAY = 86400e3;

/** "4 min ago" — the relative half of an occurrence's time. */
function useAgo() {
  const { t } = useTranslation("acp");
  return (iso: string) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return t("errorRef.ago.now");
    if (s < 3600) return t("errorRef.ago.min", { count: Math.round(s / 60) });
    if (s < 86400) return t("errorRef.ago.hour", { count: Math.round(s / 3600) });
    return t("errorRef.ago.day", { count: Math.round(s / 86400) });
  };
}

/**
 * The ACP pages a fix names ("Check ACP → System → Error Log."), as links: the last
 * step of each path, matched against the nav's own labels in the admin's language.
 * A step that names no page is simply not a button.
 */
function useFixLinks(fix: string): Array<{ to: string; label: string }> {
  const nav = useAcpNav();
  const { t } = useTranslation("acp");
  return useMemo(() => {
    const pages = nav.flatMap((n) => [
      ...(n.to ? [{ to: n.to, label: t(n.label) }] : []),
      ...(n.children ?? []).map((c) => ({ to: c.to, label: t(c.label) })),
    ]);
    const out: Array<{ to: string; label: string }> = [];
    for (const m of fix.matchAll(/ACP → ([^.,;]+)/g)) {
      const last = m[1]!.split(" → ").pop()!.trim().toLowerCase();
      const hit = pages
        .filter((p) => last === p.label.toLowerCase() || last.startsWith(`${p.label.toLowerCase()} `))
        .sort((a, b) => b.label.length - a.label.length)[0];
      if (hit && !out.some((o) => o.to === hit.to)) out.push(hit);
    }
    return out;
  }, [fix, nav, t]);
}

export function ErrorReferencePage() {
  const { t, i18n } = useTranslation("acp");
  const [params, setParams] = useSearchParams();
  const ago = useAgo();

  // Plugin-registered XEC codes arrive fully worded from the server.
  const { data: rawPluginCodes } = useQuery<Record<string, XecEntry>[]>({
    queryKey: ["admin-xec-codes"],
    queryFn:  () => api.get<Record<string, XecEntry>[]>("/admin/xec-codes").catch(() => [] as Record<string, XecEntry>[]),
    staleTime: 300_000,
  });

  const sevLabel    = (s: string) => t(`errorRef.sev.${s}`,     { defaultValue: s });
  const domainLabel = (d: string) => t(`errorRef.domains.${d}`, { defaultValue: d });

  // Core catalogue: structural META + per-language text from the acp bundle.
  const catalog: Entry[] = useMemo(() => {
    const core = Object.entries(META).map(([code, m]) => ({
      code, sev: m.sev, domain: m.domain,
      msg:   t(`errorRef.codes.${code}.msg`),
      desc:  t(`errorRef.codes.${code}.desc`, { defaultValue: "" }),
      cause: t(`errorRef.codes.${code}.cause`, { defaultValue: "" }),
      fix:   t(`errorRef.codes.${code}.fix`, { defaultValue: "" }),
    }));
    const plugin = (rawPluginCodes ?? []) as unknown as Entry[];
    const map = new Map<string, Entry>(core.map((e) => [e.code, e]));
    for (const p of plugin) map.set(p.code, p);
    return [...map.values()];
  }, [t, rawPluginCodes]);

  // The question asked — from the URL, so a lookup can be linked and survives a reload.
  const query = { code: (params.get("code") ?? "").toUpperCase().trim(), member: (params.get("member") ?? "").trim() };
  const [code, setCode] = useState(query.code);
  const [member, setMember] = useState(query.member);
  const [focus, setFocus] = useState(false);
  const [hi, setHi] = useState(0);
  const [scope, setScope] = useState<"member" | "all">("member");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Follow the URL when it changes underneath (a deep link, back/forward).
  useEffect(() => { setCode(query.code); setMember(query.member); }, [query.code, query.member]);

  const run = (c = code, m = member) => {
    const next = new URLSearchParams();
    const cc = c.toUpperCase().trim();
    if (cc) next.set("code", cc);
    if (cc && m.trim()) next.set("member", m.trim());
    setParams(next);
    setScope(m.trim() ? "member" : "all");
    setOpen({});
    setFocus(false);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); run(); };

  const typed = code.toUpperCase().trim();
  const suggestions = typed && !catalog.some((e) => e.code === typed)
    ? catalog.filter((e) => e.code.includes(typed) || e.msg.toUpperCase().includes(typed)).slice(0, 6)
    : [];
  const showSuggest = focus && suggestions.length > 0;

  const hit = query.code ? catalog.find((e) => e.code === query.code) : undefined;

  const recent = useQuery<RecentCode[]>({
    queryKey: ["acp-error-ref", "recent"],
    queryFn: () => api.get("/admin/error-log/recent-codes"),
    enabled: !query.code,
  });
  const lookup = useQuery<Lookup>({
    queryKey: ["acp-error-ref", "lookup", query.code, query.member, scope],
    queryFn: () => {
      const p = new URLSearchParams({ code: query.code, scope, range: "7d" });
      if (query.member) p.set("member", query.member);
      return api.get(`/admin/error-log/lookup?${p}`);
    },
    enabled: !!hit,
  });
  // The newest occurrence opens on its own: it is the one the member just hit.
  const firstId = lookup.data?.items[0]?.id;
  useEffect(() => { if (firstId) setOpen((o) => (Object.keys(o).length ? o : { [firstId]: true })); }, [firstId]);

  const fixLinks = useFixLinks(hit?.fix ?? "");

  const when = (iso: string) => {
    const d = new Date(iso);
    const day = Date.now() - d.getTime() < DAY && d.getDate() === new Date().getDate() ? t("errorRef.today")
      : new Date(Date.now() - DAY).toDateString() === d.toDateString() ? t("errorRef.yesterday")
      : d.toLocaleDateString(i18n.language, { day: "2-digit", month: "2-digit" });
    return `${day}, ${d.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${ago(iso)}`;
  };

  const occurrences = () => {
    const data = lookup.data;
    if (!hit) return null;
    const hasMember = !!query.member;
    const name = data?.member?.username ?? query.member;
    const showMine = hasMember && scope === "member";
    const all = data?.counts.all ?? 0;
    const mine = data?.counts.mine ?? 0;
    const people = data?.counts.people ?? 0;
    const latestMine = showMine ? data?.items[0] : undefined;
    const summary = !data ? "" : hasMember
      ? mine
        ? t("errorRef.occ.memberSummary", { name, times: t("errorRef.times", { count: mine }), ago: latestMine ? ago(latestMine.createdAt) : "", total: t("errorRef.times", { count: all }), people: t("errorRef.people", { count: people }) })
        : t("errorRef.occ.memberNone", { name }) + (all ? ` ${t("errorRef.occ.othersHad", { times: t("errorRef.times", { count: all }) })}` : "")
      : all
        ? t("errorRef.occ.allSummary", { times: t("errorRef.times", { count: all }), people: t("errorRef.people", { count: people }) })
        : t("errorRef.occ.allNone");
    const emptyText = hit.sev === "Error" || hit.sev === "Critical" ? t("errorRef.occ.emptyError") : t("errorRef.occ.emptyQuiet");
    const logLink = showMine
      ? { to: `/admin/error-log?user=${encodeURIComponent(name)}&status=all`, label: t("errorRef.occ.allByMember", { name }) }
      : { to: `/admin/error-log?q=${encodeURIComponent(hit.code)}&status=all`, label: t("errorRef.occ.allWithCode", { code: hit.code }) };

    return (
      <section className="xr-card xr-occ">
        <div className="xr-occ__head">
          <h2>{t("errorRef.occ.title")}</h2>
          {hasMember && (
            <div className="acp-seg acp-seg--auto" role="tablist">
              <button type="button" role="tab" aria-selected={scope === "member"} className={scope === "member" ? "is-on" : ""} onClick={() => setScope("member")}>
                {name} · {mine}
              </button>
              <button type="button" role="tab" aria-selected={scope === "all"} className={scope === "all" ? "is-on" : ""} onClick={() => setScope("all")}>
                {t("errorRef.occ.everyone")} · {all}
              </button>
            </div>
          )}
        </div>
        <p className="xr-occ__summary">{lookup.isLoading ? t("errorRef.loading") : summary}</p>

        {data && data.items.length === 0 && <p className="xr-occ__empty">{emptyText}</p>}
        {data && data.items.length > 0 && (
          <ul className="xr-occ__list">
            {data.items.map((o) => {
              const isOpen = !!open[o.id];
              return (
                <li key={o.id} className="xr-occ__item">
                  {o.user ? <UserAvatar user={o.user} size={32} /> : <span className="xr-guest" aria-hidden>?</span>}
                  <div className="xr-occ__main">
                    <div className="xr-occ__top">
                      <b>{o.user?.username ?? t("errorRef.guest")}</b>
                      <span>{when(o.createdAt)}</span>
                      <button type="button" className="xr-occ__toggle" aria-expanded={isOpen}
                        onClick={() => setOpen((s) => ({ ...s, [o.id]: !s[o.id] }))}>
                        {isOpen ? t("errorRef.occ.hideContext") : t("errorRef.occ.context")}
                        <FontAwesomeIcon icon={faChevronDown} className={isOpen ? "is-up" : ""} />
                      </button>
                    </div>
                    {o.url && <code className="xr-occ__url">{[o.method, o.url].filter(Boolean).join(" ")}</code>}
                    {o.requestId && <span className="xr-occ__meta">{t("errorRef.occ.request", { id: o.requestId })}</span>}
                    {isOpen && <pre className="xr-occ__ctx">{JSON.stringify(o.context ?? {}, null, 2)}</pre>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Link to={logLink.to} className="xr-occ__foot">{logLink.label} <FontAwesomeIcon icon={faArrowRight} /></Link>
      </section>
    );
  };

  // Codes that share the unknown code's prefix, nearest number first.
  const similar = (c: string) => {
    const [x, d, n] = c.split("-");
    const num = parseInt(n ?? "0", 10) || 0;
    return catalog.filter((e) => e.code.startsWith(`${x}-${d}-`))
      .sort((a, b) => Math.abs(parseInt(a.code.split("-")[2]!, 10) - num) - Math.abs(parseInt(b.code.split("-")[2]!, 10) - num))
      .slice(0, 4);
  };

  return (
    <div className="xr">
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("nav.system")}</p>
          <h1 className="pg-title">{t("errorRef.title")}</h1>
        </div>
      </div>

      <form className="xr-form" onSubmit={submit}>
        <div className="xr-fields">
          <div className="xr-field xr-field--code">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input value={code} placeholder={t("errorRef.lookupPlaceholder")} aria-label={t("errorRef.lookupTitle")}
              spellCheck={false} autoComplete="off"
              onChange={(e) => { setCode(e.target.value); setFocus(true); setHi(0); }}
              onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
              onKeyDown={(e) => {
                if (!showSuggest) return;
                if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, suggestions.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); const s = suggestions[hi]!; setCode(s.code); run(s.code); }
                else if (e.key === "Escape") setFocus(false);
              }} />
            {code && (
              <button type="button" className="xr-clear" aria-label={t("errorRef.clear")}
                onClick={() => { setCode(""); setParams(new URLSearchParams()); }}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            )}
            {showSuggest && (
              <ul className="xr-suggest" role="listbox">
                {suggestions.map((s, i) => (
                  <li key={s.code} role="option" aria-selected={i === hi}>
                    <button type="button" className={i === hi ? "is-on" : ""}
                      onMouseDown={(e) => { e.preventDefault(); setCode(s.code); run(s.code); }}>
                      <code>{s.code}</code><span>{s.msg}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="xr-field">
            <FontAwesomeIcon icon={faUser} />
            <input value={member} placeholder={t("errorRef.memberPlaceholder")} aria-label={t("errorRef.memberPlaceholder")}
              autoComplete="off" spellCheck={false} onChange={(e) => setMember(e.target.value)} />
          </label>
        </div>
        <Button className="xr-submit" disabled={!code.trim()}>{t("errorRef.lookupBtn")}</Button>
      </form>

      {!query.code && (
        <section className="xr-card">
          <h2 className="xr-card__title">{t("errorRef.recent.title")}</h2>
          <p className="xr-card__lede">{t("errorRef.recent.lede")}</p>
          {recent.data && recent.data.length === 0 && <p className="xr-occ__empty">{t("errorRef.recent.none")}</p>}
          <ul className="xr-list">
            {(recent.data ?? []).map((r) => (
              <li key={r.code}>
                <button type="button" onClick={() => { setCode(r.code); run(r.code, ""); }}>
                  <code>{r.code}</code>
                  <span className="xr-list__msg">{catalog.find((c) => c.code === r.code)?.msg ?? ""}</span>
                  <span className="xr-list__meta">
                    {t("errorRef.recent.meta", { ago: ago(r.lastAt), who: r.username ?? t("errorRef.guest") })}
                    {r.count24h > 1 && ` · ${t("errorRef.recent.day", { count: r.count24h })}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {query.code && !hit && (
        <section className="xr-card">
          <h2 className="xr-card__title">{t("errorRef.unknown.title")}</h2>
          <p className="xr-card__lede"><code className="xr-code">{query.code}</code> {t("errorRef.unknown.body")}</p>
          {similar(query.code).length > 0 && (
            <>
              <h3 className="xr-sub">{t("errorRef.unknown.didYouMean")}</h3>
              <ul className="xr-list">
                {similar(query.code).map((e) => (
                  <li key={e.code}>
                    <button type="button" onClick={() => { setCode(e.code); run(e.code); }}>
                      <code>{e.code}</code><span className="xr-list__msg">{e.msg}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {hit && (
        <>
          <section className="xr-card xr-doc">
            <p className="xr-doc__meta">
              <code>{hit.code}</code> · <span>{domainLabel(hit.domain)}</span> · <span className={`xr-sev xr-sev--${hit.sev.toLowerCase()}`}>{sevLabel(hit.sev)}</span>
            </p>
            <h2 className="xr-doc__title">{hit.msg}</h2>
            {hit.desc ? (
              <>
                <h3 className="xr-sub">{t("errorRef.whatHappened")}</h3>
                <p>{hit.desc}</p>
                {hit.cause && <><h3 className="xr-sub">{t("errorRef.likelyCause")}</h3><p>{hit.cause}</p></>}
                {hit.fix && <><h3 className="xr-sub">{t("errorRef.suggestedFix")}</h3><p>{hit.fix}</p></>}
                {fixLinks.length > 0 && (
                  <div className="xr-doc__links">
                    {fixLinks.map((l) => (
                      <Link key={l.to} to={l.to} className="btn-ghost btn-sm">{t("errorRef.openPage", { page: l.label })} <FontAwesomeIcon icon={faArrowRight} /></Link>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="xr-card__lede">{t("errorRef.noText")}</p>
            )}
          </section>
          {occurrences()}
        </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { faMagnifyingGlass, faRotateRight, faTrash, faUser, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { api } from "../../../lib/api";
import { apiErrorMessage } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import {
  PAGE_SIZE, type GroupStatus, type GroupsResponse, type Range, type Severity, type StatsResponse,
} from "./errorLog/errorLogModel";
import { Overview } from "./errorLog/Overview";
import { GroupTable } from "./errorLog/GroupTable";
import { ErrorDrawer } from "./errorLog/ErrorDrawer";
import "./errorLog/ErrorLog.scss";

const STATUSES: GroupStatus[] = ["open", "resolved", "all"];

/** Re-render every 30s so "updated N min ago" keeps moving. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

export function ErrorLogPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [domain, setDomain] = useState("");
  // A link can arrive with a search, a member and a status (the error reference's
  // "All entries by … in the error log"); they are read once, then the page owns them.
  const [queryInput, setQueryInput] = useState(() => params.get("q") ?? "");
  const [query, setQuery] = useState(() => (params.get("q") ?? "").trim());
  const [member, setMember] = useState(() => params.get("user") ?? "");
  const [status, setStatus] = useState<GroupStatus>(() => {
    const s = params.get("status") as GroupStatus | null;
    return s && STATUSES.includes(s) ? s : "open";
  });
  const [range, setRange] = useState<Range>("24h");
  const [page, setPage] = useState(1);
  const selectedKey = params.get("group");
  const now = useNow();

  // Search waits for a pause in typing.
  useEffect(() => {
    const id = setTimeout(() => setQuery(queryInput.trim()), 250);
    return () => clearTimeout(id);
  }, [queryInput]);
  // Any filter change starts over at page 1.
  useEffect(() => setPage(1), [severity, domain, query, status, member]);

  const stats = useQuery<StatsResponse>({
    queryKey: ["acp-error-log", "stats", range],
    queryFn: () => api.get(`/admin/error-log/stats?range=${range}&tzOffset=${new Date().getTimezoneOffset()}`),
  });
  const groups = useQuery<GroupsResponse>({
    queryKey: ["acp-error-log", "groups", severity, domain, query, status, member, page],
    queryFn: () => {
      const p = new URLSearchParams({ status, page: String(page), pageSize: String(PAGE_SIZE) });
      if (severity) p.set("severity", severity);
      if (domain) p.set("domain", domain);
      if (query) p.set("q", query);
      if (member) p.set("user", member);
      return api.get(`/admin/error-log/groups?${p}`);
    },
    placeholderData: (prev) => prev,
  });

  const select = (key: string | null) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (key) n.set("group", key); else n.delete("group");
    return n;
  }, { replace: true });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["acp-error-log"] });
    toast.success(t("errorLog.refreshed"));
  };

  const sevLabel = (s: Severity) => t(`errorLog.sev.${s}`);
  const clearMut = useMutation({
    mutationFn: () => api.delete(`/admin/error-log${severity ? `?severity=${severity}` : ""}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["acp-error-log"] });
      select(null);
      toast.success(t("errorLog.cleared"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const handleClear = async () => {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: severity ? t("errorLog.confirmSeverity", { severity: sevLabel(severity) }) : t("errorLog.confirmAll"),
      body: t("errorLog.confirmBody"),
      confirmText: t("errorLog.confirmBtn"),
      cancelText: t("errorLog.cancel"),
    });
    if (ok) clearMut.mutate();
  };

  // Dev-only: trigger a real backend error to check the log and the fatal-halt
  // overlay. Mirrors GET /admin/_debug/throw, which production never mounts.
  const simulate = async (type: "critical" | "xentium500" | "notfound") => {
    try { await api.get(`/admin/_debug/throw?type=${type}`); }
    catch (e) { if (type === "notfound") toast.error(apiErrorMessage(e)); }
    void qc.invalidateQueries({ queryKey: ["acp-error-log"] });
  };

  const updatedAgo = Math.floor((now - Math.max(stats.dataUpdatedAt, groups.dataUpdatedAt)) / 60_000);
  const counts = groups.data?.counts;
  const meta = groups.data?.meta;
  const filtered = !!(severity || domain || query || status !== "open");
  const resetFilters = () => { setSeverity(null); setDomain(""); setQueryInput(""); setQuery(""); setStatus("open"); };
  const domains = useMemo(() => stats.data?.domains ?? [], [stats.data]);

  return (
    <div className={`el-shell${selectedKey ? " has-drawer" : ""}`}>
      <div className="el-page">
        <div className="pg-head el-head">
          <div>
            <p className="pg-eyebrow">{t("nav.system")}</p>
            <h1 className="pg-title">{t("errorLog.title")}</h1>
            {stats.data && (
              <p className="el-head__sub">
                {t("errorLog.summary", { count: stats.data.totalEntries, groups: stats.data.totalGroups })}
                {stats.data.retentionDays > 0 && <> · {t("errorLog.retention", { count: stats.data.retentionDays })}</>}
              </p>
            )}
          </div>
          <div className="el-head__actions">
            <span className="el-updated">{updatedAgo < 1 ? t("errorLog.updatedNow") : t("errorLog.updatedAgo", { count: updatedAgo })}</span>
            <button type="button" className="btn-ghost btn-sm" onClick={() => void refresh()}>
              <FontAwesomeIcon icon={faRotateRight} className="el-ic" /> {t("errorLog.refresh")}
            </button>
            <button type="button" className="btn-ghost btn-sm el-btn-danger" onClick={() => void handleClear()} disabled={clearMut.isPending}>
              <FontAwesomeIcon icon={faTrash} className="el-ic" /> {severity ? t("errorLog.clearSeverity", { severity: sevLabel(severity) }) : t("errorLog.clearLog")}
            </button>
          </div>
        </div>

        {import.meta.env.DEV && (
          <div className="el-dev">
            <span>{t("errorLog.dev.label")}</span>
            <button type="button" className="btn-ghost btn-sm" title={t("errorLog.dev.crash")} onClick={() => void simulate("critical")}>500</button>
            <button type="button" className="btn-ghost btn-sm" title={t("errorLog.dev.xec")} onClick={() => void simulate("xentium500")}>XEC 500</button>
            <button type="button" className="btn-ghost btn-sm" title={t("errorLog.dev.notFound")} onClick={() => void simulate("notfound")}>404</button>
          </div>
        )}

        <Overview stats={stats.data} range={range} onRange={setRange} severity={severity}
          onSeverity={(s) => setSeverity((cur) => (cur === s ? null : s))} />

        <div className="el-filters">
          <label className="el-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="el-ic" />
            <input value={queryInput} onChange={(e) => setQueryInput(e.target.value)} placeholder={t("errorLog.searchPlaceholder")} />
            {queryInput && (
              <button type="button" className="el-search__clear" aria-label={t("errorLog.clearSearch")} onClick={() => setQueryInput("")}>
                <FontAwesomeIcon icon={faXmark} className="el-ic" />
              </button>
            )}
          </label>
          {member && (
            <button type="button" className="el-member" onClick={() => setMember("")} aria-label={t("errorLog.clearMember", { name: member })}>
              <FontAwesomeIcon icon={faUser} className="el-ic" /> {member} <FontAwesomeIcon icon={faXmark} className="el-ic" />
            </button>
          )}
          <select className="acp-select el-select" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label={t("errorLog.allDomains")}>
            <option value="">{t("errorLog.allDomains")}</option>
            {domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <div className="el-seg" role="tablist">
            {STATUSES.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} className={status === s ? "is-on" : ""} onClick={() => setStatus(s)}>
                {t(`errorLog.status.${s}`)} {counts && <span className="el-seg__n">{counts[s]}</span>}
              </button>
            ))}
          </div>
          {severity && (
            <button type="button" className="el-chip" onClick={() => setSeverity(null)}>
              {t("errorLog.severityChip", { severity: sevLabel(severity) })} <FontAwesomeIcon icon={faXmark} className="el-ic" />
            </button>
          )}
        </div>

        <GroupTable
          loading={groups.isLoading}
          items={groups.data?.items ?? []}
          selectedKey={selectedKey}
          dimResolved={status !== "resolved"}
          onSelect={(k) => select(k === selectedKey ? null : k)}
          onReset={filtered ? resetFilters : undefined}
        />

        {meta && meta.total > 0 && (
          <div className="el-pager">
            <span>{t("errorLog.pageRange", {
              from: (meta.page - 1) * meta.limit + 1,
              to: Math.min(meta.page * meta.limit, meta.total),
              count: meta.total,
            })}</span>
            <div className="el-pager__nav">
              <button type="button" className="btn-ghost btn-sm" disabled={meta.page <= 1} onClick={() => setPage(meta.page - 1)}>{t("errorLog.prev")}</button>
              <span>{meta.page} / {meta.totalPages}</span>
              <button type="button" className="btn-ghost btn-sm" disabled={meta.page >= meta.totalPages} onClick={() => setPage(meta.page + 1)}>{t("errorLog.next")}</button>
            </div>
          </div>
        )}
      </div>

      {selectedKey && <ErrorDrawer groupKey={selectedKey} onClose={() => select(null)} />}
    </div>
  );
}

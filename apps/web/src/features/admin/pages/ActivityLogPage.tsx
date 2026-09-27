import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { Pager } from "../../../components/Pager";
import type { PaginatedResponse } from "@xentium/contracts";

interface ActivityRow {
  id: string;
  category: "page_visit" | "acp_action";
  userId: string | null;
  username: string | null;
  method: string | null;
  path: string;
  status: number | null;
  ip: string | null;
  createdAt: string;
}

const COLS = "150px 150px 120px 1fr 70px 120px";

function fmt(d: string) {
  return new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ActivityLogPage() {
  const { t } = useTranslation("acp");
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("");

  const { data, isLoading } = useQuery<PaginatedResponse<ActivityRow>>({
    queryKey: ["acp-activity", page, category],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: "30" });
      if (category) p.set("category", category);
      return api.get(`/admin/activity?${p}`);
    },
  });

  const meta = data?.meta;

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.system")}</div>
          <h1 className="acp-page-title">{t("nav.activityLog")}</h1>
        </div>
        <select
          className="acp-select"
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPage(1); }}
          style={{ width: "auto" }}
        >
          <option value="">{t("activity.all")}</option>
          <option value="page_visit">{t("activity.movements")}</option>
          <option value="acp_action">{t("activity.acpActions")}</option>
        </select>
      </div>

      <div className="acp-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="acp-list-head" style={{ gridTemplateColumns: COLS }}>
          <div>{t("activity.colTime")}</div>
          <div>{t("activity.colUser")}</div>
          <div>{t("activity.colCategory")}</div>
          <div>{t("activity.colPath")}</div>
          <div style={{ textAlign: "center" }}>{t("activity.colStatus")}</div>
          <div>{t("activity.colIp")}</div>
        </div>

        {isLoading ? (
          <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--c-fg-muted)", fontSize: "var(--fs-md)" }}>{t("activity.loading")}</div>
        ) : (
          <div>
            {data?.data.map((r) => (
              <div key={r.id} className="acp-list-row" style={{ gridTemplateColumns: COLS, alignItems: "center" }}>
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-fg-muted)" }}>{fmt(r.createdAt)}</div>
                <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>{r.username ? `@${r.username}` : "—"}</div>
                <div>
                  <span style={{
                    fontSize: "var(--fs-2xs)", fontWeight: 700, borderRadius: 100, padding: "2px 8px",
                    color: r.category === "acp_action" ? "var(--c-accent)" : "var(--c-fg-muted)",
                    background: r.category === "acp_action" ? "var(--c-accent-soft)" : "var(--c-surface)",
                  }}>
                    {t(r.category === "acp_action" ? "activity.acpActions" : "activity.movements")}
                  </span>
                </div>
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.method && <b style={{ color: "var(--c-fg-muted)", marginRight: 6 }}>{r.method}</b>}
                  <code>{r.path}</code>
                </div>
                <div style={{ textAlign: "center", fontSize: "var(--fs-xs)", fontWeight: 700, color: (r.status ?? 0) >= 400 ? "var(--c-danger)" : "var(--c-fg-muted)" }}>
                  {r.status ?? "—"}
                </div>
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-fg-muted)" }}>{r.ip ?? "—"}</div>
              </div>
            ))}
            {data?.data.length === 0 && (
              <div style={{ padding: "3rem", textAlign: "center", color: "var(--c-fg-muted)", fontSize: "var(--fs-md)" }}>{t("activity.empty")}</div>
            )}
          </div>
        )}

        {meta && (
          <Pager page={page} totalPages={meta.totalPages} onPage={setPage}
            label={t("activity.pagination", { page: meta.page, totalPages: meta.totalPages, total: meta.total })} />
        )}
      </div>
    </div>
  );
}

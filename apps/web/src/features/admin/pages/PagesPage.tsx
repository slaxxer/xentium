import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faArrowUpRightFromSquare, faTrash, faPlus, faPen,
} from "@fortawesome/free-solid-svg-icons";
import { pagesApi, pagePath, type PageListItem } from "../../../lib/pagesApi";
import { Pager } from "../../../components/Pager";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";

const STATUS_COLORS: Record<string, [string, string]> = {
  draft:     ["var(--c-fg-muted)", "var(--c-surface)"],
  published: ["var(--c-success)",  "rgba(52,211,153,.12)"],
};

const COLS = "1fr 220px 110px 100px 90px 110px";

const ICON_BTN: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 28, height: 28, fontSize: "var(--fs-xs)", color: "var(--c-fg-muted)",
  border: "1px solid var(--c-border)", borderRadius: "var(--radius-sm)",
  background: "transparent", cursor: "pointer", textDecoration: "none",
};

const ICON_BTN_DANGER: React.CSSProperties = {
  ...ICON_BTN, color: "var(--c-danger)", border: "1px solid rgba(248,113,113,.3)",
};

export function PagesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [page, setPage]     = useState(1);
  const [status, setStatus] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["acp-pages", page, status],
    queryFn: () => pagesApi.list({ page, limit: 20, status: (status || undefined) as never }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => pagesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-pages"] });
      swalToast(t("pages.toastDeleted"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  async function handleDelete(p: PageListItem) {
    const r = await swalConfirm(
      t("pages.deleteTitle"),
      t("pages.deleteText", { title: p.title }),
      t("pages.delete"), t("common:actions.cancel"),
    );
    if (r) deleteMutation.mutate(p.id);
  }

  const meta = data?.meta;

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.content")}</div>
          <h1 className="acp-page-title">{t("nav.pages")}</h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select
            className="acp-select"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            style={{ width: "auto" }}
          >
            <option value="">{t("pages.statusAll")}</option>
            <option value="draft">{t("pages.status.draft")}</option>
            <option value="published">{t("pages.status.published")}</option>
          </select>
          <Link to="/pages/new" className="btn btn--sm">
            <FontAwesomeIcon icon={faPlus} /> {t("pages.newPage")}
          </Link>
        </div>
      </div>

      <div className="acp-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="acp-list-head" style={{ gridTemplateColumns: COLS }}>
          <div>{t("pages.colTitle")}</div>
          <div>{t("pages.colSlug")}</div>
          <div>{t("pages.colStatus")}</div>
          <div>{t("pages.colVisibility")}</div>
          <div style={{ textAlign: "center" }}>{t("pages.colInNav")}</div>
          <div />
        </div>

        {isLoading ? (
          <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--c-fg-muted)", fontSize: "var(--fs-md)" }}>
            {t("pages.loading")}
          </div>
        ) : (
          <div>
            {data?.data.map((p) => {
              const [color, bg] = STATUS_COLORS[p.status] ?? ["var(--c-fg-muted)", "var(--c-surface)"];
              return (
                <div key={p.id} className="acp-list-row" style={{ gridTemplateColumns: COLS }}>
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <span style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--c-fg)", lineHeight: 1.3 }}>
                      {p.title}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <code style={{ fontSize: "var(--fs-xs)", color: "var(--c-fg-muted)" }}>/p/{p.slug}</code>
                  </div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ background: bg, color, borderRadius: 100, padding: "2px 8px", fontSize: "var(--fs-2xs)", fontWeight: 700 }}>
                      {t(`pages.status.${p.status}`, { defaultValue: p.status })}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", fontSize: "var(--fs-xs)", color: "var(--c-fg-muted)" }}>
                    {t(`pages.visibility.${p.visibility}`, { defaultValue: p.visibility })}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--fs-xs)", color: p.navPlacement ? "var(--c-success)" : "var(--c-fg-muted)" }}>
                    {p.navPlacement ? t(`pages.nav${p.navPlacement === "footer" ? "Footer" : "Navbar"}`) : "—"}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                    {p.status === "published" && (
                      <a
                        href={pagePath(p.slug)}
                        target="_blank"
                        rel="noreferrer"
                        title={t("pages.view")}
                        style={ICON_BTN}
                      >
                        <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                      </a>
                    )}
                    <Link to={`/pages/${p.id}/edit`} title={t("pages.edit")} style={ICON_BTN}>
                      <FontAwesomeIcon icon={faPen} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      title={t("pages.delete")}
                      style={ICON_BTN_DANGER}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </div>
                </div>
              );
            })}
            {data?.data.length === 0 && (
              <div style={{ padding: "3rem", textAlign: "center", color: "var(--c-fg-muted)", fontSize: "var(--fs-md)" }}>
                {t("pages.empty")}
              </div>
            )}
          </div>
        )}

        {meta && meta.totalPages > 1 && (
          <Pager page={page} totalPages={meta.totalPages} onPage={setPage}
            label={t("pages.pagination", { page: meta.page, totalPages: meta.totalPages, total: meta.total })} />
        )}
      </div>
    </div>
  );
}

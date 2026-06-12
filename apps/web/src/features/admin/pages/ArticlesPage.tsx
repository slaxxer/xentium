import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronLeft, faChevronRight, faArrowUpRightFromSquare, faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { Username } from "../../../components/Username";

interface Article {
  id: string;
  title: string;
  slug: string;
  status: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  publishedAt: string | null;
  author: { id: string; username: string; badgeColor: string | null };
  category: { id: string; name: string } | null;
}

interface PaginatedArticles {
  data: Article[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

const STATUS_COLORS: Record<string, [string, string]> = {
  draft:     ["var(--c-fg-muted)", "var(--c-surface)"],
  review:    ["var(--c-warn)",     "rgba(251,191,36,.12)"],
  published: ["var(--c-success)",  "rgba(52,211,153,.12)"],
};

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function getAuthorInitials(username: string) {
  return username.slice(0, 2).toUpperCase();
}

const COLS = "1fr 150px 130px 90px 70px 110px 80px";

export function ArticlesPage() {
  const { t } = useTranslation("acp");
  const queryClient = useQueryClient();
  const [page, setPage]     = useState(1);
  const [status, setStatus] = useState("");

  const { data, isLoading } = useQuery<PaginatedArticles>({
    queryKey: ["acp-articles", page, status],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: "20" });
      if (status) p.set("status", status);
      return api.get(`/admin/articles?${p}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/articles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acp-articles"] });
      swalToast(t("articles.toastDeleted"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  async function handleDelete(a: Article) {
    const r = await swalConfirm(
      t("articles.deleteTitle"),
      t("articles.deleteText", { title: a.title }),
      t("articles.delete"), t("common:actions.cancel"),
    );
    if (r) deleteMutation.mutate(a.id);
  }

  const meta = data?.meta;

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.content")}</div>
          <h1 className="acp-page-title">{t("nav.articles")}</h1>
        </div>
        <select
          className="acp-select"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          style={{ width: "auto" }}
        >
          <option value="">{t("articles.statusAll")}</option>
          <option value="draft">{t("articles.status.draft")}</option>
          <option value="review">{t("articles.status.review")}</option>
          <option value="published">{t("articles.status.published")}</option>
        </select>
      </div>

      <div className="acp-card" style={{ padding: 0, overflow: "hidden" }}>
        {/* Column header */}
        <div className="acp-list-head" style={{ gridTemplateColumns: COLS }}>
          <div>{t("articles.colTitle")}</div>
          <div>{t("articles.colAuthor")}</div>
          <div>{t("articles.colCategory")}</div>
          <div>{t("articles.colStatus")}</div>
          <div style={{ textAlign: "center" }}>{t("articles.colViews")}</div>
          <div>{t("articles.colPublished")}</div>
          <div />
        </div>

        {isLoading ? (
          <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--c-fg-muted)", fontSize: 14 }}>
            {t("articles.loading")}
          </div>
        ) : (
          <div>
            {data?.data.map((a) => {
              const [color, bg] = STATUS_COLORS[a.status] ?? ["var(--c-fg-muted)", "var(--c-surface)"];
              return (
                <div key={a.id} className="acp-list-row" style={{ gridTemplateColumns: COLS }}>
                  {/* Title */}
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--c-fg)", lineHeight: 1.3 }}>
                      {a.title}
                    </span>
                  </div>

                  {/* Author */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      className="acp-av"
                      style={{ background: "linear-gradient(135deg, var(--c-accent), var(--c-accent2))", flexShrink: 0 }}
                    >
                      {getAuthorInitials(a.author.username)}
                    </div>
                    <span style={{ fontSize: 12 }}>@<Username username={a.author.username} badgeColor={a.author.badgeColor} /></span>
                  </div>

                  {/* Category */}
                  <div style={{ display: "flex", alignItems: "center" }}>
                    {a.category ? (
                      <span style={{
                        background: "var(--c-accent-soft)", color: "var(--c-accent)",
                        borderRadius: 100, padding: "2px 8px", fontSize: 11, fontWeight: 700,
                      }}>
                        {a.category.name}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--c-fg-muted)", opacity: 0.5 }}>{t("articles.uncategorised")}</span>
                    )}
                  </div>

                  {/* Status */}
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ background: bg, color, borderRadius: 100, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
                      {t(`articles.status.${a.status}`, { defaultValue: a.status })}
                    </span>
                  </div>

                  {/* Views */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-fg-muted)" }}>
                      {a.viewCount.toLocaleString()}
                    </span>
                  </div>

                  {/* Published date */}
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>{formatDate(a.publishedAt)}</span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                    <Link
                      to={`/articles/${a.slug}`}
                      target="_blank"
                      style={{
                        fontSize: 12, fontWeight: 600, color: "var(--c-fg-muted)",
                        border: "1px solid var(--c-border)", borderRadius: "var(--radius-sm)",
                        padding: "4px 8px", textDecoration: "none",
                        transition: "border-color .15s, color .15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--c-accent-glow)"; e.currentTarget.style.color = "var(--c-accent)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--c-border)"; e.currentTarget.style.color = "var(--c-fg-muted)"; }}
                    >
                      <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(a)}
                      style={{
                        fontSize: 12, fontWeight: 600, color: "var(--c-danger)",
                        border: "1px solid rgba(248,113,113,.3)", borderRadius: "var(--radius-sm)",
                        padding: "4px 8px", background: "transparent", cursor: "pointer",
                        transition: "background .15s, border-color .15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(248,113,113,.1)"; e.currentTarget.style.borderColor = "var(--c-danger)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "rgba(248,113,113,.3)"; }}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </div>
                </div>
              );
            })}
            {data?.data.length === 0 && (
              <div style={{ padding: "3rem", textAlign: "center", color: "var(--c-fg-muted)", fontSize: 14 }}>
                {t("articles.empty")}
              </div>
            )}
          </div>
        )}

        {meta && meta.totalPages > 1 && (
          <div className="acp-pagination" style={{ padding: "12px 20px", borderTop: "1px solid var(--c-border)", marginTop: 0 }}>
            <button className="btn-ghost btn-sm" onClick={() => setPage((p) => p - 1)} disabled={page === 1}><FontAwesomeIcon icon={faChevronLeft} /></button>
            <span>{t("articles.pagination", { page: meta.page, totalPages: meta.totalPages, total: meta.total })}</span>
            <button className="btn-ghost btn-sm" onClick={() => setPage((p) => p + 1)} disabled={page >= meta.totalPages}><FontAwesomeIcon icon={faChevronRight} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

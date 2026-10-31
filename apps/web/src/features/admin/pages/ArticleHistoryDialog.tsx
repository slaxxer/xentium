import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { faClockRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { CorePermissions } from "@xentium/contracts";
import { FontAwesomeIcon } from "../../../components/Icon";
import { Button } from "../../../components/AcpControls";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { apiErrorMessage } from "../../../lib/swal";
import { siteTime } from "../../../lib/datetime";
import { userCan } from "../../../lib/authStore";
import { useAuth } from "../../../hooks/useAuth";

// ACP → Content → Articles → ⋯ → Version history. Every save of a published article
// keeps a version (newest first here); Restore puts one back. The server keeps the
// replaced text as a version first, so a restore shows up here and can be undone.

interface Revision {
  id: string;
  title: string;
  body: unknown;
  createdAt: string;
  author: { id: string; username: string };
}

/** The first words of a TipTap document, for telling versions apart. */
function preview(body: unknown, max = 160): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object" || out.join(" ").length > max) return;
    const node = n as { text?: string; content?: unknown[] };
    if (typeof node.text === "string") out.push(node.text);
    node.content?.forEach(walk);
  };
  walk(body);
  const text = out.join(" ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function ArticleHistoryDialog({ articleId, title, onClose }: { articleId: string; title: string; onClose: () => void }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const { user } = useAuth();
  const canRestore = userCan(user, CorePermissions.ARTICLE_REVISIONS_RESTORE);
  const [asking, setAsking] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<Revision[]>({
    queryKey: ["acp-article-revisions", articleId],
    queryFn: () => api.get(`/articles/${articleId}/revisions`),
  });

  const restore = useMutation({
    mutationFn: (revisionId: string) => api.post(`/articles/${articleId}/revisions/${revisionId}/restore`, {}),
    onSuccess: () => {
      toast.success(t("articles.history.restored"));
      setAsking(null);
      void qc.invalidateQueries({ queryKey: ["acp-article-revisions", articleId] });
      void qc.invalidateQueries({ queryKey: ["acp-articles"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div className="acp-modal arh" role="dialog" aria-modal="true" aria-labelledby="arh-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="arh-title" className="arh__title"><FontAwesomeIcon icon={faClockRotateLeft} /> {t("articles.history.title")}</h2>
        <p className="arh__lede">{t("articles.history.lede", { title })}</p>

        <div className="arh__list">
          {isLoading && <p className="arh__empty">{t("articles.history.loading")}</p>}
          {error && <p className="arh__empty">{apiErrorMessage(error)}</p>}
          {data && data.length === 0 && <p className="arh__empty">{t("articles.history.empty")}</p>}
          {data?.map((r, i) => (
            <div key={r.id} className={`arh__row${i === 0 ? " is-newest" : ""}`}>
              <div className="arh__text">
                <div className="arh__meta">
                  <b>{siteTime.dateTime(r.createdAt)}</b>
                  <span>{t("articles.history.by", { user: r.author.username })}</span>
                  {i === 0 && <span className="arp-flag arp-flag--accent">{t("articles.history.newest")}</span>}
                </div>
                <div className="arh__vtitle">{r.title}</div>
                <div className="arh__preview">{preview(r.body)}</div>
              </div>
              {canRestore && i > 0 && (
                asking === r.id ? (
                  <div className="arh__ask">
                    <span>{t("articles.history.ask")}</span>
                    <Button variant="ghost" onClick={() => setAsking(null)} disabled={restore.isPending}>{t("common:actions.cancel")}</Button>
                    <Button onClick={() => restore.mutate(r.id)} disabled={restore.isPending}>{t("articles.history.restore")}</Button>
                  </div>
                ) : (
                  <Button variant="ghost" onClick={() => setAsking(r.id)} disabled={restore.isPending}>{t("articles.history.restore")}</Button>
                )
              )}
            </div>
          ))}
        </div>

        <div className="arh__foot">
          <Button variant="ghost" onClick={onClose}>{t("articles.history.close")}</Button>
        </div>
      </div>
    </div>
  );
}

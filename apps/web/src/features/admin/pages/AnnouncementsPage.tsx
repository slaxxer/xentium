import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faBullhorn, faCircleCheck, faTriangleExclamation, faArrowUpRightFromSquare,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import "./AnnouncementsPage.scss";

/**
 * ACP → Announcements: everything the Xentium team has broadcast, still live.
 *
 * The dialog on ACP entry is the delivery; this is the record. An admin who
 * clicked OK on a phone at midnight has somewhere to go and read it properly,
 * and one who joined after a notice went out can still find it.
 *
 * Nothing is authored here — the rows are the marketplace's, already
 * signature-verified by the daily check. The only thing this page writes is an
 * acknowledgement.
 */

interface AnnouncementView {
  id:           string;
  severity:     "info" | "important" | "critical";
  publishedAt:  string;
  link:         string | null;
  title:        string;
  body:         string;
  acknowledged: boolean;
  locale:       string;
  fallback:     boolean;
}

const RANK: Record<AnnouncementView["severity"], number> = { critical: 2, important: 1, info: 0 };

export function AnnouncementsPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ checkedAt: string | null; announcements: AnnouncementView[] }>({
    queryKey:  ["acp-announcements"],
    queryFn:   () => api.get("/admin/announcements"),
    staleTime: 5 * 60_000,
  });

  async function acknowledge(id: string) {
    await api.post(`/admin/announcements/${id}/ack`, {}).catch(() => { /* it comes back */ });
    void qc.invalidateQueries({ queryKey: ["acp-announcements"] });
  }

  // Unread first, then loudest, then newest — the order an admin would want to
  // work down, not the order they were published in.
  const posts = [...(data?.announcements ?? [])].sort((a, b) =>
    Number(a.acknowledged) - Number(b.acknowledged)
    || RANK[b.severity] - RANK[a.severity]
    || b.publishedAt.localeCompare(a.publishedAt));

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.dashboard")}</div>
          <h1 className="acp-page-title">{t("announcements.title")}</h1>
        </div>
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">{t("announcements.loading")}</div>
      ) : posts.length === 0 ? (
        <div className="acp-card" style={{ padding: 40, textAlign: "center" }}>
          <FontAwesomeIcon icon={faBullhorn} style={{ fontSize: 32, color: "var(--c-fg-subtle)", marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-fg)", marginBottom: 6 }}>
            {t("announcements.emptyTitle")}
          </div>
          <div style={{ fontSize: 13, color: "var(--c-fg-muted)" }}>
            {data?.checkedAt
              ? t("announcements.emptyCheckedAt", { date: new Date(data.checkedAt).toLocaleString() })
              : t("announcements.emptyHint")}
          </div>
        </div>
      ) : (
        <div className="acp-ann__list">
          {posts.map((post) => {
            const urgent = post.severity !== "info";
            return (
              <article
                key={post.id}
                className={`acp-card acp-ann${post.acknowledged ? " is-read" : ""} acp-ann--${post.severity}`}
              >
                <div className="acp-ann__icon">
                  <FontAwesomeIcon icon={urgent ? faTriangleExclamation : faBullhorn} />
                </div>

                <div className="acp-ann__main">
                  <div className="acp-ann__head">
                    <h2 className="acp-ann__title">{post.title}</h2>
                    {urgent && (
                      <span className="acp-ann__badge">{t(`announcements.severity.${post.severity}`)}</span>
                    )}
                    {!post.acknowledged && <span className="acp-ann__new">{t("announcements.unread")}</span>}
                  </div>

                  <div className="acp-ann__meta">
                    <span>{t("announcements.from")}</span>
                    <span className="acp-ann__dot">·</span>
                    <span>{new Date(post.publishedAt).toLocaleDateString(undefined, {
                      year: "numeric", month: "long", day: "numeric",
                    })}</span>
                    {/* Said out loud rather than silently: an admin reading
                        English on a German site should know it is a gap in our
                        translations, not a setting of theirs. */}
                    {post.fallback && (
                      <>
                        <span className="acp-ann__dot">·</span>
                        <span>{t("announcements.englishFallback")}</span>
                      </>
                    )}
                  </div>

                  {/* The team's own prose, newlines preserved. Plain text by
                      construction — the channel carries no markup. */}
                  <p className="acp-ann__body">{post.body}</p>

                  {post.link && (
                    <a className="acp-ann__link" href={post.link} target="_blank" rel="noopener noreferrer">
                      <FontAwesomeIcon icon={faArrowUpRightFromSquare} /> {post.link}
                    </a>
                  )}
                </div>

                <div className="acp-ann__action">
                  {post.acknowledged ? (
                    <span className="acp-ann__read">
                      <FontAwesomeIcon icon={faCircleCheck} /> {t("announcements.read")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={() => void acknowledge(post.id)}
                    >
                      {t("announcements.dialogOk")}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

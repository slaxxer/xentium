import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faBullhorn, faTriangleExclamation, faArrowUpRightFromSquare } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import "./AnnouncementBanner.scss";

/**
 * A broadcast from the Xentium team, as a band across the top of the canvas.
 *
 * It used to be a modal on ACP entry. A dialog is the right shape for something
 * that must be answered before anything else can happen, and a notice from us
 * is not that: it arrives on its own schedule, it is rare, and it has nothing
 * for the admin to DO. What a modal actually did was stand between them and the
 * job they opened the panel to do, which is how a channel teaches people to
 * dismiss it without reading.
 *
 * As a band it is still unmissable and still has to be answered — OK is the
 * acknowledgement, recorded server-side per admin — but the admin decides when.
 * It is also no longer competing for the single-dialog slot, so a licence
 * warning or a waiting update can open on the same entry instead of queuing
 * behind it.
 *
 * ONE at a time, loudest then newest, same ranking the dialog used. The rest
 * are counted, with the Announcements page as the record.
 */

export interface AnnouncementView {
  id:           string;
  severity:     "info" | "important" | "critical";
  publishedAt:  string;
  link:         string | null;
  title:        string;
  body:         string;
  acknowledged: boolean;
}

const RANK: Record<AnnouncementView["severity"], number> = { critical: 2, important: 1, info: 0 };

export function AnnouncementBanner() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();

  const { data } = useQuery<{ checkedAt: string | null; announcements: AnnouncementView[] }>({
    queryKey:  ["acp-announcements"],
    queryFn:   () => api.get("/admin/announcements"),
    staleTime: 5 * 60_000,
  });

  const unread = (data?.announcements ?? [])
    .filter((a) => !a.acknowledged)
    .sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.publishedAt.localeCompare(a.publishedAt));

  const post = unread[0];
  if (!post) return null;

  const urgent = post.severity !== "info";

  function acknowledge() {
    // Optimistic: the band goes as soon as it is clicked. A failed write means
    // it returns on the next load, which is the safe direction for a notice
    // whose whole contract is that it was read.
    qc.setQueryData<{ checkedAt: string | null; announcements: AnnouncementView[] }>(
      ["acp-announcements"],
      (prev) => prev && {
        ...prev,
        announcements: prev.announcements.map((a) =>
          a.id === post!.id ? { ...a, acknowledged: true } : a),
      },
    );
    void api.post(`/admin/announcements/${post!.id}/ack`, {})
      .then(() => qc.invalidateQueries({ queryKey: ["acp-announcements"] }))
      .catch(() => qc.invalidateQueries({ queryKey: ["acp-announcements"] }));
  }

  return (
    <aside className={`acp-bcast acp-bcast--${post.severity}`} role="status">
      {/* Full-bleed band, but the contents sit in the SAME column as the page
          below, so the notice's title lines up with the page's own heading
          instead of starting 28px further left. */}
      <div className="acp-bcast__inner">
        <div className="acp-bcast__icon">
          <FontAwesomeIcon icon={urgent ? faTriangleExclamation : faBullhorn} />
        </div>

        <div className="acp-bcast__main">
          <div className="acp-bcast__head">
            <span className="acp-bcast__from">{t("announcements.from")}</span>
            {urgent && (
              <span className="acp-bcast__badge">{t(`announcements.severity.${post.severity}`)}</span>
            )}
          </div>
          <h2 className="acp-bcast__title">{post.title}</h2>
          {/* The team's own prose, newlines and all — the channel carries no markup. */}
          <p className="acp-bcast__body">{post.body}</p>
          {post.link && (
            <a className="acp-bcast__link" href={post.link} target="_blank" rel="noopener noreferrer">
              <FontAwesomeIcon icon={faArrowUpRightFromSquare} /> {post.link}
            </a>
          )}
        </div>

        <div className="acp-bcast__side">
          <button type="button" className="btn-primary btn-sm" onClick={acknowledge}>
            {t("announcements.dialogOk")}
          </button>
          {unread.length > 1 && (
            <Link to="/admin/announcements" className="acp-bcast__more">
              {t("announcements.moreWaiting", { count: unread.length - 1 })}
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}

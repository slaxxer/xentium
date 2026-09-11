import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHeart,
  faHeartCrack,
  faShareNodes,
  faPenToSquare,
  faEye,
  faClock,
  faFlag,
  faShield,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { articlesApi } from "../../lib/articlesApi";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { swalToast, apiErrorMessage } from "../../lib/swal";
import { ArticleContent } from "./components/ArticleContent";
import { MiniEditor, type MiniEditorHandle } from "../../components/MiniEditor";
import { UserAvatar } from "../../components/UserAvatar";
import { Avatar } from "../../components/Avatar";
import { UserBadges } from "../../components/UserBadges";
import { Username } from "../../components/Username";
import { topGroups, roleColor } from "../../lib/groupBadge";
import "./ArticleReaderPage.scss";
import { LayoutRenderer } from "../../layout/LayoutRenderer";
import { useLayoutDocument } from "../../layout/useLayout";

/** Small follow-button component that fetches initial follow state from the author's profile. */
function AuthorFollowButton({ authorId, authorUsername }: { authorId: string; authorUsername: string }) {
  const { t } = useTranslation("articles");
  const qc = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["profile", authorUsername],
    queryFn: () => api.get<{ viewerIsFollowing: boolean }>(`/users/${authorUsername}`),
    staleTime: 60_000,
  });

  const isFollowing = profileQuery.data?.viewerIsFollowing ?? false;

  const followMut = useMutation({
    mutationFn: () =>
      isFollowing
        ? api.delete(`/users/${authorId}/follow`)
        : api.post(`/users/${authorId}/follow`),
    onMutate: () => {
      qc.setQueryData(["profile", authorUsername], (prev: any) =>
        prev ? { ...prev, viewerIsFollowing: !prev.viewerIsFollowing } : prev,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["profile", authorUsername] }),
  });

  return (
    <button
      className={`btn btn--sm${isFollowing ? " btn--ghost" : " btn--soft"}`}
      type="button"
      onClick={() => followMut.mutate()}
      disabled={followMut.isPending}
    >
      {" "}{isFollowing ? t("reader.following") : t("reader.follow")}
    </button>
  );
}

export function ArticleReaderContent() {
  const { t } = useTranslation(["articles", "common"]);
  const { slug = "" } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const { user: authUser, isAuthenticated, isLoading: authLoading } = useAuth();

  const articleQuery = useQuery({
    queryKey: ["article", slug],
    queryFn: () => articlesApi.getBySlug(slug),
    enabled: !!slug,
  });

  const articleId = articleQuery.data?.id;
  useEffect(() => {
    if (!articleId) return;
    articlesApi.registerView(articleId).then((res) => {
      if (res.counted) {
        qc.setQueryData(["article", slug], (prev: typeof articleQuery.data) =>
          prev ? { ...prev, viewCount: prev.viewCount + 1 } : prev,
        );
      }
    }).catch(() => {});
  }, [articleId, qc, slug]);

  const commentsQuery = useQuery({
    queryKey: ["article-comments", articleQuery.data?.id],
    queryFn: () => articlesApi.comments(articleQuery.data!.id),
    enabled: !!articleQuery.data,
  });

  // Live presence — usernames currently online, used for the author card dot.
  const onlineQuery = useQuery<{ users?: { username: string }[] }>({
    queryKey: ["online-presence"],
    queryFn: () => api.get("/online"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const onlineUsernames = new Set((onlineQuery.data?.users ?? []).map((u) => u.username));

  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);

  const MOD_KEYS = new Set(["admin", "supermod", "moderator"]);
  const isMod = authUser?.groups.some((g) => MOD_KEYS.has(g.key)) ?? false;

  const [showWarn, setShowWarn]       = useState(false);
  const [warnReason, setWarnReason]   = useState("");
  const [warnExpiry, setWarnExpiry]   = useState("");
  const [warnHasExp, setWarnHasExp]   = useState(false);
  const warnMut = useMutation({
    mutationFn: () => api.post("/moderation/warnings", {
      userId:    articleQuery.data!.author.id,
      reason:    warnReason.trim(),
      expiresAt: warnHasExp && warnExpiry ? new Date(warnExpiry).toISOString() : null,
    }),
    onSuccess: () => {
      setShowWarn(false);
      setWarnReason("");
      setWarnExpiry("");
      setWarnHasExp(false);
      swalToast(t("reader.warnIssued", { username: articleQuery.data!.author.username }), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("reader.warnError"))),
  });

  // Track per-comment like state
  const [commentLikes, setCommentLikes] = useState<Set<string>>(new Set());

  const likeMut = useMutation({
    mutationFn: () => (liked ? articlesApi.unlike(articleQuery.data!.id) : articlesApi.like(articleQuery.data!.id)),
    onSuccess: (res) => {
      // Server enforces mutual exclusion — trust the counts it returns for both
      setLiked((v) => !v);
      setDisliked(false);
      qc.setQueryData(["article", slug], (prev: typeof articleQuery.data) =>
        prev ? { ...prev, likeCount: res.likeCount, dislikeCount: res.dislikeCount } : prev,
      );
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("reader.likeError"))),
  });

  const dislikeMut = useMutation({
    mutationFn: () => (disliked ? articlesApi.undislike(articleQuery.data!.id) : articlesApi.dislike(articleQuery.data!.id)),
    onSuccess: (res) => {
      // Server enforces mutual exclusion — trust the counts it returns for both
      setDisliked((v) => !v);
      setLiked(false);
      qc.setQueryData(["article", slug], (prev: typeof articleQuery.data) =>
        prev ? { ...prev, likeCount: res.likeCount, dislikeCount: res.dislikeCount } : prev,
      );
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("reader.dislikeError"))),
  });

  const [showReport, setShowReport]       = useState(false);
  const [reportReason, setReportReason]   = useState("");
  const reportMut = useMutation({
    mutationFn: () => api.post("/moderation/reports", {
      targetType: "article",
      targetId:   articleQuery.data!.id,
      reason:     reportReason.trim(),
    }),
    onSuccess: () => {
      setShowReport(false);
      setReportReason("");
      swalToast(t("reader.reportSubmitted"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("reader.reportError"))),
  });

  const commentLikeMut = useMutation({
    mutationFn: ({ commentId, isLiked }: { commentId: string; isLiked: boolean }) =>
      isLiked ? articlesApi.unlikeComment(commentId) : articlesApi.likeComment(commentId),
    onMutate: ({ commentId, isLiked }) => {
      setCommentLikes((prev) => {
        const next = new Set(prev);
        if (isLiked) next.delete(commentId);
        else next.add(commentId);
        return next;
      });
    },
    onSuccess: ({ likeCount }, { commentId }) => {
      qc.setQueryData(["article-comments", articleQuery.data?.id], (prev: any) => {
        if (!prev) return prev;
        const patchList = (list: any[]): any[] =>
          list.map((c) =>
            c.id === commentId
              ? { ...c, likeCount }
              : { ...c, replies: patchList(c.replies ?? []) },
          );
        return { ...prev, data: patchList(prev.data) };
      });
    },
    onError: (err, { commentId, isLiked }) => {
      setCommentLikes((prev) => {
        const next = new Set(prev);
        if (isLiked) next.add(commentId);
        else next.delete(commentId);
        return next;
      });
      swalToast(apiErrorMessage(err, t("reader.likeUpdateError")));
    },
  });

  const [commentBody, setCommentBody] = useState("");
  const commentEditorRef = useRef<MiniEditorHandle>(null);
  const commentMut = useMutation({
    mutationFn: () => articlesApi.postComment(articleQuery.data!.id, commentBody),
    onSuccess: () => {
      commentEditorRef.current?.clear();
      setCommentBody("");
      qc.invalidateQueries({ queryKey: ["article-comments", articleQuery.data?.id] });
      qc.invalidateQueries({ queryKey: ["article", slug] });
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("reader.commentError"))),
  });

  if (articleQuery.isLoading) return <div className="ard__loading">{t("reader.loading")}</div>;
  if (articleQuery.isError || !articleQuery.data) {
    return <div className="ard__loading">{t("reader.notFound")}</div>;
  }

  const a = articleQuery.data;
  const isAuthed = isAuthenticated;
  const isAuthor = authUser?.id === a.author.id;

  return (
    <article className="ard">
      {showWarn && (
        <div className="ard__modal-overlay" onClick={() => setShowWarn(false)}>
          <div className="ard__modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="ard__modal-title">
              <FontAwesomeIcon icon={faTriangleExclamation} style={{ color: "var(--c-warn)", marginRight: 8 }} />
              {t("reader.warnTitle", { username: a.author.username })}
            </h3>
            <p className="ard__modal-sub">{t("reader.warnSub")}</p>
            <textarea
              className="ard__modal-textarea"
              rows={3}
              placeholder={t("reader.warnPlaceholder")}
              value={warnReason}
              onChange={(e) => setWarnReason(e.target.value)}
              autoFocus
            />
            <label style={{ display:"flex",alignItems:"center",gap:8,fontSize:13,color:"var(--c-fg)",marginTop:12,cursor:"pointer" }}>
              <input type="checkbox" checked={warnHasExp} onChange={(e) => setWarnHasExp(e.target.checked)} />
              {t("reader.setExpiry")}
            </label>
            {warnHasExp && (
              <input
                className="ard__modal-textarea"
                type="datetime-local"
                min={new Date(Date.now() + 3600000).toISOString().slice(0, 16)}
                value={warnExpiry}
                onChange={(e) => setWarnExpiry(e.target.value)}
                style={{ marginTop:8, resize:"none" }}
              />
            )}
            <div className="ard__modal-actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowWarn(false)}>
                {t("actions.cancel", { ns: "common" })}
              </button>
              <button
                type="button"
                className="btn btn--sm btn--warn"
                disabled={warnReason.trim().length < 3 || warnMut.isPending}
                onClick={() => warnMut.mutate()}
              >
                {warnMut.isPending ? t("reader.issuing") : t("reader.issueWarning")}
              </button>
            </div>
          </div>
        </div>
      )}
      {showReport && (
        <div className="ard__modal-overlay" onClick={() => setShowReport(false)}>
          <div className="ard__modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="ard__modal-title">{t("reader.reportTitle")}</h3>
            <p className="ard__modal-sub">{t("reader.reportSub")}</p>
            <textarea
              className="ard__modal-textarea"
              rows={4}
              placeholder={t("reader.reportPlaceholder")}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              autoFocus
            />
            <div className="ard__modal-actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowReport(false)}>
                {t("actions.cancel", { ns: "common" })}
              </button>
              <button
                type="button"
                className="btn btn--sm"
                disabled={reportReason.trim().length < 3 || reportMut.isPending}
                onClick={() => reportMut.mutate()}
              >
                {reportMut.isPending ? t("reader.submitting") : t("reader.submitReport")}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="ard__tags">
        {a.category && <span className="badge">{a.category.name}</span>}
        {a.visibility === "members" && <span className="badge badge--success">{t("reader.members")}</span>}
        {a.visibility === "private" && <span className="badge badge--muted">{t("reader.private")}</span>}
      </div>

      <h1 className="ard__title">{a.title}</h1>

      <div className="ard__meta">
        <UserAvatar user={a.author} size={42} className="avatar" />
        <div className="ard__meta-info">
          <Username className="ard__meta-name" username={a.author.username} badgeColor={a.author.badgeColor} />
          <div className="ard__meta-sub">
            {a.publishedAt
              ? new Date(a.publishedAt).toLocaleDateString(undefined, {
                  year: "numeric", month: "long", day: "numeric",
                })
              : t("reader.draft")}
            {" · "}
            <FontAwesomeIcon icon={faClock} /> {t("reader.minRead", { n: a.readTime })}
            {" · "}
            <FontAwesomeIcon icon={faEye} /> {t("reader.views", { n: a.viewCount.toLocaleString() })}
          </div>
        </div>
        <div className="ard__meta-actions">
          <button
            className={`ard__action ${liked ? "is-active" : ""}`}
            onClick={() => likeMut.mutate()}
            disabled={!isAuthed || isAuthor || likeMut.isPending}
            title={isAuthor ? t("reader.cantLikeOwn") : liked ? t("reader.unlike") : t("reader.like")}
          >
            <FontAwesomeIcon icon={faHeart} /> {a.likeCount}
          </button>
          <button
            className={`ard__action ard__action--dislike ${disliked ? "is-active" : ""}`}
            onClick={() => dislikeMut.mutate()}
            disabled={!isAuthed || isAuthor || dislikeMut.isPending}
            title={isAuthor ? t("reader.cantDislikeOwn") : disliked ? t("reader.undislike") : t("reader.dislike")}
          >
            <FontAwesomeIcon icon={faHeartCrack} /> {a.dislikeCount}
          </button>
          <button className="ard__action" type="button">
            <FontAwesomeIcon icon={faShareNodes} /> {t("reader.share")}
          </button>
          {isAuthed && !isAuthor && (
            <button
              className="ard__action ard__action--muted"
              type="button"
              title={t("reader.reportTooltip")}
              onClick={() => setShowReport(true)}
            >
              <FontAwesomeIcon icon={faFlag} />
            </button>
          )}
          {isAuthor && (
            <Link to={`/articles/${a.slug}/edit`} className="ard__action ard__action--accent">
              <FontAwesomeIcon icon={faPenToSquare} /> {t("reader.edit")}
            </Link>
          )}
        </div>
      </div>

      {isMod && !isAuthor && (
        <div className="ard__mod-bar">
          <span className="ard__mod-bar__label">
            <FontAwesomeIcon icon={faShield} /> {t("reader.modTools")}
          </span>
          <button
            type="button"
            className="ard__mod-bar__btn"
            onClick={() => setShowWarn(true)}
          >
            <FontAwesomeIcon icon={faTriangleExclamation} /> {t("reader.warnAuthor")}
          </button>
        </div>
      )}

      {a.featuredImage && (
        <img className="ard__featured" src={`/uploads/${a.featuredImage}`} alt="" />
      )}

      {a.excerpt && <p className="ard__lede">{a.excerpt}</p>}

      <div className="ard__body">
        <ArticleContent body={a.body} />
      </div>

      {a.tags.length > 0 && (
        <div className="ard__tagrow">
          {a.tags.map((tag) => (
            <span key={tag.id} className="badge">#{tag.name}</span>
          ))}
        </div>
      )}

      <section className="ard__author-card">
        <Avatar
          user={{ username: a.author.username, avatar: a.author.avatar }}
          size={56}
          online={onlineUsernames.has(a.author.username)}
          className="avatar"
        />
        <div>
          {(() => {
            const ordered = topGroups(a.author.groups, (x) => x.group.displayOrder, 3);
            const primary = ordered[0]?.group;
            return (
              <>
                <Username
                  href={`/u/${a.author.username}`}
                  className="ard__author-name"
                  username={a.author.username}
                  badgeColor={primary?.progression?.badgeColor ?? null}
                  roleKey={primary?.key ?? null}
                />
                {/* Awards, beside the group pills. The component fetches its own
                    (batched with every other card on the page) and draws nothing at
                    all when this author holds none. */}
                <UserBadges userId={a.author.id} max={6} className="ard__author-awards" />
                {ordered.length > 0 && (
                  <div className="ard__author-badges">
                    {ordered.map(({ group: g }) => {
                      const color = roleColor(g.progression?.badgeColor, g.key) ?? "var(--c-accent)";
                      return (
                        <span
                          key={g.id}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "2px 8px", borderRadius: 20,
                            fontSize: 11, fontWeight: 700,
                            background: `color-mix(in srgb, ${color} 13%, transparent)`,
                            color,
                            border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
                          }}
                        >
                          {g.progression?.badgeLabel ?? g.name}
                        </span>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}
          {!isAuthor && isAuthed && (
            <AuthorFollowButton authorId={a.author.id} authorUsername={a.author.username} />
          )}
        </div>
      </section>

      <section className="ard__comments">
        <h2 className="ard__comments-title">{t("reader.commentsTitle", { n: a.commentCount })}</h2>

        {authLoading ? null : isAuthed ? (
          <div className="ard__compose">
            <UserAvatar user={{ username: authUser!.username ?? authUser!.id, avatar: authUser!.avatar }} size={36} className="avatar" />
            <div className="ard__compose-body">
              <MiniEditor
                ref={commentEditorRef}
                onChange={setCommentBody}
                placeholder={t("reader.commentPlaceholder")}
                disabled={commentMut.isPending}
                onSubmit={() => commentBody.trim() && commentMut.mutate()}
                className="ard__compose-editor"
              />
              <div className="ard__compose-actions">
                <button
                  className="btn btn--sm"
                  onClick={() => commentBody.trim() && commentMut.mutate()}
                  disabled={!commentBody.trim() || commentMut.isPending}
                >
                  {t("reader.postComment")}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="ard__signin">
            {t("reader.signInToComment")} ·{" "}
            <Link to="/login">{t("reader.login")}</Link>
          </div>
        )}

        {commentsQuery.data?.data.map((c) => {
          const isLiked = commentLikes.has(c.id);
          const canLike = isAuthed && authUser?.id !== c.author.id && !c.deletedAt;
          return (
            <div key={c.id} className="ard__comment">
              <UserAvatar user={c.author} size={36} className="avatar" />
              <div className="ard__comment-body">
                <div className="ard__comment-head">
                  <Username className="ard__comment-name" username={c.author.username} badgeColor={c.author.badgeColor} />
                  <span className="ard__comment-time">
                    {new Date(c.createdAt).toLocaleString(undefined, {
                      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                  {c.editedAt && <span className="ard__comment-edited">· {t("reader.edited")}</span>}
                </div>
                {c.deletedAt ? (
                  <div className="ard__comment-tombstone">
                    <em>
                      {t("reader.tombstoneBase", { user: c.author.username })}
                      {c.deletedByUsername ? t("reader.tombstoneBy", { mod: c.deletedByUsername }) : ""}
                      {" · "}
                      {new Date(c.deletedAt).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" })}
                      {c.deletedReason ? t("reader.tombstoneReason", { reason: c.deletedReason }) : ""}
                    </em>
                  </div>
                ) : (
                  <div
                    className="ard__comment-text"
                    dangerouslySetInnerHTML={{ __html: c.body ?? "" }}
                  />
                )}
                {!c.deletedAt && (
                  <div className="ard__comment-footer">
                    {canLike ? (
                      <button
                        className={`ard__comment-like${isLiked ? " is-liked" : ""}`}
                        onClick={() => commentLikeMut.mutate({ commentId: c.id, isLiked })}
                        disabled={commentLikeMut.isPending}
                        title={isLiked ? "Unlike" : "Like"}
                      >
                        <FontAwesomeIcon icon={faHeart} /> {c.likeCount}
                      </button>
                    ) : (
                      <span className="ard__comment-like ard__comment-like--static">
                        <FontAwesomeIcon icon={faHeart} /> {c.likeCount}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {commentsQuery.data?.data.length === 0 && (
          <p className="ard__empty">{t("reader.noComments")}</p>
        )}
      </section>
    </article>
  );
}

/**
 * Host container for the `article.detail` template (ADR-0005).
 *
 * Thin on purpose: with one block per page the content above stays whole, so there
 * is nothing to hoist. What this adds is the region structure — an admin can place
 * blocks in the other regions around it.
 */
export function ArticleReaderPage() {
  const layout = useLayoutDocument("article.detail");
  return <LayoutRenderer templateKey="article.detail" document={layout} />;
}

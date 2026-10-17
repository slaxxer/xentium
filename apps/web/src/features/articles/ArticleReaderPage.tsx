import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "../../lib/toast";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "../../components/Icon";
import {
  faHeart,
  faHeartCrack,
  faThumbsUp,
  faThumbsDown,
  faShareNodes,
  faPenToSquare,
  faFlag,
  faShield,
  faTriangleExclamation,
  faThumbtack,
  faChevronRight,
  faChevronDown,
  faComment,
  faBookmark as faBookmarkSolid,
  faArrowRight,
  faNewspaper,
} from "@fortawesome/free-solid-svg-icons";
import { faBookmark } from "@fortawesome/free-regular-svg-icons";
import { articlesApi, type ArticleComment } from "../../lib/articlesApi";
import { useHeadings } from "./useHeadings";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { userCan } from "../../lib/authStore";
import { swalToast, apiErrorMessage } from "../../lib/swal";
import { ArticleContent } from "./components/ArticleContent";
import { Composer, type ComposerHandle } from "../../components/composer/Composer";
import { UserAvatar } from "../../components/UserAvatar";
import { Avatar } from "../../components/Avatar";
import { UserBadges } from "../../components/UserBadges";
import { Username } from "../../components/Username";
import { topGroups, roleColor } from "../../lib/groupBadge";
import "./ArticleReaderPage.scss";
import { LayoutRenderer } from "../../layout/LayoutRenderer";
import { useLayoutDocument } from "../../layout/useLayout";
import { RankBadge } from "../../components/RankBadge";
import { useDateTime } from "../../lib/datetime";
import { uiLocale } from "../../lib/i18n";
import { WarnTemplateSelect } from "../../components/WarnTemplateSelect";
import type { WarnExpiry } from "../modcp/modTemplates";

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
  // Dates + times in the site's zone and format (ACP → System Settings).
  const dt = useDateTime();
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

  // `?comment=<id>` (a notification): scroll to that comment.
  const [searchParams] = useSearchParams();
  const focusCommentId = searchParams.get("comment");
  const focusShown = !!focusCommentId && !!commentsQuery.data?.data.some((c) => c.id === focusCommentId);
  useEffect(() => {
    if (!focusShown) return;
    const id = window.setTimeout(() => {
      document.getElementById(`comment-${focusCommentId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 120);
    return () => window.clearTimeout(id);
  }, [focusShown, focusCommentId]);

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

  // The mod bar's one tool is Warn — shown to whoever the warn endpoint accepts.
  const isMod = userCan(authUser, "moderation.warn.manage");
  // Pinning puts the article on top of the article index (the featured card). The
  // endpoint asks for article.edit.any, so the button does too.
  const canPin = userCan(authUser, "article.edit.any");
  const pinMut = useMutation({
    mutationFn: (pinned: boolean) => articlesApi.pin(articleQuery.data!.id, pinned),
    onSuccess: (res) => {
      qc.setQueryData(["article", slug], (prev: typeof articleQuery.data) => prev ? { ...prev, pinned: res.pinned } : prev);
      qc.invalidateQueries({ queryKey: ["articles-featured"] });
      toast.success(t(res.pinned ? "list.pinned" : "list.unpinned"));
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const [showWarn, setShowWarn]       = useState(false);
  const [warnTemplate, setWarnTemplate] = useState("");
  // "" = the template's own length; only a team lead's picker sets another.
  const [warnExpiry, setWarnExpiry]   = useState<WarnExpiry | "">("");
  const warnMut = useMutation({
    mutationFn: () => api.post("/moderation/warnings", {
      userId:     articleQuery.data!.author.id,
      templateId: warnTemplate,
      target:     { type: "article", id: articleQuery.data!.id },
      ...(warnExpiry ? { expiry: warnExpiry } : {}),
    }),
    onSuccess: () => {
      setShowWarn(false);
      setWarnTemplate("");
      setWarnExpiry("");
      swalToast(t("reader.warnIssued", { username: articleQuery.data!.author.username }), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("reader.warnError"))),
  });

  // Track per-comment like state
  /**
   * The viewer's thumbs on comments, as changed in this visit. What they gave before
   * comes with each comment (`viewerReaction`); this only holds the changes on top,
   * so a reload no longer forgets them.
   */
  const [reactions, setReactions] = useState<Record<string, "like" | "dislike" | null>>({});

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

  // `?report=1` (the home card's "Report"): open the form straight away.
  const [showReport, setShowReport]       = useState(() => searchParams.get("report") === "1");
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

  /** Thumbs up / down on a comment: one or the other; the same again takes it back. */
  const commentReactMut = useMutation({
    mutationFn: ({ commentId, current, next }: { commentId: string; current: "like" | "dislike" | null; next: "like" | "dislike" | null }) =>
      next === "like" ? articlesApi.likeComment(commentId)
        : next === "dislike" ? articlesApi.dislikeComment(commentId)
        : current === "like" ? articlesApi.unlikeComment(commentId)
        : articlesApi.undislikeComment(commentId),
    onMutate: ({ commentId, next }) => setReactions((r) => ({ ...r, [commentId]: next })),
    onSuccess: ({ likeCount, dislikeCount }, { commentId }) => {
      qc.setQueryData(["article-comments", articleQuery.data?.id], (prev: any) => {
        if (!prev) return prev;
        const patchList = (list: any[]): any[] =>
          list.map((c) =>
            c.id === commentId
              ? { ...c, likeCount, dislikeCount }
              : { ...c, replies: patchList(c.replies ?? []) },
          );
        return { ...prev, data: patchList(prev.data) };
      });
    },
    onError: (err, { commentId, current }) => {
      setReactions((r) => ({ ...r, [commentId]: current }));
      swalToast(apiErrorMessage(err, t("reader.likeUpdateError")));
    },
  });

  const [commentSort, setCommentSort] = useState<"popular" | "newest">("popular");
  const [replyTo, setReplyTo] = useState<string | null>(null);

  // What the viewer already did shows on arrival: heart, dislike and bookmark.
  const [saved, setSaved] = useState(false);
  const viewer = articleQuery.data?.viewer;
  useEffect(() => {
    setLiked(!!viewer?.liked); setDisliked(!!viewer?.disliked); setSaved(!!viewer?.saved);
  }, [viewer?.liked, viewer?.disliked, viewer?.saved]);

  const saveMut = useMutation({
    mutationFn: (): Promise<{ saved: boolean }> => (saved ? articlesApi.unsave(articleQuery.data!.id) : articlesApi.save(articleQuery.data!.id)),
    onSuccess: (res) => { setSaved(res.saved); toast.success(t(res.saved ? "reader.savedToast" : "reader.unsavedToast")); },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  /** Share: the system sheet where there is one (phones), else the link to the clipboard. */
  const share = async () => {
    const url = window.location.href.split("#")[0]!;
    try {
      if (navigator.share) { await navigator.share({ title: articleQuery.data?.title, url }); return; }
      await navigator.clipboard.writeText(url);
      toast.success(t("reader.linkCopied"));
    } catch { /* closed the share sheet */ }
  };

  // Side column + "Keep reading": more from the category, and the latest elsewhere.
  const categoryId = articleQuery.data?.category?.id;
  const moreInCategory = useQuery({
    queryKey: ["articles", { reader: "category", categoryId, exclude: articleId }],
    queryFn: () => articlesApi.list({ page: 1, limit: 3, categoryId: categoryId!, exclude: articleId! }),
    enabled: !!categoryId && !!articleId,
    staleTime: 60_000,
  }).data?.data ?? [];
  const readMore = useQuery({
    queryKey: ["articles", { reader: "more", exclude: articleId }],
    queryFn: () => articlesApi.list({ page: 1, limit: 3, exclude: articleId! }),
    enabled: !!articleId,
    staleTime: 60_000,
  }).data?.data ?? [];

  // "On this page": the article's own headings, once TipTap has drawn them.
  const bodyRef = useRef<HTMLDivElement>(null);
  const { toc, activeHeading } = useHeadings(bodyRef, articleId);

  const replyMut = useMutation({
    mutationFn: ({ parentId, body }: { parentId: string; body: string }) => articlesApi.postComment(articleQuery.data!.id, body, parentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["article-comments", articleQuery.data?.id] });
      qc.invalidateQueries({ queryKey: ["article", slug] });
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("reader.commentError"))),
  });

  const [commentBody, setCommentBody] = useState("");
  const commentEditorRef = useRef<ComposerHandle>(null);
  const commentMut = useMutation({
    mutationFn: (_parent: null) => articlesApi.postComment(articleQuery.data!.id, commentBody),
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
  const canEditAny = userCan(authUser, "article.edit.any");
  const showModMenu = (isMod && !isAuthor) || canPin || (canEditAny && !isAuthor);
  const comments = sortComments(commentsQuery.data?.data ?? [], commentSort);

  const likeButton = (cls: string) => (
    <button type="button" className={`${cls} ${cls}--like${liked ? " is-active" : ""}`}
      onClick={() => likeMut.mutate()} disabled={!isAuthed || isAuthor || likeMut.isPending}
      aria-pressed={liked} title={isAuthor ? t("reader.cantLikeOwn") : liked ? t("reader.unlike") : t("reader.like")}>
      <FontAwesomeIcon icon={faHeart} /> <span>{a.likeCount}</span>
    </button>
  );
  const dislikeButton = (cls: string) => (
    <button type="button" className={`${cls} ${cls}--dislike${disliked ? " is-active" : ""}`}
      onClick={() => dislikeMut.mutate()} disabled={!isAuthed || isAuthor || dislikeMut.isPending}
      aria-pressed={disliked} title={isAuthor ? t("reader.cantDislikeOwn") : disliked ? t("reader.undislike") : t("reader.dislike")}>
      <FontAwesomeIcon icon={faHeartCrack} /> <span>{a.dislikeCount}</span>
    </button>
  );

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
            <WarnTemplateSelect
              user={a.author.username} type="article" where={a.title}
              value={warnTemplate} onChange={(id) => { setWarnTemplate(id); setWarnExpiry(""); }}
              expiry={warnExpiry} onExpiryChange={setWarnExpiry}
            />
            <div className="ard__modal-actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowWarn(false)}>
                {t("actions.cancel", { ns: "common" })}
              </button>
              <button type="button" className="btn btn--sm btn--warn"
                disabled={!warnTemplate || warnMut.isPending} onClick={() => warnMut.mutate()}>
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
            <textarea className="ard__modal-textarea" rows={4} placeholder={t("reader.reportPlaceholder")}
              value={reportReason} onChange={(e) => setReportReason(e.target.value)} autoFocus />
            <div className="ard__modal-actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowReport(false)}>
                {t("actions.cancel", { ns: "common" })}
              </button>
              <button type="button" className="btn btn--sm"
                disabled={reportReason.trim().length < 3 || reportMut.isPending} onClick={() => reportMut.mutate()}>
                {reportMut.isPending ? t("reader.submitting") : t("reader.submitReport")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Head: where it is, what it is, who wrote it ── */}
      <header className="ard-head">
        <div className="ard-head__top">
          <nav className="ard-crumbs" aria-label={t("reader.crumbs")}>
            <Link to="/articles">{t("list.title")}</Link>
            {a.category && (<>
              <FontAwesomeIcon icon={faChevronRight} />
              <Link to={`/articles?filter=${a.category.id}`}>{a.category.name}</Link>
            </>)}
            {a.visibility === "members" && <span className="badge badge--success">{t("reader.members")}</span>}
            {a.visibility === "private" && <span className="badge badge--muted">{t("reader.private")}</span>}
          </nav>
          {showModMenu && (
            <ModMenu label={t("reader.modTools")}>
              {isMod && !isAuthor && (
                <button type="button" onClick={() => setShowWarn(true)}>
                  <FontAwesomeIcon icon={faTriangleExclamation} /> {t("reader.warnAuthor")}
                </button>
              )}
              {canPin && (
                <button type="button" aria-pressed={!!a.pinned} disabled={pinMut.isPending} onClick={() => pinMut.mutate(!a.pinned)}>
                  <FontAwesomeIcon icon={faThumbtack} /> {t(a.pinned ? "list.unpin" : "list.pin")}
                </button>
              )}
              {canEditAny && !isAuthor && (
                <Link to={`/articles/${a.slug}/edit`}><FontAwesomeIcon icon={faPenToSquare} /> {t("reader.edit")}</Link>
              )}
            </ModMenu>
          )}
        </div>

        <h1 className="ard__title">{a.title}</h1>
        {a.excerpt && <p className="ard__lede">{a.excerpt}</p>}

        <div className="ard-byline">
          <Link to={`/u/${a.author.username}`} className="ard-byline__ava" aria-hidden tabIndex={-1}>
            <UserAvatar user={a.author} size={36} className="avatar" />
          </Link>
          <Username className="ard-byline__name" href={`/u/${a.author.username}`} username={a.author.username} badgeColor={a.author.badgeColor} />
          <span className="ard-byline__dot" aria-hidden>·</span>
          {a.publishedAt ? <time dateTime={a.publishedAt}>{dt.date(a.publishedAt)}</time> : <span>{t("reader.draft")}</span>}
          <span className="ard-byline__dot" aria-hidden>·</span>
          <span>{t("reader.minRead", { n: a.readTime })}</span>
          <span className="ard-byline__dot" aria-hidden>·</span>
          <span>{t("reader.views", { n: a.viewCount.toLocaleString(uiLocale()) })}</span>
          {isAuthor && (
            <Link to={`/articles/${a.slug}/edit`} className="ard-byline__edit">
              <FontAwesomeIcon icon={faPenToSquare} /> {t("reader.edit")}
            </Link>
          )}
        </div>
      </header>

      {a.featuredImage && (
        <img className="ard__featured" src={`/uploads/${a.featuredImage}`} alt="" />
      )}

      <div className="ard-grid">
        {/* ── The action rail: sticky beside the text on wide screens, a row on narrow ones ── */}
        <aside className="ard-rail" aria-label={t("reader.actions")}>
          {likeButton("ard-rail__btn")}
          {dislikeButton("ard-rail__btn")}
          <a className="ard-rail__btn" href="#comments" title={t("reader.commentsTitle", { n: a.commentCount })}>
            <FontAwesomeIcon icon={faComment} /> <span>{a.commentCount}</span>
          </a>
          <span className="ard-rail__rule" aria-hidden />
          {isAuthed && (
            <button type="button" className={`ard-rail__btn${saved ? " is-active" : ""}`} aria-pressed={saved}
              title={saved ? t("reader.unsave") : t("reader.save")} onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              <FontAwesomeIcon icon={saved ? faBookmarkSolid : faBookmark} />
            </button>
          )}
          <button type="button" className="ard-rail__btn" title={t("reader.share")} onClick={share}>
            <FontAwesomeIcon icon={faShareNodes} />
          </button>
          {isAuthed && !isAuthor && (
            <button type="button" className="ard-rail__btn" title={t("reader.reportTooltip")} onClick={() => setShowReport(true)}>
              <FontAwesomeIcon icon={faFlag} />
            </button>
          )}
        </aside>

        <div className="ard-main">
          <div className="ard__body" ref={bodyRef} data-mod-target={`article:${a.id}`}>
            <ArticleContent body={a.body} />
          </div>

          {a.tags.length > 0 && (
            <div className="ard__tagrow">
              {a.tags.map((tag) => (
                <Link key={tag.id} to={`/articles?tag=${encodeURIComponent(tag.slug)}`} className="badge">#{tag.name}</Link>
              ))}
            </div>
          )}

          <div className="ard-verdict">
            <b>{t("reader.liked")}</b>
            <span className="ard-verdict__acts">
              {likeButton("ard-pill")}
              {dislikeButton("ard-pill")}
              <button type="button" className="ard-pill" onClick={share}>
                <FontAwesomeIcon icon={faShareNodes} /> <span>{t("reader.share")}</span>
              </button>
            </span>
          </div>

          {/* ── Comments ── */}
          <section className="ard__comments" id="comments">
            <div className="ard__comments-head">
              <h2 className="ard__comments-title">{t("reader.comments")} <span>{a.commentCount}</span></h2>
              <div className="ard-seg" role="tablist">
                {(["popular", "newest"] as const).map((s) => (
                  <button key={s} type="button" role="tab" aria-selected={commentSort === s}
                    className={commentSort === s ? "is-on" : ""} onClick={() => setCommentSort(s)}>
                    {t(`reader.sort.${s}`)}
                  </button>
                ))}
              </div>
            </div>

            {authLoading ? null : isAuthed ? (
              /**
               * ⚠ The INLINE composer: collapsed to one row until someone means to use
               * it. A comment box is a thing people scroll PAST to read the comments.
               */
              <Composer
                ref={commentEditorRef}
                variant="inline"
                onChange={setCommentBody}
                placeholder={t("reader.commentPlaceholder")}
                disabled={commentMut.isPending}
                busy={commentMut.isPending}
                submitLabel={t("reader.postComment")}
                onSubmit={() => commentBody.trim() && commentMut.mutate(null)}
                className="ard__composer"
              />
            ) : (
              <div className="ard__signin">
                {t("reader.signInToComment")} · <Link to="/login">{t("reader.login")}</Link>
              </div>
            )}

            <div className="ard__comment-list">
              {comments.map((c) => (
                <CommentItem key={c.id} c={c} articleAuthorId={a.author.id} depth={0}
                  reactions={reactions} onReact={(v) => commentReactMut.mutate(v)} reactPending={commentReactMut.isPending}
                  replyTo={replyTo} setReplyTo={setReplyTo}
                  onReply={(parentId, body) => replyMut.mutateAsync({ parentId, body })} replyPending={replyMut.isPending} />
              ))}
            </div>

            {commentsQuery.data?.data.length === 0 && (
              <p className="ard__empty">{t("reader.noComments")}</p>
            )}
          </section>
        </div>

        {/* ── Beside the text: who wrote it, where you are in it, more like it ── */}
        <aside className="ard-side">
          <section className="ard-authorcard">
            <div className="ard-authorcard__who">
              <Avatar user={{ username: a.author.username, avatar: a.author.avatar }} size={48}
                online={onlineUsernames.has(a.author.username)} className="avatar" />
              <div>
                {(() => {
                  const ordered = topGroups(a.author.groups, (x) => x.group.displayOrder, 1);
                  const primary = ordered[0]?.group;
                  const color = primary ? (roleColor(primary.progression?.badgeColor, primary.key) ?? "var(--c-accent)") : null;
                  return (
                    <>
                      <Username href={`/u/${a.author.username}`} className="ard-authorcard__name" username={a.author.username}
                        badgeColor={primary?.progression?.badgeColor ?? null} roleKey={primary?.key ?? null} />
                      {primary && color && (
                        <RankBadge groupKey={primary.key} label={primary.progression?.badgeLabel ?? primary.name}>
                          <span className="ard-authorcard__group" style={{
                            background: `color-mix(in srgb, ${color} 13%, transparent)`, color,
                            borderColor: `color-mix(in srgb, ${color} 32%, transparent)`,
                          }}>{primary.progression?.badgeLabel ?? primary.name}</span>
                        </RankBadge>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            <UserBadges userId={a.author.id} max={6} className="ard__author-awards" />
            {!isAuthor && isAuthed && (
              <AuthorFollowButton authorId={a.author.id} authorUsername={a.author.username} />
            )}
          </section>

          {toc.length >= 2 && (
            <nav className="ard-toc" aria-label={t("reader.onThisPage")}>
              <p className="ard-side__label">{t("reader.onThisPage")}</p>
              {toc.map((h) => (
                <a key={h.id} href={`#${h.id}`} className={`ard-toc__item ard-toc__item--${h.level}${activeHeading === h.id ? " is-on" : ""}`}
                  onClick={(e) => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                  {h.text}
                </a>
              ))}
            </nav>
          )}

          {a.category && moreInCategory.length > 0 && (
            <section className="ard-related">
              <p className="ard-side__label">{t("reader.moreIn", { category: a.category.name })}</p>
              {moreInCategory.map((r) => (
                <Link key={r.id} to={`/articles/${r.slug}`} className="ard-related__item">
                  <b>{r.title}</b>
                  <span>{t("reader.minShort", { n: r.readTime })}{r.publishedAt ? ` · ${dt.date(r.publishedAt)}` : ""}</span>
                </Link>
              ))}
            </section>
          )}
        </aside>
      </div>

      {/* ── Keep reading ── */}
      {readMore.length > 0 && (
        <section className="ard-more">
          <div className="ard-more__head">
            <h2>{t("reader.keepReading")}</h2>
            <Link to="/articles">{t("reader.allArticles")} <FontAwesomeIcon icon={faArrowRight} /></Link>
          </div>
          <div className="ard-more__grid">
            {readMore.map((r) => (
              <Link key={r.id} to={`/articles/${r.slug}`} className="ard-card">
                <span className="ard-card__cover">
                  {r.featuredImage ? <img src={`/uploads/${r.featuredImage}`} alt="" loading="lazy" /> : <FontAwesomeIcon icon={faNewspaper} />}
                </span>
                {r.category && <span className="ard-card__cat">{r.category.name}</span>}
                <b className="ard-card__title">{r.title}</b>
                <span className="ard-card__meta">{r.author.username} · {t("reader.minShort", { n: r.readTime })}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

/** Popular: most liked first (newest breaks ties). Newest: by date. Replies keep their order. */
function sortComments(list: ArticleComment[], by: "popular" | "newest"): ArticleComment[] {
  const time = (c: ArticleComment) => new Date(c.createdAt).getTime();
  return [...list].sort((x, y) => by === "popular"
    ? (y.likeCount - x.likeCount) || (time(y) - time(x))
    : time(y) - time(x));
}

/** The "Moderation" pill: a small menu of what staff may do to this article. */
function ModMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="ard-mod" ref={ref}>
      <button type="button" className="ard-mod__btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <FontAwesomeIcon icon={faShield} /> {label} <FontAwesomeIcon icon={faChevronDown} className="ard-mod__chev" />
      </button>
      {open && <div className="ard-mod__menu" role="menu" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

type ReactArgs = { commentId: string; current: "like" | "dislike" | null; next: "like" | "dislike" | null };

/** One comment, its thumbs, a Reply that opens a composer under it, and its replies (one level). */
function CommentItem({ c, articleAuthorId, depth, reactions, onReact, reactPending, replyTo, setReplyTo, onReply, replyPending }: {
  c: ArticleComment; articleAuthorId: string; depth: number;
  reactions: Record<string, "like" | "dislike" | null>; onReact: (v: ReactArgs) => void; reactPending: boolean;
  replyTo: string | null; setReplyTo: (id: string | null) => void;
  onReply: (parentId: string, body: string) => Promise<unknown>; replyPending: boolean;
}) {
  const { t } = useTranslation(["articles", "common"]);
  const dt = useDateTime();
  const { user: authUser, isAuthenticated } = useAuth();
  const [body, setBody] = useState("");
  // "Reply" opens the box ready to type: the inline composer starts as one row.
  const replyRef = useRef<ComposerHandle>(null);
  const replying = replyTo === c.id;
  // ⚠ The editor inside is created a frame or two after the box mounts; focusing
  // earlier left the cursor on the Reply button, and a typed space pressed it again
  // and closed the box. Retry until the cursor is really inside.
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!replying) return;
    let frame = 0; let tries = 0;
    const tick = () => {
      replyRef.current?.focus();
      if (!boxRef.current?.contains(document.activeElement) && tries++ < 30) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [replying]);
  const reaction = c.id in reactions ? reactions[c.id]! : c.viewerReaction ?? null;
  const canLike = isAuthenticated && authUser?.id !== c.author.id && !c.deletedAt;
  // Replies go one level deep: a reply to a reply joins the same thread.
  const threadId = depth === 0 ? c.id : (c.parentId ?? c.id);
  return (
    <div id={`comment-${c.id}`} data-mod-target={`article_comment:${c.id}`} className={`ard__comment${depth ? " ard__comment--reply" : ""}`}>
      <UserAvatar user={c.author} size={depth ? 30 : 36} className="avatar" />
      <div className="ard__comment-body">
        <div className="ard__comment-head">
          <Username className="ard__comment-name" username={c.author.username} badgeColor={c.author.badgeColor} />
          {c.author.id === articleAuthorId && <span className="ard__comment-author">{t("reader.authorBadge")}</span>}
          <span className="ard__comment-time"><time dateTime={c.createdAt}>{dt.stamp(c.createdAt)}</time></span>
          {c.editedAt && <span className="ard__comment-edited">· {t("reader.edited")}</span>}
        </div>
        {c.deletedAt ? (
          <div className="ard__comment-tombstone">
            <em>
              {t("reader.tombstoneBase", { user: c.author.username })}
              {c.deletedByUsername ? t("reader.tombstoneBy", { mod: c.deletedByUsername }) : ""}
              {" · "}{dt.date(c.deletedAt)}
              {c.deletedReason ? t("reader.tombstoneReason", { reason: c.deletedReason }) : ""}
            </em>
          </div>
        ) : (
          <div className="ard__comment-text xt-rich" dangerouslySetInnerHTML={{ __html: c.body ?? "" }} />
        )}
        {!c.deletedAt && (
          <div className="ard__comment-footer">
            {(["like", "dislike"] as const).map((kind) => {
              const on = reaction === kind;
              const count = kind === "like" ? c.likeCount : c.dislikeCount ?? 0;
              const icon = kind === "like" ? faThumbsUp : faThumbsDown;
              return canLike ? (
                <button key={kind} type="button" className={`ard__comment-like ard__comment-like--${kind}${on ? " is-liked" : ""}`}
                  aria-pressed={on} disabled={reactPending}
                  onClick={() => onReact({ commentId: c.id, current: reaction, next: on ? null : kind })}
                  title={t(kind === "like" ? (on ? "reader.unlike" : "reader.like") : (on ? "reader.undislike" : "reader.dislike"))}>
                  <FontAwesomeIcon icon={icon} /> {count}
                </button>
              ) : (
                <span key={kind} className={`ard__comment-like ard__comment-like--${kind} ard__comment-like--static`}
                  title={t(isAuthenticated ? "reader.cantRateOwnComment" : "reader.signInToRate")}>
                  <FontAwesomeIcon icon={icon} /> {count}
                </span>
              );
            })}
            {isAuthenticated && (
              <button type="button" className="ard__comment-reply" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>
                {t("reader.reply")}
              </button>
            )}
          </div>
        )}
        {replyTo === c.id && (
          <div ref={boxRef}>
          <Composer ref={replyRef} variant="inline" onChange={setBody} placeholder={t("reader.replyPlaceholder", { user: c.author.username })}
            disabled={replyPending} busy={replyPending} submitLabel={t("reader.reply")}
            onSubmit={() => { if (body.trim()) void onReply(threadId, body).then(() => { setBody(""); setReplyTo(null); }); }}
            className="ard__composer ard__composer--reply" />
          </div>
        )}
        {(c.replies ?? []).length > 0 && (
          <div className="ard__replies">
            {c.replies.map((r) => (
              <CommentItem key={r.id} c={r} articleAuthorId={articleAuthorId} depth={1}
                reactions={reactions} onReact={onReact} reactPending={reactPending}
                replyTo={replyTo} setReplyTo={setReplyTo} onReply={onReply} replyPending={replyPending} />
            ))}
          </div>
        )}
      </div>
    </div>
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

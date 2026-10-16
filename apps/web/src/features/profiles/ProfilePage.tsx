import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../components/Icon";
// The ban lock and the follow/block icons moved with their markup into
// `layout/blocks/profileBlocks.tsx`; what stays here is the tab bodies' own icons.
import { faThumbsUp, faGlobe, faCodeBranch, faHashtag, faFlag, faTrashCan, faReply, faThumbsDown } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { userCan } from "../../lib/authStore";
import { openDialog } from "../../lib/dialog";
import { toast } from "../../lib/toast";
import { useDateTime } from "../../lib/datetime";
import { swalToast, swalConfirm, apiErrorMessage } from "../../lib/swal";
import {
  articlesApi,
  type ArticleListItem,
} from "../../lib/articlesApi";
import { Composer, type ComposerHandle } from "../../components/composer/Composer";
import { Username } from "../../components/Username";
import { slotRegistry } from "../../plugins/slotRegistry";
import "./ProfilePage.scss";
import { LayoutRenderer } from "../../layout/LayoutRenderer";
import { useLayoutDocument } from "../../layout/useLayout";
import { uiLocale } from "../../lib/i18n";
import { fieldLabel } from "../../lib/coreText";

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string | null;
  namePreference: "username" | "fullName";
  previousUsernames: Array<{ username: string; changedAt: string }>;
  avatar: string | null;
  /** The member's OWN cover. Null falls back to the `profileCover` block's band. */
  coverImage: string | null;
  bio: string | null;
  joinedDate: string;
  /** When they were last here; null while online, hidden by them, or never. */
  lastSeenAt?: string | null;
  groups: Array<{ id: string; key?: string; name: string; icon: string | null; badgeColor: string | null; badgeLabel: string | null }>;
  postCount: number;
  articleCount: number;
  followerCount: number;
  followingCount: number;
  likeCountReceived: number;
  /** Age or birthday as the member's privacy setting allows; null = show nothing. */
  dob: { kind: "age"; age: number } | { kind: "birthday"; month: number; day: number } | null;
  dobLabel: string | null;
  dobDisplayFormat: string | null;
  isOwn: boolean;
  viewerIsFollowing: boolean;
  /** Online now (the members list's presence). */
  online?: boolean;
  viewerHasBlocked: boolean;
  isBanned: boolean;
  isPermanentBan: boolean;
}

interface ProfileUser {
  id: string;
  username: string;
  avatar: string | null;
  bio: string | null;
  badgeColor: string | null;
  roleKey: string | null;
}

interface ProfileComment {
  id: string;
  authorId: string;
  body: string;
  likeCount: number;
  dislikeCount: number;
  createdAt: string;
  editedAt: string | null;
  author: { id: string; username: string; avatar: string | null; badgeColor: string | null };
  /** Top-level comments carry their replies, oldest first; a reply has none. */
  replies?: ProfileComment[];
}

type Tab = "articles" | "wall" | "followers" | "following" | "information" | string;

/** One stat row on the profile card, including plugin-contributed ones. */
export interface ProfileStatRow {
  value: number;
  label: string;
  onClick: (() => void) | undefined;
}

/**
 * What `ProfilePage` resolves for the profile blocks (ADR-0005).
 *
 * Declared here rather than beside the blocks so the dependency runs one way:
 * `profileBlocks` imports from this module, never the reverse.
 */
export interface ProfileContext {
  profile: PublicProfile;
  isAuthenticated: boolean;
  tab: string;
  setTab: (id: string) => void;
  tabs: { id: string; label: string }[];
  stats: ProfileStatRow[];
  infoFields: PublicProfileField[];
  /** Where this member stands on the ladder, for the rank rail. Null while loading,
   *  and `enabled: false` on a site that has switched progression off. */
  progression: ProfileProgression | null;
  /** A handful of followers for the rail's strip, plus the true total. */
  followers: { items: { id: string; username: string; avatar: string | null }[]; total: number } | null;
  onFollow: () => void;
  onBlockToggle: () => void;
  followPending: boolean;
  blockPending: boolean;
}

/** What `/users/:id/progression` answers with. */
export interface ProfileProgression {
  enabled: boolean;
  /** Whether this member's rung may set a cover, and the rung that grants it. */
  canUploadCover?: boolean;
  coverUnlocksAt?: string | null;
  showProgressBar?: boolean;
  current?: { badgeLabel: string | null; badgeColor: string | null; ladderPosition: number | null } | null;
  next?: { badgeLabel: string | null; badgeColor: string | null; ladderPosition: number | null } | null;
  atTop?: boolean;
  percent?: number;
  primary?: { label: string; have: number; need: number; remaining: number } | null;
  ladder?: { id: string; name: string; badgeColor: string | null; position: number; earned: boolean;
             requirement: { key: string; value: number } | null }[];
  unlocks?: { key: string; value: number }[];
}

const STATIC_TAB_IDS = ["articles", "wall", "followers", "following", "information"] as const;

export interface PublicProfileField {
  key: string;
  label: string;
  type: string;
  value: string;
}

function Avatar({ user, size = 40 }: { user: { username: string; avatar: string | null }; size?: number }) {
  if (user.avatar) {
    return <img src={user.avatar} alt={user.username} data-user-card={user.username} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }} />;
  }
  return (
    <div className="profile-av-small" data-user-card={user.username} style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {user.username.charAt(0).toUpperCase()}
    </div>
  );
}

function UserCard({ user }: { user: ProfileUser }) {
  return (
    <div className="profile-user-card">
      <Avatar user={user} size={44} />
      <div className="profile-user-card__info">
        <Username href={`/u/${user.username}`} className="profile-user-card__name" username={user.username} badgeColor={user.badgeColor} roleKey={user.roleKey} />
        {user.bio && <p className="profile-user-card__bio">{user.bio}</p>}
      </div>
    </div>
  );
}

export function UserList({ userId, type }: { userId: string; type: "followers" | "following" }) {
  const { t } = useTranslation(["profiles", "common"]);
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["profile", userId, type, page],
    queryFn: () => api.get<{ items: ProfileUser[]; total: number }>(`/users/${userId}/${type}?page=${page}&limit=20`),
    enabled: !!userId,
  });

  if (isLoading) return <p className="profile-empty">{t("actions.loading", { ns: "common" })}</p>;
  if (!data?.items.length) return <p className="profile-empty">{type === "followers" ? t("noFollowers") : t("noFollowing")}</p>;

  return (
    <div>
      <div className="profile-user-grid">
        {data.items.map((u) => <UserCard key={u.id} user={u} />)}
      </div>
      {data.total > 20 && (
        <div className="profile-pagination">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="btn-ghost btn-sm">{t("prev")}</button>
          <span className="profile-pagination__info">{t("pageOf", { page, total: Math.ceil(data.total / 20) })}</span>
          <button disabled={page * 20 >= data.total} onClick={() => setPage((p) => p + 1)} className="btn-ghost btn-sm">{t("next")}</button>
        </div>
      )}
    </div>
  );
}

/* ── Articles tab ────────────────────────────────────────────────────── */

function ArticleRow({ a }: { a: ArticleListItem }) {
  const { t } = useTranslation("profiles");
  // viewCount placeholder: real article view tracking arrives with analytics
  // (Phase 8 onward); zero for now.
  const dateLabel = a.publishedAt
    ? new Date(a.publishedAt).toLocaleDateString(uiLocale(), { year: "numeric", month: "short", day: "numeric" })
    : t("unpublished");
  const views = 0;

  return (
    <Link to={`/articles/${a.slug}`} className="profile-articles__row">
      {/* ⚠ The thumb is always drawn, image or not. An article with no featured
          image falls back to a gradient from the site's palette rather than a gap —
          otherwise a list of unillustrated posts loses the row's shape entirely. */}
      <div
        className={`profile-articles__thumb${a.featuredImage ? " profile-articles__thumb--img" : ""}`}
        style={a.featuredImage ? { backgroundImage: `url(${a.featuredImage})` } : undefined}
      >
        <span className="profile-articles__read">{t("minRead", { n: a.readTime })}</span>
      </div>

      <div className="profile-articles__body">
        <div className="profile-articles__titlerow">
          <h3 className="profile-articles__title">
            {a.title || <em>{t("untitled")}</em>}
          </h3>
          {a.category && (
            <span className="profile-articles__badge">{a.category.name}</span>
          )}
        </div>

        {a.excerpt && <p className="profile-articles__excerpt">{a.excerpt}</p>}

        <div className="profile-articles__meta">
          {dateLabel} · {t("views", { v: (a.viewCount ?? views).toLocaleString(uiLocale()) })} · {t("likeCount", { n: a.likeCount })}
        </div>
      </div>
    </Link>
  );
}

const ARTICLES_PER_PAGE = 5;

export function ProfileArticlesTab({ profile }: { profile: PublicProfile }) {
  const { t } = useTranslation("profiles");
  const [page, setPage] = useState(1);

  // Always uses the public listing scoped to this author. Backend enforces
  // status=published + visibility filtering; private articles by the viewer
  // themselves are still included for them per the repo OR-clause.
  const query = useQuery({
    queryKey: ["articles-by-author", profile.id, page],
    queryFn: () =>
      articlesApi.list({ authorId: profile.id, limit: ARTICLES_PER_PAGE, page }),
  });

  const items = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="profile-articles">
      {query.isLoading && <p className="profile-empty">{t("loadingArticles")}</p>}

      {!query.isLoading && items.length === 0 && (
        <p className="profile-empty">
          {profile.isOwn
            ? t("emptyOwn")
            : t("emptyOther", { username: profile.username })}
        </p>
      )}

      {items.length > 0 && (
        <div className="profile-articles__list">
          {items.map((a) => (
            <ArticleRow key={a.id} a={a} />
          ))}
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <nav className="profile-articles__pagination">
          <button disabled={!meta.hasPrev} onClick={() => setPage((p) => p - 1)}>
            {t("prev")}
          </button>
          <span>
            {t("pageOf", { page: meta.page, total: meta.totalPages })}
          </span>
          <button disabled={!meta.hasNext} onClick={() => setPage((p) => p + 1)}>
            {t("next")}
          </button>
        </nav>
      )}
    </div>
  );
}

/* ── Information tab (mockup's "About" layout) ──────────────────────── */

const FIELD_FA_ICONS = {
  website: faGlobe,
  github:  faCodeBranch,
  discord: faHashtag,
} as const;

function InformationField({ field }: { field: PublicProfileField }) {
  const icon = FIELD_FA_ICONS[field.key as keyof typeof FIELD_FA_ICONS] ?? faGlobe;

  if (field.type === "url") {
    const href = field.value.match(/^https?:\/\//) ? field.value : `https://${field.value}`;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="profile-info-card__link">
        <FontAwesomeIcon icon={icon} /> {fieldLabel(field)}
      </a>
    );
  }

  if (field.key === "github") {
    const href = `https://github.com/${field.value}`;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="profile-info-card__link">
        <FontAwesomeIcon icon={icon} /> {field.value}
      </a>
    );
  }

  if (field.key === "discord") {
    return (
      <div className="profile-info-card__field">
        <span className="profile-info-card__field-label"><FontAwesomeIcon icon={icon} /> {fieldLabel(field)}:</span>
        <span className="profile-info-card__field-value">{field.value}</span>
      </div>
    );
  }

  return (
    <div className="profile-info-card__field">
      <span className="profile-info-card__field-label"><FontAwesomeIcon icon={icon} /> {fieldLabel(field)}:</span>
      <span className="profile-info-card__field-value">{field.value}</span>
    </div>
  );
}

const LINK_KEYS = new Set(["website", "github", "discord"]);

export function InformationTab({
  profile,
  fields,
}: {
  profile: PublicProfile;
  fields: PublicProfileField[];
}) {
  const { t, i18n } = useTranslation("profiles");
  const hasBio = !!profile.bio;
  const hasDob = !!profile.dob;
  const linkFields = fields.filter((f) => LINK_KEYS.has(f.key));
  const hasLinks = linkFields.length > 0;
  const dobSectionLabel = profile.dob?.kind === "age" ? t("age") : t("birthdate");
  // Formatted here, in the reader's language — the API sends numbers, not English.
  const dobValue = !profile.dob ? null
    : profile.dob.kind === "age" ? t("yearsOld", { count: profile.dob.age })
    : new Date(Date.UTC(2000, profile.dob.month - 1, profile.dob.day))
        .toLocaleDateString(i18n.language, { month: "long", day: "numeric", timeZone: "UTC" });

  if (!hasDob && !hasBio && !hasLinks) {
    return (
      <p className="profile-empty">{t("noInfo")}</p>
    );
  }

  return (
    <div className="profile-info-card">
      {hasDob && (
        <div className="profile-info-card__dob-row">
          <span className="profile-info-card__label">{dobSectionLabel}</span>
          <span className="profile-info-card__dob-value">{dobValue}</span>
        </div>
      )}

      {hasDob && (hasBio || hasLinks) && <div className="profile-info-card__divider" />}

      {hasBio && (
        <>
          <div className="profile-info-card__label">{t("bio")}</div>
          <p className="profile-info-card__bio">{profile.bio}</p>
        </>
      )}

      {hasBio && hasLinks && <div className="profile-info-card__divider" />}

      {hasLinks && (
        <>
          <div className="profile-info-card__label">{t("links")}</div>
          {linkFields.map((f) => (
            <InformationField key={f.key} field={f} />
          ))}
        </>
      )}
    </div>
  );
}

export function ProfileWall({ profile }: { profile: PublicProfile }) {
  const { t } = useTranslation("profiles");
  const { user: authUser, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState("");
  const commentEditorRef = useRef<ComposerHandle>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["profile-comments", profile.id],
    queryFn: () => api.get<{ comments: ProfileComment[]; total: number; viewerLikedIds: string[]; viewerDislikedIds?: string[] }>(`/users/${profile.id}/profile-comments?limit=20`),
  });

  const postMutation = useMutation({
    mutationFn: (body: string) => api.post(`/users/${profile.id}/profile-comments`, { body }),
    onSuccess: () => {
      commentEditorRef.current?.clear();
      setCommentBody("");
      queryClient.invalidateQueries({ queryKey: ["profile-comments", profile.id] });
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("postError"))),
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => api.delete(`/users/profile-comments/${commentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile-comments", profile.id] }),
    onError: (e) => swalToast(apiErrorMessage(e, t("deleteError"))),
  });

  // The open reply box: under which thread, and to whom (a reply to a reply is filed
  // under the same top-level comment; the server does that too).
  const [replyTo, setReplyTo] = useState<{ topId: string; commentId: string; username: string } | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const replyEditorRef = useRef<ComposerHandle>(null);
  useEffect(() => { if (replyTo) replyEditorRef.current?.focus(); }, [replyTo]);

  // `?comment=<id>` (a notification): scroll to that comment or reply.
  const [wallParams] = useSearchParams();
  const focusCommentId = wallParams.get("comment");

  const replyMutation = useMutation({
    mutationFn: ({ body, parentId }: { body: string; parentId: string }) =>
      api.post(`/users/${profile.id}/profile-comments`, { body, parentId }),
    onSuccess: () => {
      replyEditorRef.current?.clear();
      setReplyBody("");
      setReplyTo(null);
      queryClient.invalidateQueries({ queryKey: ["profile-comments", profile.id] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("postError"))),
  });

  /** Delete, after asking: the comment (and a top-level one's replies) leaves the wall without a trace. */
  async function confirmDelete(commentId: string) {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("deleteConfirmTitle"), body: t("deleteConfirmBody"),
      confirmText: t("delete"), cancelText: t("cancel"),
    });
    if (ok) deleteMutation.mutate(commentId);
  }

  /** Report to the moderators: the same queue an article or its comments report into. */
  async function report(commentId: string) {
    let reason = "";
    const ok = await openDialog({
      kind: "confirm", icon: "warning",
      title: t("reportTitle"),
      bodyNode: (
        <div className="profile-wall__report">
          <p>{t("reportSub")}</p>
          <textarea rows={4} maxLength={2000} autoFocus
            placeholder={t("reportPlaceholder")} onChange={(e) => { reason = e.target.value; }} />
        </div>
      ),
      confirmText: t("reportSubmit"), cancelText: t("cancel"),
    });
    if (!ok) return;
    if (reason.trim().length < 3) { toast.warning(t("reportTooShort")); return; }
    try {
      await api.post("/moderation/reports", { targetType: "profile_comment", targetId: commentId, reason: reason.trim() });
      toast.success(t("reportSent"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("reportError")));
    }
  }

  // A dislike and a like exclude each other; the server swaps them.
  const dislikeMutation = useMutation({
    mutationFn: ({ commentId, disliked }: { commentId: string; disliked: boolean }) =>
      disliked
        ? api.delete(`/users/profile-comments/${commentId}/dislike`)
        : api.post(`/users/profile-comments/${commentId}/dislike`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile-comments", profile.id] }),
    onError: (e) => toast.error(apiErrorMessage(e, t("likeError"))),
  });

  const likeMutation = useMutation({
    mutationFn: ({ commentId, liked }: { commentId: string; liked: boolean }) =>
      liked
        ? api.delete(`/users/profile-comments/${commentId}/like`)
        : api.post(`/users/profile-comments/${commentId}/like`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile-comments", profile.id] }),
    onError: (e) => swalToast(apiErrorMessage(e, t("likeError"))),
  });

  // Owners cannot post new wall comments, but can reply to existing ones (§40)
  const canComment = isAuthenticated && !profile.isOwn;
  const canDeleteAny = userCan(authUser, "profile.comment.delete.any");
  const dt = useDateTime();
  const viewerLikedIds = new Set(data?.viewerLikedIds ?? []);
  const viewerDislikedIds = new Set(data?.viewerDislikedIds ?? []);
  const focusShown = !!focusCommentId && !!data?.comments.some(
    (c) => c.id === focusCommentId || c.replies?.some((r) => r.id === focusCommentId),
  );
  useEffect(() => {
    if (!focusShown) return;
    const id = window.setTimeout(() => {
      document.getElementById(`wall-comment-${focusCommentId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 120);
    return () => window.clearTimeout(id);
  }, [focusShown, focusCommentId]);

  function handleSubmit() {
    if (!commentBody.trim()) return;
    postMutation.mutate(commentBody);
  }

  /** One comment — a top-level one, or a reply (`topId` = the thread it sits in). */
  function renderComment(c: ProfileComment, topId?: string) {
    const hasLiked = viewerLikedIds.has(c.id);
    const hasDisliked = viewerDislikedIds.has(c.id);
    const canRate = isAuthenticated && authUser?.id !== c.authorId;
    return (
      <div key={c.id} id={`wall-comment-${c.id}`}
        className={`profile-wall__comment${topId ? " profile-wall__comment--reply" : ""}`}
        data-mod-target={`profile_comment:${c.id}`}>
        <Avatar user={c.author} size={topId ? 30 : 36} />
        <div className="profile-wall__comment-body">
          <div className="profile-wall__comment-header">
            <Username href={`/u/${c.author.username}`} className="profile-wall__comment-author" username={c.author.username} badgeColor={c.author.badgeColor} />
            <time className="profile-wall__comment-time" dateTime={c.createdAt} title={dt.dateTime(c.createdAt)}>
              {dt.date(c.createdAt)} · {dt.time(c.createdAt)}
            </time>
          </div>
          <div
            className="profile-wall__comment-text xt-rich"
            dangerouslySetInnerHTML={{ __html: c.body }}
          />
          <div className="profile-wall__comment-footer">
            {c.editedAt && <span className="profile-wall__comment-edited">{t("edited")}</span>}
            {canRate ? (
              <>
                <button
                  className={`profile-wall__like-btn${hasLiked ? " is-liked" : ""}`}
                  onClick={() => likeMutation.mutate({ commentId: c.id, liked: hasLiked })}
                  disabled={likeMutation.isPending || dislikeMutation.isPending}
                  title={hasLiked ? t("unlike") : t("like")}
                >
                  <FontAwesomeIcon icon={faThumbsUp} /> {c.likeCount}
                </button>
                <button
                  className={`profile-wall__like-btn profile-wall__like-btn--dislike${hasDisliked ? " is-disliked" : ""}`}
                  onClick={() => dislikeMutation.mutate({ commentId: c.id, disliked: hasDisliked })}
                  disabled={likeMutation.isPending || dislikeMutation.isPending}
                  title={hasDisliked ? t("undislike") : t("dislike")}
                >
                  <FontAwesomeIcon icon={faThumbsDown} /> {c.dislikeCount ?? 0}
                </button>
              </>
            ) : (
              <>
                <span className="profile-wall__like-count" title={t(isAuthenticated ? "cantRateOwnComment" : "signInToRate")}>
                  <FontAwesomeIcon icon={faThumbsUp} /> {c.likeCount}
                </span>
                <span className="profile-wall__like-count profile-wall__like-count--dislike" title={t(isAuthenticated ? "cantRateOwnComment" : "signInToRate")}>
                  <FontAwesomeIcon icon={faThumbsDown} /> {c.dislikeCount ?? 0}
                </span>
              </>
            )}
            <span className="profile-wall__comment-actions">
              {isAuthenticated && (
                <button type="button" className="profile-wall__action"
                  onClick={() => setReplyTo({ topId: topId ?? c.id, commentId: c.id, username: c.author.username })}>
                  <FontAwesomeIcon icon={faReply} /> {t("reply")}
                </button>
              )}
              {isAuthenticated && authUser?.id !== c.authorId && (
                <button type="button" className="profile-wall__action" onClick={() => report(c.id)}>
                  <FontAwesomeIcon icon={faFlag} /> {t("report")}
                </button>
              )}
              {(profile.isOwn || authUser?.id === c.authorId || canDeleteAny) && (
                <button type="button" className="profile-wall__action profile-wall__action--danger"
                  onClick={() => confirmDelete(c.id)} disabled={deleteMutation.isPending}>
                  <FontAwesomeIcon icon={faTrashCan} /> {t("delete")}
                </button>
              )}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-wall">
      <h3 className="profile-wall__title">{t("wallTitle")}</h3>

      {canComment && (
        /* The inline composer, as on article comments: one row until it is used,
           and it brings its own avatar and Post button. */
        <Composer
          ref={commentEditorRef}
          variant="inline"
          onChange={setCommentBody}
          placeholder={t("wallPlaceholder", { username: profile.username })}
          disabled={postMutation.isPending}
          busy={postMutation.isPending}
          submitLabel={t("post")}
          onSubmit={handleSubmit}
          className="profile-wall__composer"
        />
      )}

      {isLoading ? (
        <p className="profile-empty">{t("loadingComments")}</p>
      ) : !data?.comments.length ? (
        <p className="profile-empty profile-empty--wall">{t("noComments")}</p>
      ) : (
        <div className="profile-wall__comments">
          {data.comments.map((c) => (
            <div key={c.id} className="profile-wall__thread">
              {renderComment(c)}
              {(!!c.replies?.length || replyTo?.topId === c.id) && (
                <div className="profile-wall__replies">
                  {c.replies?.map((r) => renderComment(r, c.id))}
                  {replyTo?.topId === c.id && (
                    <Composer
                      ref={replyEditorRef}
                      variant="inline"
                      onChange={setReplyBody}
                      placeholder={t("replyPlaceholder", { username: replyTo.username })}
                      replyTo={{ name: replyTo.username }}
                      onDismissReply={() => setReplyTo(null)}
                      onCancel={() => setReplyTo(null)}
                      disabled={replyMutation.isPending}
                      busy={replyMutation.isPending}
                      submitLabel={t("reply")}
                      onSubmit={() => replyBody.trim() && replyMutation.mutate({ body: replyBody, parentId: replyTo.commentId })}
                      className="profile-wall__reply-composer"
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProfilePage() {
  const { t } = useTranslation(["profiles", "common"]);
  const { username } = useParams();
  const [searchParams] = useSearchParams();
  const pluginTabsInit = slotRegistry.getProfileTabs();
  // Honor a ?tab= deep-link (e.g. from the ModCanvas user stat boxes), but only
  // if it resolves to a tab that actually exists for this install.
  const requestedTab = searchParams.get("tab");
  // "warnings" is allowed here; whether THIS viewer may open it is checked once the
  // profile has loaded (below), and anyone else lands on Articles.
  const validTabIds = new Set<string>([...STATIC_TAB_IDS, "warnings", ...pluginTabsInit.map((p) => p.id)]);
  const [tab, setTab] = useState<Tab>(requestedTab && validTabIds.has(requestedTab) ? requestedTab : "articles");
  // A link to another tab while this page is already open (a warning notification
  // clicked on one's own profile) changes only the query, which does not remount it.
  const linkKey = searchParams.toString();
  useEffect(() => {
    if (requestedTab && validTabIds.has(requestedTab)) setTab(requestedTab);
  }, [requestedTab, linkKey]);
  const { isAuthenticated, user: viewer } = useAuth();
  const queryClient = useQueryClient();
  const layout = useLayoutDocument("profile");

  const {
    data: profile,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["profile", username],
    queryFn: () => api.get<PublicProfile>(`/users/${username}`),
    enabled: !!username,
  });

  const { data: infoFields = [] } = useQuery<PublicProfileField[]>({
    queryKey: ["profile-fields", profile?.id],
    queryFn: () => api.get(`/users/${profile!.id}/profile-fields`),
    enabled: !!profile?.id && tab === "information",
  });

  /**
   * The rank rail's data. One request, and only once a profile has resolved — it is
   * addressed by id, and the page is reached by username.
   */
  const { data: progression = null } = useQuery<ProfileProgression>({
    queryKey: ["profile-progression", profile?.id],
    queryFn:  () => api.get(`/users/${profile!.id}/progression`),
    enabled:  !!profile?.id,
    staleTime: 60_000,
  });

  /**
   * A few followers for the rail, NOT the followers tab's list.
   *
   * ⚠ Five, not a page of twenty: this is a strip of avatars beside the page, and the
   * tab beneath it is what a reader clicks when they actually want the list. The
   * `total` still comes from the profile's own counter, so the number never disagrees
   * with the stat tile above it.
   */
  const { data: followersPreview = null } = useQuery<{ items: { id: string; username: string; avatar: string | null }[]; total: number }>({
    queryKey: ["profile-followers-preview", profile?.id],
    queryFn:  () => api.get(`/users/${profile!.id}/followers?page=1&limit=5`),
    enabled:  !!profile?.id,
    staleTime: 60_000,
  });

  const pluginTabs = slotRegistry.getProfileTabs();
  // The Warnings tab: the member's own, and staff's. Nobody else learns it exists —
  // the server refuses them too (GET /users/:id/standing), this only spares the button.
  const isStaffViewer = userCan(viewer, "moderation.warn.manage");
  const canSeeStanding = !!profile && (profile.isOwn || isStaffViewer);
  // Warnings goes LAST, after any plugin tabs (Forum…): it is the member's private
  // record, not part of what the profile shows everyone.
  const TABS = [
    ...STATIC_TAB_IDS.map((id) => ({ id, label: t(`tabs.${id}`) })),
    ...pluginTabs.map((pt) => ({ id: pt.id, label: pt.label })),
    ...(canSeeStanding ? [{ id: "warnings", label: t("tabs.warnings") }] : []),
  ];

  // Plugin profile stats — hooks MUST be before any early returns
  const pluginStatSlots = slotRegistry.getProfileStats();
  const [pluginStatValues, setPluginStatValues] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!profile?.id) return;
    pluginStatSlots.forEach((s) => {
      s.fetchValue(profile.id)
        .then((val) => setPluginStatValues((prev) => ({ ...prev, [s.id]: val })));
    });
  }, [profile?.id]);

  const followMutation = useMutation({
    mutationFn: (following: boolean) =>
      following
        ? api.delete(`/users/${profile!.id}/follow`)
        : api.post(`/users/${profile!.id}/follow`),
    onMutate: async (currentlyFollowing) => {
      await queryClient.cancelQueries({ queryKey: ["profile", username] });
      const prev = queryClient.getQueryData<PublicProfile>(["profile", username]);
      queryClient.setQueryData<PublicProfile>(["profile", username], (old) =>
        old
          ? {
              ...old,
              viewerIsFollowing: !currentlyFollowing,
              followerCount: old.followerCount + (currentlyFollowing ? -1 : 1),
            }
          : old,
      );
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["profile", username], ctx.prev);
      swalToast(apiErrorMessage(err, t("followError")));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["profile", username] }),
  });

  const blockMutation = useMutation({
    mutationFn: (blocked: boolean) =>
      blocked
        ? api.delete(`/users/${profile!.id}/block`)
        : api.post(`/users/${profile!.id}/block`),
    onSuccess: () => {
      // Blocking severs follows and hides content everywhere — refetch broadly.
      queryClient.invalidateQueries({ queryKey: ["profile", username] });
      queryClient.invalidateQueries({ queryKey: ["articles-by-author", profile!.id] });
      queryClient.invalidateQueries({ queryKey: ["profile-comments", profile!.id] });
    },
    onError: (e) => swalToast(apiErrorMessage(e, t("blockError"))),
  });

  async function handleBlockToggle() {
    if (!profile) return;
    if (profile.viewerHasBlocked) {
      blockMutation.mutate(true); // unblock — no confirm needed
      return;
    }
    const ok = await swalConfirm(
      t("blockConfirmTitle", { username: profile.username }),
      t("blockConfirmText"),
      t("block"),
      t("actions.cancel", { ns: "common" }),
    );
    if (ok) blockMutation.mutate(false);
  }

  if (isLoading) return <div className="profile-state">{t("loadingProfile")}</div>;
  if (error)
    return (
      <div className="profile-state profile-state--error">
        {(error as any)?.status === 404 ? t("notFound") : t("loadError")}
      </div>
    );
  if (!profile) return <div className="profile-state">{t("notFound")}</div>;

  const stats = [
    { value: profile.articleCount,      label: t("stat.articles"),  onClick: () => setTab("articles") },
    ...pluginStatSlots.map((s) => {
      const targetTab = s.tabId;
      return {
        value:   pluginStatValues[s.id] ?? 0,
        label:   s.label,
        onClick: targetTab ? () => setTab(targetTab) : undefined,
      };
    }),
    { value: profile.likeCountReceived, label: t("stat.likes"),     onClick: undefined },
    { value: profile.followerCount,     label: t("stat.followers"), onClick: () => setTab("followers") },
    { value: profile.followingCount,    label: t("stat.following"), onClick: () => setTab("following") },
  ] as { value: number; label: string; onClick: (() => void) | undefined }[];

  // Everything the profile blocks read. The host resolves it once — the queries,
  // the tab state, the plugin stat slots and the follow/block handlers — so no
  // block fetches and none of them can widen what a viewer sees.
  const context: ProfileContext = {
    profile,
    isAuthenticated,
    tab: tab === "warnings" && !canSeeStanding ? "articles" : tab,
    setTab: (id: string) => setTab(id as Tab),
    tabs: TABS,
    stats,
    infoFields,
    progression,
    followers: followersPreview,
    onFollow: () => followMutation.mutate(profile.viewerIsFollowing),
    onBlockToggle: () => { void handleBlockToggle(); },
    followPending: followMutation.isPending,
    blockPending: blockMutation.isPending,
  };

  return (
    <div className="profile-page">
      <LayoutRenderer templateKey="profile" document={layout} context={context} />
    </div>
  );
}

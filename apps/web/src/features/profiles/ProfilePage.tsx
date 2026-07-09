import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHeart, faGlobe, faCodeBranch, faHashtag, faLock, faUserSlash, faUserCheck } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { swalToast, swalConfirm, apiErrorMessage } from "../../lib/swal";
import {
  articlesApi,
  type ArticleListItem,
} from "../../lib/articlesApi";
import { MiniEditor, type MiniEditorHandle } from "../../components/MiniEditor";
import { Username } from "../../components/Username";
import { slotRegistry } from "../../plugins/slotRegistry";
import "./ProfilePage.scss";

interface PublicProfile {
  id: string;
  username: string;
  displayName: string | null;
  namePreference: "username" | "fullName";
  previousUsernames: Array<{ username: string; changedAt: string }>;
  avatar: string | null;
  bio: string | null;
  joinedDate: string;
  groups: Array<{ id: string; name: string; icon: string | null; badgeColor: string | null; badgeLabel: string | null }>;
  postCount: number;
  articleCount: number;
  followerCount: number;
  followingCount: number;
  likeCountReceived: number;
  dobLabel: string | null;
  dobDisplayFormat: string | null;
  isOwn: boolean;
  viewerIsFollowing: boolean;
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
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  deletedReason: string | null;
  deletedByUsername: string | null;
  author: { id: string; username: string; avatar: string | null; badgeColor: string | null };
}

type Tab = "articles" | "wall" | "followers" | "following" | "information" | string;

const STATIC_TAB_IDS = ["articles", "wall", "followers", "following", "information"] as const;

interface PublicProfileField {
  key: string;
  label: string;
  type: string;
  value: string;
}

function Avatar({ user, size = 40 }: { user: { username: string; avatar: string | null }; size?: number }) {
  if (user.avatar) {
    return <img src={user.avatar} alt={user.username} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }} />;
  }
  return (
    <div className="profile-av-small" style={{ width: size, height: size, fontSize: size * 0.4 }}>
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

function UserList({ userId, type }: { userId: string; type: "followers" | "following" }) {
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
    ? new Date(a.publishedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : t("unpublished");
  const views = 0;

  return (
    <Link to={`/articles/${a.slug}`} className="profile-articles__row">
      <div className="profile-articles__body">
        <div className="profile-articles__title">
          {a.title || <em>{t("untitled")}</em>}
        </div>
        <div className="profile-articles__meta">
          {dateLabel} · {t("minRead", { n: a.readTime })} · {t("views", { v: views.toLocaleString() })}
        </div>
      </div>
      {a.category && (
        <span className="profile-articles__badge">{a.category.name}</span>
      )}
    </Link>
  );
}

const ARTICLES_PER_PAGE = 5;

function ProfileArticlesTab({ profile }: { profile: PublicProfile }) {
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
      {profile.isOwn && (
        <div className="profile-articles__head">
          <Link to="/articles/new" className="profile-articles__new">{t("newArticle")}</Link>
        </div>
      )}

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
        <FontAwesomeIcon icon={icon} /> {field.label}
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
        <span className="profile-info-card__field-label"><FontAwesomeIcon icon={icon} /> {field.label}:</span>
        <span className="profile-info-card__field-value">{field.value}</span>
      </div>
    );
  }

  return (
    <div className="profile-info-card__field">
      <span className="profile-info-card__field-label"><FontAwesomeIcon icon={icon} /> {field.label}:</span>
      <span className="profile-info-card__field-value">{field.value}</span>
    </div>
  );
}

const LINK_KEYS = new Set(["website", "github", "discord"]);

function InformationTab({
  profile,
  fields,
}: {
  profile: PublicProfile;
  fields: PublicProfileField[];
}) {
  const { t } = useTranslation("profiles");
  const hasBio = !!profile.bio;
  const hasDob = !!profile.dobLabel;
  const linkFields = fields.filter((f) => LINK_KEYS.has(f.key));
  const hasLinks = linkFields.length > 0;
  const dobSectionLabel = profile.dobDisplayFormat === "age" ? t("age") : t("birthdate");

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
          <span className="profile-info-card__dob-value">{profile.dobLabel}</span>
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

function ProfileWall({ profile }: { profile: PublicProfile }) {
  const { t } = useTranslation("profiles");
  const { user: authUser, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState("");
  const commentEditorRef = useRef<MiniEditorHandle>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["profile-comments", profile.id],
    queryFn: () => api.get<{ comments: ProfileComment[]; total: number; viewerLikedIds: string[] }>(`/users/${profile.id}/profile-comments?limit=20`),
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
  const viewerLikedIds = new Set(data?.viewerLikedIds ?? []);

  function handleSubmit() {
    if (!commentBody.trim()) return;
    postMutation.mutate(commentBody);
  }

  return (
    <div className="profile-wall">
      <h3 className="profile-wall__title">{t("wallTitle")}</h3>

      {canComment && (
        <div className="profile-wall__compose">
          <Avatar user={authUser!} size={36} />
          <div className="profile-wall__compose-inner">
            <MiniEditor
              ref={commentEditorRef}
              onChange={setCommentBody}
              placeholder={t("wallPlaceholder", { username: profile.username })}
              disabled={postMutation.isPending}
              onSubmit={handleSubmit}
            />
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={handleSubmit}
              disabled={!commentBody.trim() || postMutation.isPending}
            >
              {postMutation.isPending ? t("posting") : t("post")}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="profile-empty">{t("loadingComments")}</p>
      ) : !data?.comments.length ? (
        <p className="profile-empty profile-empty--wall">{t("noComments")}</p>
      ) : (
        <div className="profile-wall__comments">
          {data.comments.map((c) => {
            const hasLiked = viewerLikedIds.has(c.id);
            return (
              <div key={c.id} className={`profile-wall__comment${c.deletedAt ? " profile-wall__comment--deleted" : ""}`}>
                {c.deletedAt ? (
                  <div className="profile-wall__tombstone">
                    <em>
                      {t("tombstoneBase", { user: c.author.username })}
                      {c.deletedByUsername ? t("tombstoneBy", { mod: c.deletedByUsername }) : ""}
                      {" · "}
                      {new Date(c.deletedAt).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" })}
                      {c.deletedReason ? t("tombstoneReason", { reason: c.deletedReason }) : ""}
                    </em>
                  </div>
                ) : (
                  <>
                    <Avatar user={c.author} size={36} />
                    <div className="profile-wall__comment-body">
                      <div className="profile-wall__comment-header">
                        <Username href={`/u/${c.author.username}`} className="profile-wall__comment-author" username={c.author.username} badgeColor={c.author.badgeColor} />
                        <time className="profile-wall__comment-time">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </time>
                        {(profile.isOwn || authUser?.id === c.authorId) && (
                          <button
                            className="profile-wall__comment-delete"
                            onClick={() => deleteMutation.mutate(c.id)}
                            title={t("deleteComment")}
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <div
                        className="profile-wall__comment-text"
                        dangerouslySetInnerHTML={{ __html: c.body }}
                      />
                      <div className="profile-wall__comment-footer">
                        {c.editedAt && <span className="profile-wall__comment-edited">{t("edited")}</span>}
                        {isAuthenticated && authUser?.id !== c.authorId ? (
                          <button
                            className={`profile-wall__like-btn${hasLiked ? " is-liked" : ""}`}
                            onClick={() => likeMutation.mutate({ commentId: c.id, liked: hasLiked })}
                            disabled={likeMutation.isPending}
                            title={hasLiked ? t("unlike") : t("like")}
                          >
                            <FontAwesomeIcon icon={faHeart} /> {c.likeCount}
                          </button>
                        ) : (
                          <span className="profile-wall__like-count">
                            <FontAwesomeIcon icon={faHeart} /> {c.likeCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
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
  const validTabIds = new Set<string>([...STATIC_TAB_IDS, ...pluginTabsInit.map((p) => p.id)]);
  const [tab, setTab] = useState<Tab>(requestedTab && validTabIds.has(requestedTab) ? requestedTab : "articles");
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

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

  const pluginTabs = slotRegistry.getProfileTabs();
  const TABS = [
    ...STATIC_TAB_IDS.map((id) => ({ id, label: t(`tabs.${id}`) })),
    ...pluginTabs.map((pt) => ({ id: pt.id, label: pt.label })),
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

  return (
    <div className="profile-page">
      <div className="profile-card">
        <div className="profile-header">
          <div className="profile-av">
            {profile.avatar ? (
              <img src={profile.avatar} alt={profile.username} />
            ) : (
              <span>{profile.username.charAt(0).toUpperCase()}</span>
            )}
          </div>

          <div className="profile-info">
            <div className="profile-title-row">
              <div className="profile-identity">
                <h1 className="profile-name">
                  <Username
                    username={profile.namePreference === "fullName" && profile.displayName ? profile.displayName : profile.username}
                    badgeColor={profile.groups[0]?.badgeColor}
                  />
                </h1>
                {profile.namePreference === "fullName" && profile.displayName && (
                  <p className="profile-handle">@{profile.username}</p>
                )}
                {profile.previousUsernames.length > 0 && (
                  <p className="profile-formerly">
                    {t("formerlyKnownAs", { names: profile.previousUsernames.map((p) => p.username).join(", ") })}
                  </p>
                )}
                <p className="profile-joined">
                  {t("memberSince", { date: new Date(profile.joinedDate).toLocaleDateString(undefined, { year: "numeric", month: "long" }) })}
                </p>
                {profile.isBanned ? (
                  <div className="profile-badges">
                    {(() => {
                      const color = "#ef4444";
                      return (
                        <span
                          className="profile-badge profile-badge--banned"
                          style={{
                            background: `${color}20`,
                            color,
                            border: `1px solid ${color}40`,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          <FontAwesomeIcon icon={faLock} />
                          {profile.isPermanentBan ? t("permanentlyBanned") : t("banned")}
                        </span>
                      );
                    })()}
                  </div>
                ) : profile.groups.length > 0 && (
                  <div className="profile-badges">
                    {profile.groups.map((g) => {
                      const color = g.badgeColor ?? "var(--c-accent)";
                      return (
                        <span
                          key={g.id}
                          className="profile-badge"
                          style={{
                            background: `${color}20`,
                            color,
                            border: `1px solid ${color}40`,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          {g.badgeLabel ?? g.name}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {!profile.isOwn && isAuthenticated && (
                <div className="profile-actions">
                  {!profile.viewerHasBlocked && (
                    <button
                      className={`profile-follow-btn${profile.viewerIsFollowing ? " profile-follow-btn--following" : ""}`}
                      onClick={() => followMutation.mutate(profile.viewerIsFollowing)}
                      disabled={followMutation.isPending}
                    >
                      {profile.viewerIsFollowing ? t("following") : t("follow")}
                    </button>
                  )}

                  {/* Plugin-contributed actions (e.g. messaging PM button) */}
                  {!profile.viewerHasBlocked &&
                    slotRegistry.getProfileActions().map((a) => (
                      <a.component
                        key={a.id}
                        profileId={profile.id}
                        profileUsername={profile.username}
                        isOwn={profile.isOwn}
                      />
                    ))}

                  {/* Block / Unblock — core */}
                  <button
                    className={`profile-icon-btn${profile.viewerHasBlocked ? " profile-icon-btn--active" : ""}`}
                    onClick={handleBlockToggle}
                    disabled={blockMutation.isPending}
                    title={profile.viewerHasBlocked ? t("unblock") : t("block")}
                    aria-label={profile.viewerHasBlocked ? t("unblock") : t("block")}
                  >
                    <FontAwesomeIcon icon={profile.viewerHasBlocked ? faUserCheck : faUserSlash} />
                  </button>
                </div>
              )}
            </div>

            <p className="profile-bio">{profile.bio || t("noBio")}</p>

            <div className="profile-stats">
              {stats.map(({ value, label, onClick }) => (
                <div
                  key={label}
                  className={`profile-stat${onClick ? " profile-stat--clickable" : ""}`}
                  onClick={onClick}
                >
                  <span className="profile-stat__value">{value.toLocaleString()}</span>
                  <span className="profile-stat__label">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="profile-tabs">
        {TABS.map((tabItem) => (
          <button
            key={tabItem.id}
            className={`profile-tab${tab === tabItem.id ? " profile-tab--active" : ""}`}
            onClick={() => setTab(tabItem.id)}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      <div className="profile-content">
        {tab === "articles"    && <ProfileArticlesTab profile={profile} />}
        {tab === "wall"        && <ProfileWall profile={profile} />}
        {tab === "followers"   && <UserList userId={profile.id} type="followers" />}
        {tab === "following"   && <UserList userId={profile.id} type="following" />}
        {tab === "information" && <InformationTab profile={profile} fields={infoFields} />}
        {pluginTabs.map((pt) =>
          tab === pt.id && (
            <pt.component
              key={pt.id}
              profileId={profile.id}
              profileUsername={profile.username}
              isOwn={profile.isOwn}
            />
          ),
        )}
      </div>
    </div>
  );
}

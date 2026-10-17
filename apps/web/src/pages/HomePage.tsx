import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../components/Icon";
import {
  faHouse, faStar, faComments, faHeart, faPenToSquare, faImage, faSquarePollVertical,
  faEllipsis, faShareNodes, faBookmark, faFire, faTag, faLink, faFlag, faCheck, faArrowRight,
} from "@fortawesome/free-solid-svg-icons";
import { CorePermissions } from "@xentium/contracts";
import { articlesApi, articleCategoriesApi, type ArticleListItem, type HomeFeed } from "../lib/articlesApi";
import { userCan } from "../lib/authStore";
import { toast } from "../lib/toast";
import { apiErrorMessage } from "../lib/swal";
import { api } from "../lib/api";
import { timeAgo } from "../lib/time";
import { useAuth } from "../hooks/useAuth";
import { Avatar } from "../components/Avatar";
import { primaryBadgeColor, topGroups } from "../lib/groupBadge";
import { Username } from "../components/Username";
import "./HomePage.scss";
import { LayoutRenderer } from "../layout/LayoutRenderer";
import { useLayoutDocument } from "../layout/useLayout";
import { RankBadge } from "../components/RankBadge";
import { SETUP_STEP_LINK, type SetupStep } from "../lib/setupSteps";

/* ── helpers ──────────────────────────────────────────────────────────── */

const SPACE_COLORS = ["#0d7c72", "#3f5a8a", "#8a3f5c", "#6b5a2e", "#b4532a", "#4d6b3a"];

/* ── left rail ────────────────────────────────────────────────────────── */

export function MeCard() {
  const { t } = useTranslation("home");
  const { user } = useAuth();
  if (!user) return null;
  const badges = topGroups(user.groups, (g) => g.displayOrder, 3);
  return (
    <section className="hf-mecard">
      <div className="hf-mecard__band" />
      <Avatar user={{ username: user.username, avatar: user.avatar }} size={62} online className="hf-mecard__ava" />
      <div className="hf-mecard__name">
        <Username username={user.username} badgeColor={primaryBadgeColor(user.visibleGroups)} />
      </div>
      <div className="hf-mecard__handle">@{user.username}</div>
      {badges.length > 0 && (
        <div className="hf-mecard__badges">
          {badges.map((g) => (
            <RankBadge key={g.id} groupKey={g.key} label={g.badgeLabel ?? g.name}>
              <span className="hf-levelpill"
                style={g.badgeColor ? { background: `${g.badgeColor}22`, color: g.badgeColor } : undefined}>
                {g.badgeLabel ?? g.name}
              </span>
            </RankBadge>
          ))}
        </div>
      )}
      <div className="hf-mecard__stats">
        <div><b>{user.postCount ?? 0}</b><span>{t("meCard.posts")}</span></div>
        <div><b>{user.followerCount ?? 0}</b><span>{t("meCard.followers")}</span></div>
        <div><b>{user.followingCount ?? 0}</b><span>{t("meCard.following")}</span></div>
      </div>
    </section>
  );
}

/** The home lists the menu and the feed agree on, read from `?filter=`. */
const HOME_FEEDS: HomeFeed[] = ["latest", "following", "top", "liked", "saved", "mine"];
function useHomeFilter(): [HomeFeed, (next: HomeFeed) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("filter") as HomeFeed | null;
  const filter: HomeFeed = raw && HOME_FEEDS.includes(raw) ? raw : "latest";
  const set = (next: HomeFeed) => {
    const p = new URLSearchParams(params);
    if (next === "latest") p.delete("filter"); else p.set("filter", next);
    setParams(p, { replace: true });
  };
  return [filter, set];
}

/** The categories and tags the member follows, shared by every follow toggle on the page. */
function useFollowedTopics() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["followed-topics"],
    queryFn: () => articlesApi.followedTopics(),
    enabled: !!user,
    staleTime: 60_000,
  });
  const toggle = useMutation({
    mutationFn: ({ kind, id, on }: { kind: "category" | "tag"; id: string; on: boolean }) =>
      kind === "category"
        ? (on ? articlesApi.followCategory(id) : articlesApi.unfollowCategory(id))
        : (on ? articlesApi.followTag(id) : articlesApi.unfollowTag(id)),
    onSuccess: (next) => {
      qc.setQueryData(["followed-topics"], next);
      qc.invalidateQueries({ queryKey: ["articles-home", "following"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const follows = (kind: "category" | "tag", id: string) =>
    !!(kind === "category" ? data?.categories : data?.tags)?.some((x) => x.id === id);
  return { follows, toggle: (kind: "category" | "tag", id: string) => toggle.mutate({ kind, id, on: !follows(kind, id) }) };
}

export function SectionNav() {
  const { t } = useTranslation(["common", "home"]);
  const [filter] = useHomeFilter();
  // Home's lists, all of them views of the feed: what the member follows (categories
  // and tags), wrote, liked and saved.
  const items: { icon: typeof faHouse; label: string; feed: HomeFeed }[] = [
    { icon: faHouse,    label: t("common:nav.home"),    feed: "latest" },
    { icon: faStar,     label: t("home:nav.following"), feed: "following" },
    { icon: faComments, label: t("home:nav.myThreads"), feed: "mine" },
    { icon: faHeart,    label: t("home:nav.liked"),     feed: "liked" },
    { icon: faBookmark, label: t("home:nav.saved"),     feed: "saved" },
  ];
  return (
    <nav className="hf-sidenav">
      {items.map((it) => {
        const on = filter === it.feed || (it.feed === "latest" && filter === "top");
        return (
          <Link key={it.feed} to={it.feed === "latest" ? "/" : `/?filter=${it.feed}`}
            className={`hf-sidenav__item${on ? " is-active" : ""}`} aria-current={on ? "page" : undefined}>
            <FontAwesomeIcon icon={it.icon} fixedWidth />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SpacesCard() {
  const { t } = useTranslation("home");
  const { user } = useAuth();
  const topics = useFollowedTopics();
  const { data: categories = [] } = useQuery({
    queryKey: ["article-categories"],
    queryFn: () => articleCategoriesApi.tree(),
  });
  if (categories.length === 0) return null;
  return (
    <section className="hf-spaces">
      <h4 className="hf-railhead">{t("spaces.title")}</h4>
      {categories.slice(0, 6).map((c, i) => {
        const on = topics.follows("category", c.id);
        return (
          <div key={c.id} className="hf-space">
            <Link to={`/articles?filter=${c.id}`} className="hf-space__link">
              <i style={{ background: SPACE_COLORS[i % SPACE_COLORS.length] }} />
              {c.name}
            </Link>
            {/* Following a category fills the Following list with its articles. */}
            {user && (
              <button type="button" className={`hf-space__follow${on ? " is-on" : ""}`}
                aria-pressed={on}
                title={t(on ? "spaces.unfollow" : "spaces.follow", { name: c.name })}
                aria-label={t(on ? "spaces.unfollow" : "spaces.follow", { name: c.name })}
                onClick={() => topics.toggle("category", c.id)}>
                <FontAwesomeIcon icon={faStar} />
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

/* ── center column ────────────────────────────────────────────────────── */

function Composer() {
  const { t } = useTranslation("home");
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="hf-composer">
      <Avatar user={{ username: user.username, avatar: user.avatar }} size={42} />
      <Link to="/articles/new" className="hf-composer__input">
        {t("composer.placeholder")}
      </Link>
      <div className="hf-composer__btns">
        <Link to="/articles/new" title={t("composer.article")}><FontAwesomeIcon icon={faPenToSquare} /></Link>
        <Link to="/articles/new" title={t("composer.image")}><FontAwesomeIcon icon={faImage} /></Link>
        <Link to="/articles/new" title={t("composer.poll")}><FontAwesomeIcon icon={faSquarePollVertical} /></Link>
      </div>
    </div>
  );
}

/** The "…" menu on a card: link, follow its category and tags, edit, report. */
function CardMenu({ a }: { a: ArticleListItem }) {
  const { t } = useTranslation("home");
  const { user } = useAuth();
  const topics = useFollowedTopics();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const canEdit = !!user && (user.id === a.author.id || userCan(user, CorePermissions.ARTICLE_EDIT_ANY));
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <div className="hf-more-wrap" ref={ref}>
      <button className="hf-more" type="button" aria-label={t("post.more")} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        <FontAwesomeIcon icon={faEllipsis} />
      </button>
      {open && (
        <div className="xt-pop hf-menu" role="menu">
          <button type="button" role="menuitem" onClick={pick(() => copyArticleLink(a, t))}>
            <FontAwesomeIcon icon={faLink} fixedWidth /> {t("post.copyLink")}
          </button>
          {user && a.category && (
            <button type="button" role="menuitem" onClick={pick(() => topics.toggle("category", a.category!.id))}>
              <FontAwesomeIcon icon={faStar} fixedWidth />
              {t(topics.follows("category", a.category.id) ? "post.unfollowCategory" : "post.followCategory", { name: a.category.name })}
            </button>
          )}
          {user && a.tags.slice(0, 3).map((tag) => (
            <button key={tag.id} type="button" role="menuitem" onClick={pick(() => topics.toggle("tag", tag.id))}>
              <FontAwesomeIcon icon={faTag} fixedWidth />
              {t(topics.follows("tag", tag.id) ? "post.unfollowTag" : "post.followTag", { name: tag.name })}
            </button>
          ))}
          {canEdit && (
            <button type="button" role="menuitem" onClick={pick(() => navigate(`/articles/${a.slug}/edit`))}>
              <FontAwesomeIcon icon={faPenToSquare} fixedWidth /> {t("post.edit")}
            </button>
          )}
          {user && user.id !== a.author.id && (
            <button type="button" role="menuitem" onClick={pick(() => navigate(`/articles/${a.slug}?report=1`))}>
              <FontAwesomeIcon icon={faFlag} fixedWidth /> {t("post.report")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const articleUrl = (a: ArticleListItem) => `${window.location.origin}/articles/${a.slug}`;

async function copyArticleLink(a: ArticleListItem, t: (k: string) => string) {
  try {
    await navigator.clipboard.writeText(articleUrl(a));
    toast.success(t("post.linkCopied"));
  } catch {
    toast.error(t("post.copyFailed"));
  }
}

function ActivityCard({ a }: { a: ArticleListItem }) {
  const { t } = useTranslation("home");
  const qc = useQueryClient();
  const { user } = useAuth();
  // The viewer's own state comes with the list, so a heart starts filled when it is.
  const [liked, setLiked] = useState(!!a.viewer?.liked);
  const [likes, setLikes] = useState(a.likeCount);
  const [saved, setSaved] = useState(!!a.viewer?.saved);
  // One's own article cannot be liked (the API refuses it): the count shows, the
  // button does not offer what would fail.
  const own = !!user && user.id === a.author.id;

  const likeMut = useMutation({
    mutationFn: (next: boolean) => (next ? articlesApi.like(a.id) : articlesApi.unlike(a.id)),
    onMutate: (next) => { setLiked(next); setLikes((n) => n + (next ? 1 : -1)); },
    onError: (e, next) => { setLiked(!next); setLikes((n) => n + (next ? -1 : 1)); toast.error(apiErrorMessage(e)); },
    onSuccess: (res) => { if (typeof res?.likeCount === "number") setLikes(res.likeCount); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["articles-home", "liked"] }),
  });

  const saveMut = useMutation({
    mutationFn: (next: boolean): Promise<unknown> => (next ? articlesApi.save(a.id) : articlesApi.unsave(a.id)),
    onMutate: (next) => setSaved(next),
    onError: (e, next) => { setSaved(!next); toast.error(apiErrorMessage(e)); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["articles-home", "saved"] }),
  });

  /** The device's own share sheet where there is one; otherwise the link goes to the clipboard. */
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: a.title, url: articleUrl(a) }); } catch { /* dismissed */ }
      return;
    }
    await copyArticleLink(a, t);
  };

  const badges = topGroups(a.author.groups ?? [], (g) => g.group.displayOrder, 3).map((x) => x.group);
  const signIn = () => toast.info(t("post.signInFirst"));

  return (
    <article className="hf-post">
      <div className="hf-post__head">
        <Avatar user={{ username: a.author.username, avatar: a.author.avatar }} size={44} />
        <div className="hf-post__id">
          <div className="hf-post__name">
            <Link to={`/u/${a.author.username}`}>
              <Username username={a.author.username} badgeColor={a.author.badgeColor} />
            </Link>
            {badges.map((g) => {
              const color = g.progression?.badgeColor ?? a.author.badgeColor ?? undefined;
              return (
                <RankBadge key={g.id} groupKey={g.key} label={g.progression?.badgeLabel ?? g.name}>
                  <span className="hf-rolepill"
                    style={color ? { background: `${color}22`, color } : undefined}>
                    {g.progression?.badgeLabel ?? g.name}
                  </span>
                </RankBadge>
              );
            })}
          </div>
          <span className="hf-post__sub">
            {a.category
              ? <>{t("post.postedIn")} <b>{a.category.name}</b></>
              : t("post.posted")} · {timeAgo(a.publishedAt ?? a.updatedAt, { compact: true })}
          </span>
        </div>
        <CardMenu a={a} />
      </div>

      <Link to={`/articles/${a.slug}`} className="hf-artcard">
        <div
          className="hf-artcard__media"
          style={a.featuredImage
            ? { backgroundImage: `url(/uploads/${a.featuredImage})` }
            : { background: "var(--c-accent-soft)" }}
        >
          <span className="hf-readtag">{t("post.readTime", { n: a.readTime })}</span>
        </div>
        <div className="hf-artcard__body">
          <h3>{a.title || t("post.untitled")}</h3>
          {a.excerpt && <p>{a.excerpt}</p>}
        </div>
      </Link>

      <div className="hf-post__actions">
        <button
          type="button"
          className={`hf-act hf-act--like${liked ? " is-on" : ""}`}
          aria-pressed={liked}
          disabled={own || likeMut.isPending}
          title={own ? t("post.ownArticle") : t(liked ? "post.unlike" : "post.like")}
          onClick={() => (user ? likeMut.mutate(!liked) : signIn())}
        >
          <FontAwesomeIcon icon={faHeart} /> {likes}
        </button>
        <Link to={`/articles/${a.slug}#comments`} className="hf-act">
          <FontAwesomeIcon icon={faComments} /> {a.commentCount}
        </Link>
        <button type="button" className="hf-act" onClick={share}>
          <FontAwesomeIcon icon={faShareNodes} /> {t("post.share")}
        </button>
        <button
          type="button"
          className={`hf-save${saved ? " is-on" : ""}`}
          aria-pressed={saved}
          disabled={saveMut.isPending}
          onClick={() => (user ? saveMut.mutate(!saved) : signIn())}
        >
          <FontAwesomeIcon icon={faBookmark} /> {saved ? t("post.saved") : t("post.save")}
        </button>
      </div>
    </article>
  );
}

export function Feed() {
  const { t } = useTranslation("home");
  const [filter, setFilter] = useHomeFilter();
  const { data, isLoading } = useQuery({
    queryKey: ["articles-home", filter],
    queryFn: () => articlesApi.list({ page: 1, limit: 12, feed: filter }),
  });
  const articles = data?.data ?? [];

  const chips: { id: HomeFeed; label: string }[] = [
    { id: "latest", label: t("feed.latest") },
    { id: "following", label: t("feed.following") },
    { id: "top", label: t("feed.top") },
  ];
  // Liked, saved and mine are the member's own lists, opened from the menu: a title
  // and a way back, rather than a chip that is never otherwise reachable.
  const ownList = filter === "liked" || filter === "saved" || filter === "mine";

  return (
    <main className="hf-feed">
      <Composer />
      {ownList ? (
        <div className="hf-feedtitle">
          <h2>{t(`feed.title.${filter}`)}</h2>
          <button type="button" className="hf-feedtitle__back" onClick={() => setFilter("latest")}>{t("feed.backToAll")}</button>
        </div>
      ) : (
        <div className="hf-feedfilter">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              className={filter === c.id ? "is-on" : ""}
              aria-pressed={filter === c.id}
              onClick={() => setFilter(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {isLoading && <div className="hf-feed__empty">{t("feed.loading")}</div>}
      {!isLoading && articles.length === 0 && (
        <div className="hf-feed__empty">
          {t(filter === "latest" || filter === "top" ? "feed.empty" : `feed.empty_${filter}`)}
        </div>
      )}
      {/* Keyed by list, so a card's own liked/saved state starts from what this list says. */}
      {articles.map((a) => <ActivityCard key={`${filter}:${a.id}`} a={a} />)}
    </main>
  );
}

/* ── right rail ───────────────────────────────────────────────────────── */

/**
 * ⚠ `ProgressionCard` lived here and is gone. It drew a second progress bar against
 * `GET /users/me/progression`, in the `home` namespace, for the same thing the
 * profile rail already drew — see `features/progression/rank.tsx`. The
 * `homeProgression` block renders `RankProgress` now, so the two agree by
 * construction rather than by anyone remembering to update both.
 */

interface SuggestedUser {
  id: string;
  username: string;
  avatar: string | null;
  role: string | null;
  badgeColor: string | null;
}

export function SuggestedPeople() {
  const { t } = useTranslation("home");
  const { isAuthenticated } = useAuth();
  const { data } = useQuery<SuggestedUser[]>({
    queryKey: ["suggested-people"],
    queryFn: () => api.get("/users/suggested"),
    enabled: isAuthenticated,
  });
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const followMut = useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/follow`),
    onMutate: (id) => setFollowed((s) => new Set(s).add(id)),
    onError: (_e, id) => setFollowed((s) => { const n = new Set(s); n.delete(id); return n; }),
  });

  if (!data || data.length === 0) return null;
  return (
    <section className="hf-card">
      <h4 className="hf-railhead hf-railhead--row">{t("suggested.title")}</h4>
      <ul className="hf-people">
        {data.map((p) => {
          const isF = followed.has(p.id);
          return (
            <li key={p.id}>
              <Avatar user={{ username: p.username, avatar: p.avatar }} size={38} />
              <div className="hf-people__id">
                <Link to={`/u/${p.username}`}><b><Username username={p.username} badgeColor={p.badgeColor} /></b></Link>
                {p.role && <span>{p.role}</span>}
              </div>
              <button
                className={`hf-followbtn${isF ? " is-following" : ""}`}
                onClick={() => !isF && followMut.mutate(p.id)}
                disabled={isF}
                type="button"
              >
                {isF ? t("suggested.following") : t("suggested.follow")}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface HotItem {
  id: string;
  title: string;
  link: string;
  categoryLabel?: string | null;
  metric?: number;
  author?: { username: string; avatar: string | null } | null;
}

export function HotThreads() {
  const { t } = useTranslation("home");
  const { data } = useQuery<{ enabled: boolean; items: HotItem[] }>({
    queryKey: ["hot-threads"],
    queryFn: () => api.get("/home/hot-threads"),
  });
  if (!data?.enabled || data.items.length === 0) return null;
  return (
    <section className="hf-card">
      <h4 className="hf-railhead hf-railhead--row">{t("hotThreads.title")} <FontAwesomeIcon icon={faFire} /></h4>
      <ul className="hf-hot">
        {data.items.map((it) => (
          <li key={it.id}>
            {it.author && <Avatar user={it.author} size={32} />}
            <Link to={it.link} className="hf-hot__body">
              <p>{it.title}</p>
              <span>{it.categoryLabel} · {t("hotThreads.replies", { count: it.metric ?? 0 })}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PopularTags() {
  const { t } = useTranslation("home");
  const { data } = useQuery<{ name: string; slug: string; count: number }[]>({
    queryKey: ["popular-tags"],
    queryFn: () => articlesApi.popularTags(),
  });
  if (!data || data.length === 0) return null;
  return (
    <section className="hf-card">
      <h4 className="hf-railhead hf-railhead--row">{t("tags.title")} <FontAwesomeIcon icon={faTag} /></h4>
      <div className="hf-tags">
        {data.map((tag) => (
          <Link key={tag.slug} to={`/search?q=${encodeURIComponent(tag.name)}`} className="hf-tag">
            #{tag.name}<em>{tag.count}</em>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * "Set up your community": the ACP dashboard's checklist, on the page an admin lands
 * on after installing. Only for someone who may open the ACP, and only while the
 * site is young with steps left (`stage: "new"`); everyone else gets nothing, so the
 * rail is unchanged for members. Without it a fresh install greeted its admin with
 * an empty feed and no hint of what to do next.
 */
export function SetupChecklist() {
  const { t } = useTranslation("acp", { keyPrefix: "dashboard" });
  const { user } = useAuth();
  const isAdmin = userCan(user, CorePermissions.ADMIN_ACCESS);
  const { data } = useQuery<{ stage: "new" | "active"; steps: SetupStep[] }>({
    queryKey: ["home-setup"],
    queryFn: () => api.get("/admin/dashboard/setup"),
    enabled: isAdmin,
    staleTime: 60_000,
  });
  if (!isAdmin || !data || data.stage !== "new") return null;

  const next = data.steps.findIndex((s) => !s.done);
  const done = data.steps.filter((s) => s.done).length;
  return (
    <section className="hf-card hf-setup">
      <h4 className="hf-railhead hf-railhead--row">
        {t("setupTitle")}
        <span className="hf-setup__n">{t("setupCount", { done, total: data.steps.length })}</span>
      </h4>
      <div className="hf-setup__bar" aria-hidden>
        {data.steps.map((s) => <i key={s.key} className={s.done ? "is-done" : ""} />)}
      </div>
      <ul className="hf-setup__list">
        {data.steps.map((s, i) => {
          const to = SETUP_STEP_LINK[s.key];
          const cls = `hf-setup__step${s.done ? " is-done" : ""}${i === next ? " is-next" : ""}`;
          const body = (
            <>
              <span className="hf-setup__dot">{s.done && <FontAwesomeIcon icon={faCheck} />}</span>
              <span className="hf-setup__label">
                {t(`step.${s.key}`)}
                {i === next && <small>{t(`step.${s.key}Hint`)}</small>}
              </span>
              {!s.done && to && <FontAwesomeIcon icon={faArrowRight} className="hf-setup__go" />}
            </>
          );
          return <li key={s.key}>{!s.done && to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
        })}
      </ul>
    </section>
  );
}

/* ── page ─────────────────────────────────────────────────────────────── */

/**
 * Host container for the `home` template (ADR-0005).
 *
 * Nothing to hoist: the home cards share no interaction state, so each block keeps
 * its own query. The guest/member split is not here either — it is an audience on the
 * default document, so an admin can change who sees what.
 */
export function HomePage() {
  const layout = useLayoutDocument("home");
  return <LayoutRenderer templateKey="home" document={layout} />;
}

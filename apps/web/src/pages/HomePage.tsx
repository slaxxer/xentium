import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHouse, faStar, faComments, faHeart, faPenToSquare, faImage, faSquarePollVertical,
  faEllipsis, faShareNodes, faBookmark, faUsers, faTrophy, faFire, faTag,
} from "@fortawesome/free-solid-svg-icons";
import { articlesApi, articleCategoriesApi, type ArticleListItem } from "../lib/articlesApi";
import { api } from "../lib/api";
import { timeAgo } from "../lib/time";
import { useAuth } from "../hooks/useAuth";
import { Avatar } from "../components/Avatar";
import { topGroups } from "../lib/groupBadge";
import { GuestHome } from "./GuestHome";
import { LayoutWidgetOutlet } from "../plugins/LayoutWidgetOutlet";
import "./HomePage.scss";

/* ── helpers ──────────────────────────────────────────────────────────── */

/** Deterministic placeholder media gradient for articles with no featured image. */
const MEDIA_GRADIENTS = [
  "linear-gradient(135deg,#7c84ff,#5865f2 55%,#2bd4ee)",
  "linear-gradient(135deg,#2bd4ee,#5865f2 55%,#7c84ff)",
  "linear-gradient(135deg,#5fe3c0,#23a55a 55%,#00b1cf)",
  "linear-gradient(135deg,#6bd4ff,#5865f2 60%,#8b8fff)",
];
function mediaGradient(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return MEDIA_GRADIENTS[Math.abs(h) % MEDIA_GRADIENTS.length]!;
}

const SPACE_COLORS = ["#5865f2", "#00b1cf", "#23a55a", "#f4a259", "#5b8def", "#7c84ff"];

type FeedFilter = "latest" | "following" | "top";

/* ── left rail ────────────────────────────────────────────────────────── */

function MeCard() {
  const { user } = useAuth();
  if (!user) return null;
  const badges = topGroups(user.groups, (g) => g.displayOrder, 3);
  return (
    <section className="hf-mecard">
      <div className="hf-mecard__band" />
      <Avatar user={{ username: user.username, avatar: user.avatar }} size={62} online className="hf-mecard__ava" />
      <div className="hf-mecard__name">{user.username}</div>
      <div className="hf-mecard__handle">@{user.username}</div>
      {badges.length > 0 && (
        <div className="hf-mecard__badges">
          {badges.map((g) => (
            <span key={g.id} className="hf-levelpill"
              style={g.badgeColor ? { background: `${g.badgeColor}22`, color: g.badgeColor } : undefined}>
              {g.badgeLabel ?? g.name}
            </span>
          ))}
        </div>
      )}
      <div className="hf-mecard__stats">
        <div><b>{user.postCount ?? 0}</b><span>posts</span></div>
        <div><b>{user.followerCount ?? 0}</b><span>followers</span></div>
        <div><b>{user.followingCount ?? 0}</b><span>following</span></div>
      </div>
    </section>
  );
}

function SectionNav() {
  const { t } = useTranslation(["common", "home"]);
  const items = [
    { icon: faHouse,    label: t("common:nav.home"),      to: "/", active: true },
    { icon: faStar,     label: t("home:nav.following"),   to: "/?filter=following" },
    { icon: faComments, label: t("home:nav.myThreads"),   to: "/articles?filter=drafts" },
    { icon: faHeart,    label: t("home:nav.liked"),       to: "/?filter=liked" },
    { icon: faUsers,    label: t("common:nav.members"),   to: "/members" },
  ];
  return (
    <nav className="hf-sidenav">
      {items.map((it) => (
        <Link key={it.label} to={it.to} className={`hf-sidenav__item${it.active ? " is-active" : ""}`}>
          <FontAwesomeIcon icon={it.icon} fixedWidth />
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

function SpacesCard() {
  const { t } = useTranslation("home");
  const { data: categories = [] } = useQuery({
    queryKey: ["article-categories"],
    queryFn: () => articleCategoriesApi.tree(),
  });
  if (categories.length === 0) return null;
  return (
    <section className="hf-spaces">
      <h4 className="hf-railhead">{t("spaces.title")}</h4>
      {categories.slice(0, 6).map((c, i) => (
        <Link key={c.id} to={`/articles?filter=${c.id}`} className="hf-space">
          <i style={{ background: SPACE_COLORS[i % SPACE_COLORS.length] }} />
          {c.name}
        </Link>
      ))}
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

function ActivityCard({ a }: { a: ArticleListItem }) {
  const { t } = useTranslation("home");
  const qc = useQueryClient();
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(a.likeCount);
  const [saved, setSaved] = useState(false);

  const likeMut = useMutation({
    mutationFn: () => (liked ? articlesApi.unlike(a.id) : articlesApi.like(a.id)),
    onMutate: () => { setLiked((v) => !v); setLikes((n) => n + (liked ? -1 : 1)); },
    onError: () => { setLiked((v) => !v); setLikes((n) => n + (liked ? 1 : -1)); },
    onSuccess: (res: any) => { if (typeof res?.likeCount === "number") setLikes(res.likeCount); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["articles-home"] }),
  });

  const badges = topGroups(a.author.groups ?? [], (g) => g.group.displayOrder, 3).map((x) => x.group);

  return (
    <article className="hf-post">
      <div className="hf-post__head">
        <Avatar user={{ username: a.author.username, avatar: a.author.avatar }} size={44} />
        <div className="hf-post__id">
          <div className="hf-post__name">
            <Link to={`/u/${a.author.username}`}>{a.author.username}</Link>
            {badges.map((g) => {
              const color = g.progression?.badgeColor ?? a.author.badgeColor ?? undefined;
              return (
                <span key={g.id} className="hf-rolepill"
                  style={color ? { background: `${color}22`, color } : undefined}>
                  {g.progression?.badgeLabel ?? g.name}
                </span>
              );
            })}
          </div>
          <span className="hf-post__sub">
            {a.category
              ? <>{t("post.postedIn")} <b>{a.category.name}</b></>
              : t("post.posted")} · {timeAgo(a.publishedAt ?? a.updatedAt, { compact: true })}
          </span>
        </div>
        <button className="hf-more" type="button" aria-label={t("post.more")}><FontAwesomeIcon icon={faEllipsis} /></button>
      </div>

      <Link to={`/articles/${a.slug}`} className="hf-artcard">
        <div
          className="hf-artcard__media"
          style={a.featuredImage
            ? { backgroundImage: `url(/uploads/${a.featuredImage})` }
            : { background: mediaGradient(a.id) }}
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
          onClick={() => likeMut.mutate()}
        >
          <FontAwesomeIcon icon={faHeart} /> {likes}
        </button>
        <Link to={`/articles/${a.slug}`} className="hf-act">
          <FontAwesomeIcon icon={faComments} /> {a.commentCount}
        </Link>
        <button type="button" className="hf-act">
          <FontAwesomeIcon icon={faShareNodes} /> {t("post.share")}
        </button>
        <button
          type="button"
          className={`hf-save${saved ? " is-on" : ""}`}
          onClick={() => setSaved((v) => !v)}
        >
          <FontAwesomeIcon icon={faBookmark} /> {saved ? t("post.saved") : t("post.save")}
        </button>
      </div>
    </article>
  );
}

function Feed() {
  const { t } = useTranslation("home");
  const [filter, setFilter] = useState<FeedFilter>("latest");
  const { data, isLoading } = useQuery({
    queryKey: ["articles-home", filter],
    queryFn: () => articlesApi.list({ page: 1, limit: 12, feed: filter }),
  });
  const articles = data?.data ?? [];

  const chips: { id: FeedFilter; label: string }[] = [
    { id: "latest", label: t("feed.latest") },
    { id: "following", label: t("feed.following") },
    { id: "top", label: t("feed.top") },
  ];

  return (
    <main className="hf-feed">
      <Composer />
      <div className="hf-feedfilter">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            className={filter === c.id ? "is-on" : ""}
            onClick={() => setFilter(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {isLoading && <div className="hf-feed__empty">{t("feed.loading")}</div>}
      {!isLoading && articles.length === 0 && (
        <div className="hf-feed__empty">{t("feed.empty")}</div>
      )}
      {articles.map((a) => <ActivityCard key={a.id} a={a} />)}
    </main>
  );
}

/* ── right rail ───────────────────────────────────────────────────────── */

interface ProgressionData {
  current: { badgeLabel: string | null; badgeColor: string | null } | null;
  next: { badgeLabel: string | null; badgeColor: string | null } | null;
  atTop: boolean;
  percent: number;
  primary: { label: string; have: number; need: number; remaining: number } | null;
}

function ProgressionCard() {
  const { t } = useTranslation("home");
  const { isAuthenticated } = useAuth();
  const { data } = useQuery<ProgressionData>({
    queryKey: ["me-progression"],
    queryFn: () => api.get("/users/me/progression"),
    enabled: isAuthenticated,
  });
  if (!data) return null;

  // Top of the ladder (or progression not configured) — no next rung.
  if (data.atTop || !data.next) {
    return (
      <section className="hf-card hf-prog">
        <div className="hf-prog__row"><b>{t("progression.topReached")}</b><span><FontAwesomeIcon icon={faTrophy} /></span></div>
        <p>{t("progression.topBody")}</p>
      </section>
    );
  }

  const { next, percent, primary } = data;
  const nextStyle = next.badgeColor ? { color: next.badgeColor } : undefined;
  return (
    <section className="hf-card hf-prog">
      <div className="hf-prog__row"><b>{t("progression.almostThere")}</b><span>{percent}%</span></div>
      <div className="hf-prog__bar"><i style={{ width: `${percent}%` }} /></div>
      <p>
        {primary
          ? <>{t("progression.remaining", {
              n: primary.remaining,
              // Core metric keys are translated; a plugin's own label falls through as-is.
              label: t(`progression.metric.${primary.label}`, { defaultValue: primary.label }),
            })} </>
          : <>{t("progression.keepGoing")} </>}
        <b style={nextStyle}><FontAwesomeIcon icon={faTrophy} /> {next.badgeLabel}</b>
      </p>
    </section>
  );
}

interface SuggestedUser {
  id: string;
  username: string;
  avatar: string | null;
  role: string | null;
  badgeColor: string | null;
}

function SuggestedPeople() {
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
                <Link to={`/u/${p.username}`}><b>{p.username}</b></Link>
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

function HotThreads() {
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

function PopularTags() {
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

/* ── page ─────────────────────────────────────────────────────────────── */

export function HomePage() {
  const { isAuthenticated, isLoading } = useAuth();

  // Logged-out visitors get the guest landing (hero + community feed + rail).
  // The Hearth 3-column home is the signed-in experience.
  if (!isLoading && !isAuthenticated) {
    return <GuestHome />;
  }

  return (
    <div className="hf-wrap">
      <aside className="hf-left">
        <MeCard />
        <SectionNav />
        <SpacesCard />
      </aside>

      <Feed />

      <aside className="hf-right">
        <LayoutWidgetOutlet outlet="aside" />
        <ProgressionCard />
        <HotThreads />
        <PopularTags />
        <SuggestedPeople />
      </aside>
    </div>
  );
}

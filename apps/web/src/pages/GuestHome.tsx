import { useState, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { timeAgo } from "../lib/time";
import { articlesApi, articleCategoriesApi, type ArticleListItem, type ArticleCategoryNode } from "../lib/articlesApi";
import { Avatar } from "../components/Avatar";
import "./GuestHome.scss";

/* ============================================================================
   Guest home (logged-out landing). Hearth design, wired to real public data.
   Hero copy + which sections appear + which feed sources are shown are configured
   in ACP → Appearance → Guest Home (GET /home/guest-config). Feed sources are
   "articles" (core) plus whatever plugins register (e.g. the forum) — this page
   has no hardcoded knowledge of any plugin; non-core items come from
   /home/feed-source/:id as normalized HomeFeedItems and render generically.
   ============================================================================ */

const ICONS: Record<string, string> = {
  arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  sparkles: '<path d="M9.94 14.5 9 19l-1-4.5L4 13.5l4-1L9 8l1 4.5 4 1z"/><path d="M18 4l.6 2.4L21 7l-2.4.6L18 10l-.6-2.4L15 7l2.4-.6z"/>',
  life: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/><line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/>',
  puzzle: '<path d="M15.5 8.5V6a2 2 0 0 0-2-2h-2.5a1.5 1.5 0 0 1 0-3 1.5 1.5 0 0 1 1.5 1.5"/><path d="M9 4H6a2 2 0 0 0-2 2v3.5a1.5 1.5 0 0 1-3 0A1.5 1.5 0 0 1 2.5 8"/><path d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5a1.5 1.5 0 0 0-3 0 1.5 1.5 0 0 0 1.5 1.5"/><path d="M20 9.5V6a2 2 0 0 0-2-2h-2.5"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  forum: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  changelog: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
};
function Icon({ name, size = 18, stroke = 2 }: { name: string; size?: number; stroke?: number }) {
  const d = ICONS[name];
  if (!d) return null;
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden dangerouslySetInnerHTML={{ __html: d }} />
  );
}

const CAT_COLORS = ["#5865f2", "#23a55a", "#00b1cf", "#f4a259", "#7c84ff", "#2a6fdb", "#0ea5a5", "#e0518a"];
const CAT_ICONS = ["changelog", "life", "sparkles", "puzzle", "zap", "forum"];
function hashIndex(key: string, mod: number) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}
const catColor = (key: string) => CAT_COLORS[hashIndex(key, CAT_COLORS.length)]!;
const catIcon = (id: string) => CAT_ICONS[hashIndex(id, CAT_ICONS.length)]!;
const hexSoft = (hex: string) => `color-mix(in srgb, ${hex} 13%, transparent)`;
const fmt = (n: number | undefined) => (n == null ? "—" : n.toLocaleString());

interface Stats { members: number; articles: number; today: number }
interface OnlineData { total: number; users: { username: string; avatar: string | null }[] }
interface PopularTag { name: string; slug: string; count: number }
interface HomeFeedItem {
  id: string; title: string; link: string; excerpt?: string | null; categoryLabel?: string | null;
  author?: { username: string; avatar: string | null } | null;
  metric?: number; metricLabel?: string; replies?: number; views?: number; createdAt: string;
}
interface GuestConfig {
  hero: { badge: string; title: string; subtitle: string; ctaPrimary: string; ctaSecondary: string };
  sections: { stats: boolean; presence: boolean; categories: boolean; online: boolean; tags: boolean };
  sources: string[];
  availableSources: { id: string; label: string }[];
}

const DEFAULT_CONFIG: GuestConfig = {
  hero: {
    badge: "builders online now",
    title: "Where people who build with nodevo hang out.",
    subtitle: "Ask questions, show what you made, shape the roadmap, and learn from {members} makers. Reading is open to everyone.",
    ctaPrimary: "Join the conversation",
    ctaSecondary: "Browse as guest",
  },
  sections: { stats: true, presence: true, categories: true, online: true, tags: true },
  sources: ["articles"],
  availableSources: [{ id: "articles", label: "Articles" }],
};

const GATE_COPY: Record<string, string> = {
  vote: "Create an account to like topics",
  post: "Sign up to start a new topic",
  more: "Create a free account to read everything",
  default: "Create a free account to do that",
};

// ── cards ───────────────────────────────────────────────────────────────────────
function ArticleCard({ a, onGate }: { a: ArticleListItem; onGate: (k: string) => void }) {
  const color = a.category ? catColor(a.category.id) : "var(--c-accent)";
  return (
    <article className="gthread">
      <button className="gvotes" title="Sign up to like" onClick={(e) => { e.stopPropagation(); onGate("vote"); }}>
        <span className="gvotes__n">{a.likeCount}</span><span className="gvotes__l">likes</span>
      </button>
      <div className="gthread__main">
        {a.category && (
          <div className="gthread__meta">
            <span className="gcat" style={{ color, background: hexSoft(color) }}><i style={{ background: color }} />{a.category.name}</span>
          </div>
        )}
        <h3 className="gthread__title"><Link to={`/articles/${a.slug}`}>{a.title}</Link></h3>
        {a.excerpt && <p className="gthread__excerpt">{a.excerpt}</p>}
        <div className="gthread__foot">
          {a.tags.slice(0, 3).map((tag) => <span className="gtag" key={tag.id}>{tag.name}</span>)}
          <span className="gbyline">
            <Avatar user={{ username: a.author.username, avatar: a.author.avatar }} size={22} />
            <b>{a.author.username}</b><span className="gdotsep" /> {timeAgo(a.publishedAt ?? a.createdAt)}
          </span>
        </div>
      </div>
      <div className="gthread__side">
        <div className="gthread__stats">
          <div className="gministat"><b>{a.commentCount}</b><span>replies</span></div>
          <div className="gministat"><b>{a.viewCount}</b><span>views</span></div>
        </div>
      </div>
    </article>
  );
}

/** Generic card for any plugin-provided feed item (normalized HomeFeedItem). */
function ItemCard({ item, onGate }: { item: HomeFeedItem; onGate: (k: string) => void }) {
  const color = item.categoryLabel ? catColor(item.categoryLabel) : "var(--c-accent)";
  const hasStats = item.replies != null || item.views != null;
  return (
    <article className="gthread">
      <button className="gvotes" title="Sign up" onClick={(e) => { e.stopPropagation(); onGate("vote"); }}>
        <span className="gvotes__n">{item.metric ?? 0}</span><span className="gvotes__l">{item.metricLabel ?? "likes"}</span>
      </button>
      <div className="gthread__main">
        {item.categoryLabel && (
          <div className="gthread__meta">
            <span className="gcat" style={{ color, background: hexSoft(color) }}><i style={{ background: color }} />{item.categoryLabel}</span>
          </div>
        )}
        <h3 className="gthread__title"><Link to={item.link}>{item.title}</Link></h3>
        {item.excerpt && <p className="gthread__excerpt">{item.excerpt}</p>}
        <div className="gthread__foot">
          <span className="gbyline">
            {item.author && <Avatar user={item.author} size={22} />}
            <b>{item.author?.username ?? "Unknown"}</b><span className="gdotsep" /> {timeAgo(item.createdAt)}
          </span>
        </div>
      </div>
      {hasStats && (
        <div className="gthread__side">
          <div className="gthread__stats">
            {item.replies != null && <div className="gministat"><b>{item.replies}</b><span>replies</span></div>}
            {item.views != null && <div className="gministat"><b>{item.views}</b><span>views</span></div>}
          </div>
        </div>
      )}
    </article>
  );
}

function FeedMore({ onGate, label }: { onGate: (k: string) => void; label: React.ReactNode }) {
  return (
    <div className="gfeed__more">
      <button className="gloadmore" onClick={() => onGate("more")}>
        <Icon name="sparkles" size={16} /> <span>{label}</span>
      </button>
    </div>
  );
}

// ── single-source articles feed (rich: tabs + category chips) ────────────────────
function ArticleFeed({ onGate, categories, totalArticles, showCategories }: { onGate: (k: string) => void; categories: ArticleCategoryNode[]; totalArticles: number | undefined; showCategories: boolean }) {
  const [tab, setTab] = useState<"latest" | "top">("latest");
  const [cat, setCat] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["guest-feed", tab, cat],
    queryFn: () => articlesApi.list({ page: 1, limit: 10, feed: tab, categoryId: cat ?? undefined }),
  });
  const list = data?.data ?? [];
  const TABS: { id: "latest" | "top"; label: string }[] = [{ id: "latest", label: "Latest" }, { id: "top", label: "Top" }];

  return (
    <div className="gfeed">
      <div className="gfeed__bar">
        <div className="gtabs">
          {TABS.map((tb) => <button key={tb.id} className={`gtab${tab === tb.id ? " is-active" : ""}`} onClick={() => setTab(tb.id)}>{tb.label}</button>)}
        </div>
        <span className="gfeed__count">{list.length} {list.length === 1 ? "topic" : "topics"}</span>
        <button className="btn btn--primary gfeed__new" onClick={() => onGate("post")}><Icon name="plus" size={17} /> New topic</button>
      </div>

      {showCategories && categories.length > 0 && (
        <div className="gchips">
          <button className={`gchip${cat === null ? " is-active" : ""}`} onClick={() => setCat(null)}>All categories</button>
          {categories.slice(0, 8).map((c) => (
            <button key={c.id} className={`gchip${cat === c.id ? " is-active" : ""}`} onClick={() => setCat(cat === c.id ? null : c.id)}>
              <i style={{ background: catColor(c.id) }} />{c.name}
            </button>
          ))}
        </div>
      )}

      <div className="gthreads">
        {isLoading
          ? <div className="gloadmore" style={{ justifyContent: "center" }}>Loading…</div>
          : list.length
            ? list.map((a) => <ArticleCard key={a.id} a={a} onGate={onGate} />)
            : <div className="gloadmore" style={{ justifyContent: "center" }}>No topics here yet.</div>}
      </div>

      {list.length > 0 && <FeedMore onGate={onGate} label={<><b>Create a free account</b> to see all {fmt(totalArticles)} posts</>} />}
    </div>
  );
}

// ── merged feed (multiple sources / any plugin source), newest-first ─────────────
function MergedFeed({ sources, onGate }: { sources: string[]; onGate: (k: string) => void }) {
  const wantArticles = sources.includes("articles");
  const pluginSources = sources.filter((s) => s !== "articles");

  const articlesQ = useQuery({
    queryKey: ["guest-feed", "latest", null],
    queryFn: () => articlesApi.list({ page: 1, limit: 8, feed: "latest" }),
    enabled: wantArticles,
  });
  const pluginQ = useQuery({
    queryKey: ["guest-feed-sources", pluginSources.join(",")],
    queryFn: async () => {
      const lists = await Promise.all(pluginSources.map((id) => api.get<HomeFeedItem[]>(`/home/feed-source/${id}?limit=8`)));
      return lists.flat();
    },
    enabled: pluginSources.length > 0,
  });

  const items = useMemo(() => {
    type U = { ts: string } & ({ kind: "article"; a: ArticleListItem } | { kind: "item"; item: HomeFeedItem });
    const arts: U[] = wantArticles ? (articlesQ.data?.data ?? []).map((a) => ({ kind: "article", a, ts: a.publishedAt ?? a.createdAt })) : [];
    const plug: U[] = (pluginQ.data ?? []).map((item) => ({ kind: "item", item, ts: item.createdAt }));
    return [...arts, ...plug].sort((x, y) => new Date(y.ts).getTime() - new Date(x.ts).getTime()).slice(0, 12);
  }, [articlesQ.data, pluginQ.data, wantArticles]);

  const loading = (wantArticles && articlesQ.isLoading) || (pluginSources.length > 0 && pluginQ.isLoading);

  return (
    <div className="gfeed">
      <div className="gfeed__bar">
        <span className="gfeed__count">{items.length} {items.length === 1 ? "topic" : "topics"}</span>
        <button className="btn btn--primary gfeed__new" onClick={() => onGate("post")}><Icon name="plus" size={17} /> New post</button>
      </div>
      <div className="gthreads">
        {loading
          ? <div className="gloadmore" style={{ justifyContent: "center" }}>Loading…</div>
          : items.length
            ? items.map((u) => u.kind === "article"
                ? <ArticleCard key={`a-${u.a.id}`} a={u.a} onGate={onGate} />
                : <ItemCard key={`i-${u.item.id}`} item={u.item} onGate={onGate} />)
            : <div className="gloadmore" style={{ justifyContent: "center" }}>No topics here yet.</div>}
      </div>
      {items.length > 0 && <FeedMore onGate={onGate} label={<><b>Create a free account</b> to read everything</>} />}
    </div>
  );
}

// ── right rail ──────────────────────────────────────────────────────────────────
function Rail({
  onRegister, onLogin, categories, online, tags, sections,
}: {
  onRegister: () => void; onLogin: () => void;
  categories: ArticleCategoryNode[]; online: OnlineData | undefined; tags: PopularTag[];
  sections: GuestConfig["sections"];
}) {
  const onlineUsers = online?.users ?? [];
  const shown = onlineUsers.slice(0, 9);
  const extra = (online?.total ?? onlineUsers.length) - shown.length;
  return (
    <aside className="grail">
      <div className="gcard gjoin">
        <div className="gcard__pad">
          <h3>Join nodevo</h3>
          <p>It's free. Post, reply, like what you read and get notified when people respond.</p>
          <button className="btn btn--primary btn--block" onClick={onRegister}>Create free account</button>
          <div className="gjoin__alt">Already a member? <a onClick={onLogin}>Log in</a></div>
        </div>
      </div>

      {sections.categories && categories.length > 0 && (
        <div className="gcard">
          <div className="gcard__pad">
            <h4 className="gcard__title">Categories</h4>
            {categories.slice(0, 6).map((c) => {
              const color = catColor(c.id);
              return (
                <Link className="gcatrow" key={c.id} to={`/articles?filter=${c.id}`}>
                  <span className="gcatrow__ic" style={{ color, background: hexSoft(color) }}><Icon name={catIcon(c.id)} size={17} /></span>
                  <span className="gcatrow__tx"><b>{c.name}</b>{c.description && <span>{c.description}</span>}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {sections.online && onlineUsers.length > 0 && (
        <div className="gcard">
          <div className="gcard__pad">
            <h4 className="gcard__title">Online now · {online?.total ?? onlineUsers.length}</h4>
            <div className="gonline__avatars">
              {shown.map((u) => <Avatar key={u.username} user={{ username: u.username, avatar: u.avatar }} size={30} online />)}
              {extra > 0 && <span className="gava-more" style={{ marginLeft: 0 }}>+{extra}</span>}
            </div>
          </div>
        </div>
      )}

      {sections.tags && tags.length > 0 && (
        <div className="gcard">
          <div className="gcard__pad">
            <h4 className="gcard__title">Trending tags</h4>
            <div className="gtagcloud">
              {tags.map((tag) => <Link className="gtag" key={tag.slug} to={`/search?q=${encodeURIComponent(tag.name)}`}>{tag.name}</Link>)}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────
export function GuestHome() {
  const navigate = useNavigate();
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const goRegister = useCallback(() => navigate("/register"), [navigate]);
  const goLogin = useCallback(() => navigate("/login"), [navigate]);
  const gate = useCallback((kind: string) => {
    setToast(GATE_COPY[kind] ?? GATE_COPY.default!);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }, []);

  const { data: config = DEFAULT_CONFIG } = useQuery<GuestConfig>({ queryKey: ["guest-config"], queryFn: () => api.get("/home/guest-config") });
  const { data: stats }      = useQuery<Stats>({ queryKey: ["guest-stats"], queryFn: () => api.get("/home/stats") });
  const { data: online }     = useQuery<OnlineData>({ queryKey: ["online-count"], queryFn: () => api.get("/online"), refetchInterval: 60_000 });
  const { data: categories = [] } = useQuery({ queryKey: ["article-categories"], queryFn: () => articleCategoriesApi.tree() });
  const { data: tags = [] }  = useQuery<PopularTag[]>({ queryKey: ["popular-tags"], queryFn: () => articlesApi.popularTags() });
  const { data: recent }     = useQuery({ queryKey: ["guest-recent"], queryFn: () => articlesApi.list({ page: 1, limit: 3, feed: "latest" }) });

  const { hero, sections, sources } = config;
  const presence = recent?.data ?? [];
  const subtitle = hero.subtitle.replace("{members}", fmt(stats?.members));
  const articlesOnly = sources.length === 1 && sources[0] === "articles";

  return (
    <div className="guest-home">
      <section className="ghero">
        <div className="ghero__lead">
          <span className="ghero__badge"><i />{online?.total ?? 0} {hero.badge}</span>
          <h1 className="ghero__title">{hero.title}</h1>
          <p className="ghero__sub">{subtitle}</p>
          <div className="ghero__cta">
            <button className="btn btn--primary btn--lg" onClick={goRegister}>{hero.ctaPrimary} <Icon name="arrowRight" size={17} /></button>
            <button className="btn btn--outline btn--lg" onClick={() => bodyRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })}>{hero.ctaSecondary}</button>
          </div>
          {sections.stats && (
            <div className="ghero__stats">
              <div className="gstat"><div className="gstat__n">{fmt(stats?.members)}</div><div className="gstat__l">Members</div></div>
              <div className="gstat"><div className="gstat__n">{fmt(stats?.articles)}</div><div className="gstat__l">Posts</div></div>
              <div className="gstat"><div className="gstat__n">{fmt(stats?.today)}</div><div className="gstat__l">New today</div></div>
            </div>
          )}
        </div>
        {sections.presence && presence.length > 0 && (
          <div className="ghero__side">
            <div className="gpresence">
              <div className="gpresence__head"><b>Happening right now</b><span className="gpresence__live"><i />Live</span></div>
              {presence.map((a) => (
                <div className="gpresence__row" key={a.id}>
                  <Avatar user={{ username: a.author.username, avatar: a.author.avatar }} size={38} />
                  <div className="gpresence__txt"><b>{a.author.username}</b><span>posted in {a.category?.name ?? "the community"}</span></div>
                  <span className="gpresence__dot" />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="gbody" ref={bodyRef}>
        {articlesOnly
          ? <ArticleFeed onGate={gate} categories={categories} totalArticles={stats?.articles} showCategories={sections.categories} />
          : <MergedFeed sources={sources} onGate={gate} />}
        <Rail onRegister={goRegister} onLogin={goLogin} categories={categories} online={online} tags={tags} sections={sections} />
      </div>

      <div className={`gtoast${toast ? " is-show" : ""}`}>
        <Icon name="sparkles" size={18} />
        <b>{toast || ""}</b>
        <button onClick={() => { setToast(""); goRegister(); }}>Sign up free</button>
      </div>
    </div>
  );
}

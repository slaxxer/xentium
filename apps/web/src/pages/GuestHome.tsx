import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import i18n from "../lib/i18n";
import { api } from "../lib/api";
import { timeAgo } from "../lib/time";
import { articlesApi, type ArticleListItem, type ArticleCategoryNode } from "../lib/articlesApi";
import { Avatar } from "../components/Avatar";
import "./GuestHome.scss";
import { Username } from "../components/Username";
import { useSiteConfig } from "../hooks/useSiteConfig";

/* ============================================================================
   Guest-landing PIECES.

   This was one 400-line page component; it is now the parts the guest blocks in
   `layout/blocks/guestBlocks.tsx` compose — the feeds, the rail, the cards and the
   icon set. The page-level assembly, and the hero copy that used to come from the
   `Appearance → Guest Home` settings, live in the layout document instead.
   ============================================================================
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
export function Icon({ name, size = 18, stroke = 2 }: { name: string; size?: number; stroke?: number }) {
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
const fmt = (n: number | undefined) => (n == null ? "—" : n.toLocaleString(i18n.language));

export interface Stats { members: number; articles: number; today: number }
export interface OnlineData { total: number; users: { username: string; avatar: string | null }[] }
export interface PopularTag { name: string; slug: string; count: number }
export interface HomeFeedItem {
  id: string; title: string; link: string; excerpt?: string | null; categoryLabel?: string | null;
  author?: { username: string; avatar: string | null; badgeColor?: string | null } | null;
  metric?: number; metricLabel?: string; replies?: number; views?: number; createdAt: string;
}
export interface GuestConfig {
  hero: { badge: string; title: string; subtitle: string; ctaPrimary: string; ctaSecondary: string };
  sections: { stats: boolean; presence: boolean; categories: boolean; online: boolean; tags: boolean };
  sources: string[];
  availableSources: { id: string; label: string }[];
}

export const DEFAULT_CONFIG: GuestConfig = {
  hero: {
    badge: "builders online now",
    title: "Where people who build with xentium hang out.",
    subtitle: "Ask questions, show what you made, shape the roadmap, and learn from {members} makers. Reading is open to everyone.",
    ctaPrimary: "Join the conversation",
    ctaSecondary: "Browse as guest",
  },
  sections: { stats: true, presence: true, categories: true, online: true, tags: true },
  sources: ["articles"],
  availableSources: [{ id: "articles", label: "Articles" }],
};

/** The sign-up prompt a locked action raises, in the visitor's language. */
const GATE_KINDS = ["vote", "post", "more"];
export function gateCopy(kind: string): string {
  return i18n.t(`common:guestHome.gate.${GATE_KINDS.includes(kind) ? kind : "default"}`);
}

// ── cards ───────────────────────────────────────────────────────────────────────
function ArticleCard({ a, onGate }: { a: ArticleListItem; onGate: (k: string) => void }) {
  const { t } = useTranslation("common", { keyPrefix: "guestHome.card" });
  const color = a.category ? catColor(a.category.id) : "var(--c-accent)";
  return (
    <article className={`gthread${a.featuredImage ? " gthread--media" : ""}`}>
      <button className="gvotes" title={t("signUpToLike")} onClick={(e) => { e.stopPropagation(); onGate("vote"); }}>
        <span className="gvotes__n">{a.likeCount}</span><span className="gvotes__l">{t("likes", { count: a.likeCount })}</span>
      </button>
      {/* The article's own picture, as on the members' feed. Decorative: the title
          beside it is the link's text, so the image is a second way in, hidden from
          screen readers. */}
      {a.featuredImage && (
        <Link to={`/articles/${a.slug}`} className="gthread__media" tabIndex={-1} aria-hidden="true">
          <img src={`/uploads/${a.featuredImage}`} alt="" loading="lazy" />
        </Link>
      )}
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
            <b><Username username={a.author.username} badgeColor={a.author.badgeColor} /></b><span className="gdotsep" /> {timeAgo(a.publishedAt ?? a.createdAt)}
          </span>
        </div>
      </div>
      <div className="gthread__side">
        <div className="gthread__stats">
          <div className="gministat"><b>{a.commentCount}</b><span>{t("replies", { count: a.commentCount })}</span></div>
          <div className="gministat"><b>{a.viewCount}</b><span>{t("views", { count: a.viewCount })}</span></div>
        </div>
      </div>
    </article>
  );
}

/** Generic card for any plugin-provided feed item (normalized HomeFeedItem). */
function ItemCard({ item, onGate }: { item: HomeFeedItem; onGate: (k: string) => void }) {
  const { t } = useTranslation("common", { keyPrefix: "guestHome.card" });
  const color = item.categoryLabel ? catColor(item.categoryLabel) : "var(--c-accent)";
  const hasStats = item.replies != null || item.views != null;
  return (
    <article className="gthread">
      <button className="gvotes" title={t("signUp")} onClick={(e) => { e.stopPropagation(); onGate("vote"); }}>
        <span className="gvotes__n">{item.metric ?? 0}</span><span className="gvotes__l">{item.metricLabel ?? t("likes", { count: item.metric ?? 0 })}</span>
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
            <b>{item.author
              ? <Username username={item.author.username} badgeColor={item.author.badgeColor} />
              : t("unknown")}</b><span className="gdotsep" /> {timeAgo(item.createdAt)}
          </span>
        </div>
      </div>
      {hasStats && (
        <div className="gthread__side">
          <div className="gthread__stats">
            {item.replies != null && <div className="gministat"><b>{item.replies}</b><span>{t("replies", { count: item.replies })}</span></div>}
            {item.views != null && <div className="gministat"><b>{item.views}</b><span>{t("views", { count: item.views })}</span></div>}
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
export function ArticleFeed({ onGate, categories, totalArticles, showCategories }: { onGate: (k: string) => void; categories: ArticleCategoryNode[]; totalArticles: number | undefined; showCategories: boolean }) {
  const { t } = useTranslation("common", { keyPrefix: "guestHome.feed" });
  const [tab, setTab] = useState<"latest" | "top">("latest");
  const [cat, setCat] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["guest-feed", tab, cat],
    queryFn: () => articlesApi.list({ page: 1, limit: 10, feed: tab, categoryId: cat ?? undefined }),
  });
  const list = data?.data ?? [];
  const TABS: { id: "latest" | "top"; label: string }[] = [{ id: "latest", label: t("latest") }, { id: "top", label: t("top") }];

  return (
    <div className="gfeed">
      <div className="gfeed__bar">
        <div className="gtabs">
          {TABS.map((tb) => <button key={tb.id} className={`gtab${tab === tb.id ? " is-active" : ""}`} onClick={() => setTab(tb.id)}>{tb.label}</button>)}
        </div>
        <span className="gfeed__count">{t("topics", { count: list.length })}</span>
        <button className="btn btn--primary gfeed__new" onClick={() => onGate("post")}><Icon name="plus" size={17} /> {t("newTopic")}</button>
      </div>

      {showCategories && categories.length > 0 && (
        <div className="gchips">
          <button className={`gchip${cat === null ? " is-active" : ""}`} onClick={() => setCat(null)}>{t("allCategories")}</button>
          {categories.slice(0, 8).map((c) => (
            <button key={c.id} className={`gchip${cat === c.id ? " is-active" : ""}`} onClick={() => setCat(cat === c.id ? null : c.id)}>
              <i style={{ background: catColor(c.id) }} />{c.name}
            </button>
          ))}
        </div>
      )}

      <div className="gthreads">
        {isLoading
          ? <div className="gloadmore" style={{ justifyContent: "center" }}>{t("loading")}</div>
          : list.length
            ? list.map((a) => <ArticleCard key={a.id} a={a} onGate={onGate} />)
            : <div className="gloadmore" style={{ justifyContent: "center" }}>{t("empty")}</div>}
      </div>

      {list.length > 0 && <FeedMore onGate={onGate} label={<Trans t={t} i18nKey="moreAll" values={{ count: totalArticles ?? 0, formatted: fmt(totalArticles) }} components={{ b: <b /> }} />} />}
    </div>
  );
}

// ── merged feed (multiple sources / any plugin source), newest-first ─────────────
export function MergedFeed({ sources, onGate }: { sources: string[]; onGate: (k: string) => void }) {
  const { t } = useTranslation("common", { keyPrefix: "guestHome.feed" });
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
        <span className="gfeed__count">{t("topics", { count: items.length })}</span>
        <button className="btn btn--primary gfeed__new" onClick={() => onGate("post")}><Icon name="plus" size={17} /> {t("newPost")}</button>
      </div>
      <div className="gthreads">
        {loading
          ? <div className="gloadmore" style={{ justifyContent: "center" }}>{t("loading")}</div>
          : items.length
            ? items.map((u) => u.kind === "article"
                ? <ArticleCard key={`a-${u.a.id}`} a={u.a} onGate={onGate} />
                : <ItemCard key={`i-${u.item.id}`} item={u.item} onGate={onGate} />)
            : <div className="gloadmore" style={{ justifyContent: "center" }}>{t("empty")}</div>}
      </div>
      {items.length > 0 && <FeedMore onGate={onGate} label={<Trans t={t} i18nKey="moreRead" components={{ b: <b /> }} />} />}
    </div>
  );
}

// ── right rail ──────────────────────────────────────────────────────────────────
export function Rail({
  onRegister, onLogin, categories, online, tags, sections,
}: {
  onRegister: () => void; onLogin: () => void;
  categories: ArticleCategoryNode[]; online: OnlineData | undefined; tags: PopularTag[];
  sections: GuestConfig["sections"];
}) {
  const { t } = useTranslation("common", { keyPrefix: "guestHome.rail" });
  const siteName = useSiteConfig().data?.siteName || "Xentium";
  const onlineUsers = online?.users ?? [];
  const shown = onlineUsers.slice(0, 9);
  const extra = (online?.total ?? onlineUsers.length) - shown.length;
  return (
    <aside className="grail">
      <div className="gcard gjoin">
        <div className="gcard__pad">
          <h3>{t("joinTitle", { site: siteName })}</h3>
          <p>{t("joinText")}</p>
          <button className="btn btn--primary btn--block" onClick={onRegister}>{t("createAccount")}</button>
          <div className="gjoin__alt">{t("alreadyMember")} <a onClick={onLogin}>{t("logIn")}</a></div>
        </div>
      </div>

      {sections.categories && categories.length > 0 && (
        <div className="gcard">
          <div className="gcard__pad">
            <h4 className="gcard__title">{t("categories")}</h4>
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
            <h4 className="gcard__title">{t("onlineNow", { count: online?.total ?? onlineUsers.length })}</h4>
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
            <h4 className="gcard__title">{t("trendingTags")}</h4>
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

import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { slotRegistry } from "../plugins/slotRegistry";
import { UserAvatar } from "../components/UserAvatar";
import { Username } from "../components/Username";
import { roleColor } from "../lib/groupBadge";
import "./SearchPage.scss";

type SearchType = "all" | "articles" | "users" | string;

interface ArticleResult {
  id: string; slug: string; title: string; excerpt: string | null;
  featuredImage: string | null; publishedAt: string | null;
  likeCount: number; commentCount: number;
  categoryName: string | null; categorySlug: string | null;
  author: { id: string; username: string; avatar: string | null; badgeColor: string | null; roleKey: string | null };
}

interface UserResult {
  id: string; username: string; displayName: string | null;
  bio: string | null; avatar: string | null;
  badgeColor: string | null; badgeLabel: string | null; roleKey: string | null;
}

interface SearchResponse {
  query: string;
  articles: { data: ArticleResult[]; total: number };
  users:    { data: UserResult[];    total: number };
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function timeAgo(d: string, t: TFn) {
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1)  return t("search.today");
  if (days < 7)  return t("search.daysAgo", { d: days });
  if (days < 30) return t("search.weeksAgo", { w: Math.floor(days / 7) });
  return new Date(d).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function SearchPage() {
  const { t } = useTranslation("pages");
  const [params, setParams] = useSearchParams();
  const q    = params.get("q") ?? "";
  const type = (params.get("type") ?? "all") as SearchType;

  const { data, isLoading, isFetching } = useQuery<SearchResponse>({
    queryKey:  ["search", q, type],
    queryFn:   () => api.get(`/search?q=${encodeURIComponent(q)}&type=${type}&limit=20`),
    enabled:   q.trim().length >= 2,
    staleTime: 30_000,
  });

  const totalArticles = data?.articles.total ?? 0;
  const totalUsers    = data?.users.total    ?? 0;
  const pluginSearchTabs = slotRegistry.getSearchTabs();
  const pluginTotals = pluginSearchTabs.reduce((acc, pt) => {
    acc[pt.id] = (data as any)?.[pt.id]?.total ?? 0;
    return acc;
  }, {} as Record<string, number>);
  const totalPlugin   = Object.values(pluginTotals).reduce((a, b) => a + b, 0);
  const totalAll      = totalArticles + totalUsers + totalPlugin;

  const TABS: { id: SearchType; label: string; count: number }[] = [
    { id: "all",      label: t("search.all"),      count: totalAll      },
    { id: "articles", label: t("search.articles"), count: totalArticles },
    ...pluginSearchTabs.map((pt) => ({ id: pt.id, label: pt.label, count: pluginTotals[pt.id] ?? 0 })),
    { id: "users",    label: t("search.people"),   count: totalUsers    },
  ];

  function setType(t: SearchType) {
    setParams(p => { p.set("type", t); return p; });
  }

  const articles    = data?.articles.data ?? [];
  const users       = data?.users.data    ?? [];

  const hasQuery = q.trim().length >= 2;
  const busy     = isLoading || isFetching;

  return (
    <div className="search-page">
      <div className="search-page__header">
        <h1 className="search-page__title">
          {hasQuery ? <>{t("search.resultsFor")} <em>"{q}"</em></> : t("search.title")}
        </h1>
        {hasQuery && !busy && data && (
          <p className="search-page__meta">{t("search.resultsCount", { n: totalAll.toLocaleString() })}</p>
        )}
      </div>

      {/* Tabs */}
      {hasQuery && (
        <div className="search-page__tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`search-page__tab${type === tab.id ? " search-page__tab--active" : ""}`}
              onClick={() => setType(tab.id)}
            >
              {tab.label}
              {!busy && data && (
                <span className="search-page__tab-count">{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      {!hasQuery ? (
        <div className="search-page__empty">
          <p>{t("search.minChars")}</p>
        </div>
      ) : busy ? (
        <div className="search-page__loading">{t("search.searching")}</div>
      ) : totalAll === 0 ? (
        <div className="search-page__empty">
          <p>{t("search.noResults")} <strong>"{q}"</strong>.</p>
          <p className="search-page__empty-hint">{t("search.noResultsHint")}</p>
        </div>
      ) : (
        <div className="search-page__results">

          {/* Articles */}
          {(type === "all" || type === "articles") && articles.length > 0 && (
            <section className="search-page__section">
              {type === "all" && (
                <h2 className="search-page__section-title">
                  {t("search.articles")}
                  {totalArticles > articles.length && (
                    <button type="button" className="search-page__see-all" onClick={() => setType("articles")}>
                      {t("search.seeAll", { n: totalArticles })}
                    </button>
                  )}
                </h2>
              )}
              <div className="search-results-list">
                {articles.map(a => (
                  <Link key={a.id} to={`/articles/${a.slug}`} className="sr-article">
                    {a.featuredImage && (
                      <img src={a.featuredImage} alt="" className="sr-article__img" />
                    )}
                    <div className="sr-article__body">
                      {a.categoryName && (
                        <span className="sr-article__cat">{a.categoryName}</span>
                      )}
                      <h3 className="sr-article__title">{a.title}</h3>
                      {a.excerpt && (
                        <p className="sr-article__excerpt">{a.excerpt}</p>
                      )}
                      <div className="sr-article__meta">
                        <UserAvatar
                          user={{ username: a.author.username, avatar: a.author.avatar }}
                          size={18}
                        />
                        <Username username={a.author.username} badgeColor={a.author.badgeColor} roleKey={a.author.roleKey} />
                        {a.publishedAt && (
                          <><span className="sr-dot">·</span><span>{timeAgo(a.publishedAt, t)}</span></>
                        )}
                        <span className="sr-dot">·</span>
                        <span>♥ {a.likeCount}</span>
                        <span className="sr-dot">·</span>
                        <span>💬 {a.commentCount}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Plugin search sections (e.g. Forum) — rendered dynamically from slotRegistry */}
          {pluginSearchTabs.map((pt) => {
            const items: any[] = (data as any)?.[pt.id]?.data ?? [];
            const ptTotal: number = pluginTotals[pt.id] ?? 0;
            if ((type !== "all" && type !== pt.id) || items.length === 0) return null;
            return (
              <section key={pt.id} className="search-page__section">
                {type === "all" && (
                  <h2 className="search-page__section-title">
                    {pt.label}
                    {ptTotal > items.length && (
                      <button type="button" className="search-page__see-all" onClick={() => setType(pt.id)}>
                        {t("search.seeAll", { n: ptTotal })}
                      </button>
                    )}
                  </h2>
                )}
                <div className="search-results-list">
                  {items.map((item: any) => (
                    <Link key={item.id} to={pt.linkFn ? pt.linkFn(item as Record<string,unknown>) : "#"} className="sr-article">
                      <div className="sr-article__body">
                        {item.tags?.length > 0 && (
                          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                            {item.tags.map((tag: string) => (
                              <span key={tag} style={{ fontSize: 11, color: "var(--c-accent)", background: "var(--c-accent-soft)", padding: "2px 7px", borderRadius: 100, fontWeight: 600 }}>#{tag}</span>
                            ))}
                          </div>
                        )}
                        <h3 className="sr-article__title">{item.title}</h3>
                        <div className="sr-article__meta">
                          {item.authorUsername && <><span>{t("search.by")} <strong>{item.authorUsername}</strong></span><span className="sr-dot">·</span></>}
                          {item.createdAt && <span>{timeAgo(item.createdAt, t)}</span>}
                          {item.replyCount != null && <><span className="sr-dot">·</span><span>💬 {item.replyCount}</span></>}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}

          {/* Users */}
          {(type === "all" || type === "users") && users.length > 0 && (
            <section className="search-page__section">
              {type === "all" && (
                <h2 className="search-page__section-title">
                  {t("search.people")}
                  {totalUsers > users.length && (
                    <button type="button" className="search-page__see-all" onClick={() => setType("users")}>
                      {t("search.seeAll", { n: totalUsers })}
                    </button>
                  )}
                </h2>
              )}
              <div className="search-results-list search-results-list--users">
                {users.map(u => (
                  <Link key={u.id} to={`/u/${u.username}`} className="sr-user">
                    <UserAvatar
                      user={{ username: u.username, avatar: u.avatar }}
                      size={44}
                    />
                    <div className="sr-user__info">
                      <div className="sr-user__name">
                        <Username username={u.username} badgeColor={u.badgeColor} roleKey={u.roleKey} />
                        {u.badgeLabel && (() => {
                          const c = roleColor(u.badgeColor, u.roleKey) ?? "var(--c-accent)";
                          return (
                            <span
                              className="sr-user__badge"
                              style={{
                                background: `color-mix(in srgb, ${c} 14%, transparent)`,
                                color:       c,
                                border:      `1px solid color-mix(in srgb, ${c} 32%, transparent)`,
                              }}
                            >
                              {u.badgeLabel}
                            </span>
                          );
                        })()}
                      </div>
                      {(u.displayName || u.bio) && (
                        <p className="sr-user__bio">
                          {u.displayName ? `${u.displayName} — ` : ""}
                          {u.bio ? u.bio.slice(0, 120) + (u.bio.length > 120 ? "…" : "") : ""}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

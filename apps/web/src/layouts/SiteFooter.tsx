import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../components/Icon";
import { faUsers } from "@fortawesome/free-solid-svg-icons";
import { api } from "../lib/api";
import { ThemeChooser } from "../layout/blocks/ThemeChooserBlock";
import { Username } from "../components/Username";
import { useAuth } from "../hooks/useAuth";
import { LayoutRegion } from "../layout/LayoutRenderer";
import { useLayoutDocument } from "../layout/useLayout";
import "./SiteFooter.scss";

interface LegendGroup { name: string; key: string; badgeColor: string | null }
interface OnlineUser { username: string; groupKey: string; badgeColor: string | null }
interface OnlineData { total: number; users?: OnlineUser[] }
interface Stats { members: number; articles: number; today: number; newestMember: string | null }
interface FooterNavItem { id: string; label: string; url: string; openInNewTab: boolean; visibility: string; placement?: string }
interface FooterStat { id: string; label: string; value: number }
interface FooterMeta { siteName: string; uptimeSeconds: number; stats: FooterStat[]; latencyMs: number; fetchedAt: number }

const MAX_NAMES = 18;

/** "2d 4h 05m 09s" — days only when present. */
function formatUptime(total: number): string {
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d > 0 ? `${d}d ` : ""}${h}h ${pad(m)}m ${pad(s)}s`;
}

/**
 * Footer, decomposed into blocks (ADR-0005 Amendment 1).
 *
 * Each section owns its own query, so an admin can move "who's online" below the
 * group legend — or drop either entirely — without the others losing their data.
 * Markup is moved verbatim, so the shipped default renders exactly as before.
 */

/** Who is here right now. `maxNames: 0` shows the count only. */
export function FooterWhosOnline({ maxNames = MAX_NAMES }: { maxNames?: number }) {
  const { t } = useTranslation("common");
  const { data: online } = useQuery<OnlineData>({
    queryKey: ["online-count"],
    queryFn: () => api.get("/online"),
    refetchInterval: 60_000,
    placeholderData: { total: 0, users: [] },
  });

  const users = online?.users ?? [];
  const shown = users.slice(0, maxNames);
  const extra = users.length - shown.length;
  const nameColor = (c: string | null) => c ?? "var(--c-fg-muted)";

  return (
    <div className="nv-foot__online">
      <p className="nv-eyebrow">
        <span className="nv-online-dot" aria-hidden="true" /> {t("footer.whosOnline")}
      </p>
      <p className="nv-sentence">
        {t("footer.onlineSentence", { count: online?.total ?? 0 })}
      </p>
      {shown.length > 0 && (
        <div className="nv-names">
          {shown.map((u, i) => (
            <Fragment key={u.username}>
              <Link className="nv-on" to={`/u/${u.username}`} style={{ color: nameColor(u.badgeColor) }}>
                <Username username={u.username} badgeColor={u.badgeColor} />
              </Link>
              {i < shown.length - 1 && <span className="nv-sep">·</span>}
            </Fragment>
          ))}
          {extra > 0 && <span className="nv-on nv-on--more"> · {t("footer.andMore", { count: extra })}</span>}
        </div>
      )}
    </div>
  );
}

/** Every user group, online or not. */
export function FooterGroupLegend() {
  const { t } = useTranslation("common");
  const { data: legendGroups = [] } = useQuery<LegendGroup[]>({
    queryKey: ["legend-groups"],
    queryFn: () => api.get("/members/groups"),
    staleTime: 300_000,
  });
  if (legendGroups.length === 0) return null;
  return (
    <div className="nv-legend">
      <span className="nv-legend__lbl">{t("footer.legend")}</span>
      {legendGroups.map((g) => {
        const color = g.badgeColor ?? "var(--c-fg-muted)";
        return (
          <span
            key={g.key}
            className="nv-grp"
            style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
          >
            {g.name}
          </span>
        );
      })}
    </div>
  );
}

/** Article/member counters plus any plugin-contributed stat sources. */
export function FooterBoardStats() {
  const { t } = useTranslation("common");
  const { data: stats } = useQuery<Stats>({
    queryKey: ["home-stats"],
    queryFn: () => api.get("/home/stats"),
    staleTime: 300_000,
  });
  const { data: meta } = useFooterMeta();
  return (
    <div className="nv-stats">
      <div className="nv-stat nv-stat--accent"><b>{(stats?.articles ?? 0).toLocaleString()}</b><span>{t("footer.totalArticles")}</span></div>
      <div className="nv-stat"><b>{(stats?.members ?? 0).toLocaleString()}</b><span>{t("footer.members")}</span></div>
      {(meta?.stats ?? []).map((s) => (
        <div key={s.id} className="nv-stat">
          <b>{s.value.toLocaleString()}</b>
          <span>{t(`footer.stat.${s.id}`, { defaultValue: s.label })}</span>
        </div>
      ))}
      {stats?.newestMember && (
        <div className="nv-stat">
          <b><Link to={`/u/${stats.newestMember}`}>@{stats.newestMember}</Link></b>
          <span>{t("footer.newestMember")}</span>
        </div>
      )}
    </div>
  );
}

/** Wordmark, footer nav links, copyright and (optionally) uptime + latency. */
export function FooterBranding({ showUptime = true, showThemeChooser = true }: {
  showUptime?: boolean;
  /** The reader's theme picker, at the right of the brand row. */
  showThemeChooser?: boolean;
}) {
  const { t } = useTranslation("common");
  const { isAuthenticated } = useAuth();
  const { data: meta } = useFooterMeta();

  // Tick once a second so uptime counts up live between refetches.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!showUptime) return;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [showUptime]);
  const liveUptime = meta ? meta.uptimeSeconds + Math.floor((Date.now() - meta.fetchedAt) / 1000) : 0;

  const { data: navItems = [] } = useQuery<FooterNavItem[]>({
    queryKey: ["pub-nav-items"],
    queryFn: () => api.get("/nav-items"),
    staleTime: 60_000,
  });
  const footerLinks = navItems.filter((i) =>
    i.placement === "footer" &&
    (i.visibility === "public" || (i.visibility === "members" && isAuthenticated)),
  );

  return (
    <>
      <div className="nv-bar">
        <Link className="nv-brand" to="/" aria-label="Nodevo home">
          <span className="nv-logomark"><FontAwesomeIcon icon={faUsers} /></span>
          <span className="nv-wordmark">Nodevo</span>
        </Link>
        {footerLinks.length > 0 && (
          <nav className="nv-links nv-links--grow">
            {footerLinks.map((item) =>
              item.url.startsWith("/") ? (
                <Link key={item.id} to={item.url}>{item.label}</Link>
              ) : (
                <a key={item.id} href={item.url} {...(item.openInNewTab ? { target: "_blank", rel: "noreferrer" } : {})}>
                  {item.label}
                </a>
              ),
            )}
          </nav>
        )}
        {/* The theme picker, at the RIGHT of the brand row. Part of `branding` rather
            than a block of its own: it belongs beside the site's mark and its links,
            and a second placeable control that does the same thing is two ways to
            reach one setting. `nv-themepick` is pushed over by `margin-left: auto`,
            which works whether or not there are footer links. */}
        {showThemeChooser && (
          <span className="nv-themepick"><ThemeChooser /></span>
        )}
      </div>

      <div className="nv-copyright">
        <span className="nv-copyright__legal">© {new Date().getFullYear()} {meta?.siteName ?? ""}</span>
        {showUptime && (
          <span className="nv-copyright__meta">
            <span title={t("footer.uptimeHint")}>{t("footer.uptime")}: <b>{meta ? formatUptime(liveUptime) : "—"}</b></span>
            <span className="nv-sep">·</span>
            <span title={t("footer.latencyHint")}>{t("footer.latency")}: <b>{meta ? `${meta.latencyMs} ms` : "—"}</b></span>
          </span>
        )}
      </div>
    </>
  );
}

/** Shared between boardStats and branding — one request, not two. */
function useFooterMeta() {
  return useQuery<FooterMeta>({
    queryKey: ["site-footer"],
    queryFn: async () => {
      const t0 = performance.now();
      const data = await api.get<Omit<FooterMeta, "latencyMs" | "fetchedAt">>("/site/footer");
      return { ...data, latencyMs: Math.round(performance.now() - t0), fetchedAt: Date.now() };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * The site footer. Arrangement comes from the `chrome.footer` layout document,
 * so an admin can reorder or drop any section. The shipped default reproduces
 * the previous hardcoded order exactly.
 */
export function SiteFooter() {
  const layout = useLayoutDocument("chrome.footer");
  // ONE region, named `footer`. `top`/`main`/`bottom` were three slots for ordering,
  // which is what a single ordered list already is. `LayoutRegion` emits the
  // `<footer>` landmark.
  //
  // There is no `.nv-foot` wrapper here any more: the band is the `footer` BLOCK, the
  // way the masthead is the `header` block. A wrapper here would paint the band
  // whether or not the document asked for one — so "delete the footer chrome" would
  // leave its background behind, and the block's own background would draw inside a
  // second one.
  return <LayoutRegion document={layout} region="footer" />;
}

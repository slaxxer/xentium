import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useLegalLinks } from "../lib/legalApi";
import { legalPath } from "@xentium/contracts";
import { ThemeChooser } from "../layout/blocks/ThemeChooserBlock";
import { Username } from "../components/Username";
import { useAuth } from "../hooks/useAuth";
import { LayoutRegion } from "../layout/LayoutRenderer";
import { useLayoutDocument } from "../layout/useLayout";
import "./SiteFooter.scss";
import { useBadgeShadows } from "../lib/badgeShadow";
import { uiLocale } from "../lib/i18n";
import { pluginNavLabel } from "../lib/coreText";
import { useDateTime } from "../lib/datetime";

interface LegendGroup { name: string; key: string; badgeColor: string | null }
interface OnlineUser { username: string; groupKey: string; badgeColor: string | null }
interface OnlineData { total: number; users?: OnlineUser[]; guests?: number; record?: { count: number; at: string } | null }
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

/** Who is here right now: the names, then the counts and the record. `maxNames: 0` hides the names. */
export function FooterWhosOnline({ maxNames = MAX_NAMES }: { maxNames?: number }) {
  const { t } = useTranslation("common");
  const dt = useDateTime();
  // ⚠ Only once sign-in has resolved: this poll is also how a GUEST is counted, and a
  // member whose token had not arrived yet would be counted as one.
  const { isLoading: authLoading } = useAuth();
  const { data: online } = useQuery<OnlineData>({
    queryKey: ["online-count"],
    queryFn: () => api.get("/online"),
    refetchInterval: 60_000,
    placeholderData: { total: 0, users: [] },
    enabled: !authLoading,
  });
  const record = online?.record ?? null;

  const users = online?.users ?? [];
  const shown = users.slice(0, maxNames);
  const extra = users.length - shown.length;
  const nameColor = (c: string | null) => c ?? "var(--c-fg-muted)";

  return (
    <div className="xt-foot__online">
      <p className="xt-eyebrow">
        <span className="xt-online-dot" aria-hidden="true" /> {t("footer.whosOnline")}
      </p>
      {shown.length > 0 && (
        <div className="xt-names">
          {shown.map((u, i) => (
            <Fragment key={u.username}>
              <Link className="xt-on" to={`/u/${u.username}`} style={{ color: nameColor(u.badgeColor) }}>
                <Username username={u.username} badgeColor={u.badgeColor} />
              </Link>
              {i < shown.length - 1 && <span className="xt-comma">,</span>}
            </Fragment>
          ))}
          {extra > 0 && <span className="xt-on xt-on--more"> {t("footer.andMore", { count: extra })}</span>}
        </div>
      )}
      {/* Members and guests here now, and the most there have ever been at once. */}
      {/* The "·" between items is drawn by CSS on the item AFTER it, so a wrapped line
          never ends on a lone dot. */}
      <p className="xt-onstats">
        <span className="xt-onstat">{t("footer.statMembers", { count: online?.total ?? 0 })}</span>
        <span className="xt-onstat">{t("footer.statGuests", { count: online?.guests ?? 0 })}</span>
        {record && (
          <span className="xt-onstat xt-onstat--record" title={dt.dateTime(record.at)}>
            {t("footer.statRecord", { count: record.count, date: dt.date(record.at), time: dt.time(record.at) })}
          </span>
        )}
      </p>
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
  const shadows = useBadgeShadows();
  if (legendGroups.length === 0) return null;
  return (
    <div className="xt-legend">
      <span className="xt-legend__lbl">{t("footer.legend")}</span>
      {legendGroups.map((g) => {
        const color = g.badgeColor ?? "var(--c-fg-muted)";
        // The legend names the groups — always the name in the group's colour, never
        // a rank image — with the username glow the group has, if any.
        const glow = g.badgeColor ? shadows.get(g.badgeColor.toLowerCase()) : undefined;
        return (
          <span
            key={g.key}
            className="xt-grp"
            style={{ color, ...(glow ? { textShadow: glow } : {}) }}
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
    <div className="xt-stats">
      <div className="xt-stat xt-stat--accent"><b>{(stats?.articles ?? 0).toLocaleString(uiLocale())}</b><span>{t("footer.totalArticles")}</span></div>
      <div className="xt-stat"><b>{(stats?.members ?? 0).toLocaleString(uiLocale())}</b><span>{t("footer.members")}</span></div>
      {(meta?.stats ?? []).map((s) => (
        <div key={s.id} className="xt-stat">
          <b>{s.value.toLocaleString(uiLocale())}</b>
          <span>{t(`footer.stat.${s.id}`, { defaultValue: s.label })}</span>
        </div>
      ))}
      {stats?.newestMember && (
        <div className="xt-stat">
          <b><Link to={`/u/${stats.newestMember}`}>@{stats.newestMember}</Link></b>
          <span>{t("footer.newestMember")}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The footer's links: the published legal documents first, in their fixed order,
 * then ACP → Navigation's footer links as this viewer may see them.
 *
 * The legal links are core's, not navigation items: an admin cannot delete or
 * reorder the imprint out of the footer, only publish or unpublish it.
 */
function useFooterNavLinks(): FooterNavItem[] {
  const { t } = useTranslation("common");
  const legal = useLegalLinks().map((d): FooterNavItem => ({
    id: `legal:${d.key}`, label: t(`legal.link.${d.key}`), url: legalPath(d.key),
    openInNewTab: false, visibility: "public",
  }));
  return [...legal, ...useFooterNavItems()];
}

/** ACP → Navigation, placement Footer, as this viewer may see them. */
function useFooterNavItems(): FooterNavItem[] {
  const { isAuthenticated } = useAuth();
  const { data: navItems = [] } = useQuery<FooterNavItem[]>({
    queryKey: ["pub-nav-items"],
    queryFn: () => api.get("/nav-items"),
    staleTime: 60_000,
  });
  return navItems.filter((i) =>
    i.placement === "footer" &&
    (i.visibility === "public" || (i.visibility === "members" && isAuthenticated)),
  );
}

function FooterLinkList({ links }: { links: FooterNavItem[] }) {
  const { t } = useTranslation("common");
  return (
    <nav className="xt-footlinks__list" aria-label={t("footer.linksLabel")}>
      {links.map((item) =>
        item.url.startsWith("/") ? (
          <Link key={item.id} className="xt-footlinks__link" to={item.url}>{pluginNavLabel(item.url, item.label)}</Link>
        ) : (
          <a key={item.id} className="xt-footlinks__link" href={item.url}
            {...(item.openInNewTab ? { target: "_blank", rel: "noreferrer" } : {})}>
            {item.label}
          </a>
        ),
      )}
    </nav>
  );
}

/** ⚠ Superseded by `FooterBar`; renders documents stored before it. */
export function FooterLinks({ showThemeChooser = true }: { showThemeChooser?: boolean }) {
  const links = useFooterNavLinks();
  // Nothing to show: no box either, so an empty row does not hold space in the band.
  if (links.length === 0 && !showThemeChooser) return null;
  return (
    <div className="xt-footlinks">
      <FooterLinkList links={links} />
      {/* Draws nothing with fewer than two installed themes. */}
      {showThemeChooser && <span className="xt-footlinks__theme"><ThemeChooser /></span>}
    </div>
  );
}

/** The fixed footer line — `© {year} Powered by Xentium Community` — not editable, always centred. */
export function FooterText({ showUptime = false }: { showUptime?: boolean }) {
  const { t } = useTranslation("common");
  const { data: meta } = useFooterMeta();

  // Tick once a second so uptime counts up live between refetches.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!showUptime) return;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [showUptime]);
  const liveUptime = meta ? meta.uptimeSeconds + Math.floor((Date.now() - meta.fetchedAt) / 1000) : 0;

  return (
    <div className="xt-foottext">
      <span className="xt-foottext__line">
        <Trans t={t} i18nKey="footer.poweredBy" values={{ year: new Date().getFullYear() }} components={{ b: <b /> }} />
      </span>
      {showUptime && (
        <span className="xt-foottext__meta">
          <span title={t("footer.uptimeHint")}>{t("footer.uptime")}: <b>{meta ? formatUptime(liveUptime) : "—"}</b></span>
          <span className="xt-sep">·</span>
          <span title={t("footer.latencyHint")}>{t("footer.latency")}: <b>{meta ? `${meta.latencyMs} ms` : "—"}</b></span>
        </span>
      )}
    </div>
  );
}

/**
 * The footer's bottom: the legal and footer links on the left and the reader's
 * theme picker on the right, with the fixed copyright line centred under them.
 */
export function FooterBar({ showUptime = false, showThemeChooser = true }: {
  showUptime?: boolean; showThemeChooser?: boolean;
}) {
  const links = useFooterNavLinks();
  return (
    <div className="xt-footbar">
      {/* No links and no picker: no row, so it holds no space above the copyright. */}
      {(links.length > 0 || showThemeChooser) && (
        <div className="xt-footbar__top">
          <FooterLinkList links={links} />
          {/* Draws nothing with fewer than two installed themes. */}
          {showThemeChooser && <span className="xt-footbar__theme"><ThemeChooser /></span>}
        </div>
      )}
      <FooterText showUptime={showUptime} />
    </div>
  );
}

/** ⚠ Superseded by `FooterBar`; renders documents stored before it. */
export function FooterBranding({ showUptime = true, showThemeChooser = true }: {
  showUptime?: boolean; showThemeChooser?: boolean;
}) {
  return (
    <>
      <FooterLinks showThemeChooser={showThemeChooser} />
      <FooterText showUptime={showUptime} />
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
  // There is no `.xt-foot` wrapper here any more: the band is the `footer` BLOCK, the
  // way the masthead is the `header` block. A wrapper here would paint the band
  // whether or not the document asked for one — so "delete the footer chrome" would
  // leave its background behind, and the block's own background would draw inside a
  // second one.
  return <LayoutRegion document={layout} region="footer" />;
}

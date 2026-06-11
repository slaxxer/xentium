import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { Avatar } from "../../components/Avatar";
import { useAuth } from "../../hooks/useAuth";
import { swalToast, apiErrorMessage } from "../../lib/swal";
import "./MembersPage.scss";

/* ── types ─────────────────────────────────────────────────────────────── */
type Metric = "posts" | "threads" | "likes" | "followers";

interface Member {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatar: string | null;
  role: string | null;
  roleKey: string | null;
  badgeColor: string | null;
  joinedAt: string;
  postCount: number;
  threadCount: number;
  followerCount: number;
  likeCountReceived: number;
  online: boolean;
  banned: boolean;
  permanentBan: boolean;
}
interface Facets {
  total: number;
  online: number;
  staff: number;
  groups: { key: string; name: string; count: number }[];
}
interface MemberPage {
  data: Member[];
  meta: { page: number; totalPages: number; total: number; hasNext: boolean; hasPrev: boolean };
  facets: Facets;
}
interface TeamSection { key: string; label: string; members: Member[] }
interface HallOfFame {
  metric: Metric;
  members: Member[];
  stats: { total: number; online: number; newThisWeek: number; totalPosts: number };
}

type Tab = "all" | "team" | "hof";

/* ── helpers ───────────────────────────────────────────────────────────── */
function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(n);
}
function tenure(iso: string, t: TFunction): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days >= 365) return t("tenure.years",  { n: Math.floor(days / 365) });
  if (days >= 30)  return t("tenure.months", { n: Math.floor(days / 30) });
  if (days >= 1)   return t("tenure.days",   { n: days });
  return t("tenure.today");
}
function metricValue(m: Member, metric: Metric): number {
  return metric === "posts" ? m.postCount
    : metric === "threads" ? m.threadCount
    : metric === "followers" ? m.followerCount
    : m.likeCountReceived;
}

function RolePill({ m, sm }: { m: Member; sm?: boolean }) {
  const { t } = useTranslation("members");
  if (!m.role) return null;
  // System group names are localized; custom groups keep their DB name.
  const label = m.roleKey ? t(`groups.${m.roleKey}`, { defaultValue: m.role }) : m.role;
  const cls = `mp-role${sm ? " mp-role--sm" : ""}`;
  if (m.badgeColor) {
    return <span className={cls} style={{ background: `${m.badgeColor}22`, color: m.badgeColor }}>{label}</span>;
  }
  const variant = m.roleKey === "admin" ? "admin"
    : (m.roleKey === "supermod" || m.roleKey === "moderator") ? "mod" : "member";
  return <span className={`${cls} mp-role--${variant}`}>{label}</span>;
}

/** Group-badge name highlighting — colour the member's name with their group's badge colour. */
function nameStyle(m: Member): React.CSSProperties | undefined {
  return m.badgeColor ? { color: m.badgeColor } : undefined;
}

/** Optimistic follow button (§36). Hidden for the current user / when logged out. */
function FollowButton({ m, variant }: { m: Member; variant: "soft" | "primary" }) {
  const { t } = useTranslation("members");
  const { user, isAuthenticated } = useAuth();
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!isAuthenticated || user?.id === m.id) return null;

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    const next = !following;
    setFollowing(next);
    try {
      if (next) await api.post(`/users/${m.id}/follow`);
      else await api.delete(`/users/${m.id}/follow`);
    } catch (err) {
      setFollowing(!next);
      swalToast(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      className={`mp-follow mp-follow--${variant}${following ? " is-following" : ""}`}
      disabled={busy}
      onClick={toggle}
    >
      {following ? t("following") : t("follow")}
    </button>
  );
}

/* ── shared row / podium pieces ────────────────────────────────────────── */
/** Red lock shown right after a banned member's name. */
function BanLock({ m }: { m: Member }) {
  const { t } = useTranslation("members");
  if (!m.banned) return null;
  return (
    <FontAwesomeIcon
      icon={faLock}
      className="mp-banlock"
      title={m.permanentBan ? t("permanentlyBanned") : t("banned")}
    />
  );
}

function DirRow({ m }: { m: Member }) {
  const { t } = useTranslation("members");
  const navigate = useNavigate();
  const go = () => navigate(`/u/${m.username}`);
  return (
    <div className="mp-row" onClick={go} role="link" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") go(); }}>
      <Avatar user={{ username: m.username, avatar: m.avatar }} size={46} online={m.online} />
      <div className="mp-row__id">
        <div className="mp-row__top"><b style={nameStyle(m)}>{m.displayName ?? m.username}</b><BanLock m={m} /><RolePill m={m} sm /></div>
        <span className="mp-row__handle">@{m.username} · {t("joined", { ago: tenure(m.joinedAt, t) })}</span>
      </div>
      <p className="mp-row__bio">{m.bio ?? ""}</p>
      <div className="mp-row__stats">
        <div><b>{fmt(m.postCount)}</b><span>{t("metrics.posts")}</span></div>
        <div><b>{fmt(m.followerCount)}</b><span>{t("metrics.followers")}</span></div>
        <div><b>{fmt(m.likeCountReceived)}</b><span>{t("metrics.likes")}</span></div>
      </div>
      <FollowButton m={m} variant="soft" />
    </div>
  );
}

function PodiumSpot({ m, place, metric }: { m: Member; place: 1 | 2 | 3; metric: Metric }) {
  const { t } = useTranslation("members");
  const ring = { 1: "#f4b740", 2: "#c2c7d0", 3: "#d6986a" }[place];
  const medal = { 1: "🥇", 2: "🥈", 3: "🥉" }[place];
  return (
    <div className={`mp-spot mp-spot--${place}`}>
      <div className="mp-spot__medal">{medal}</div>
      <div className="mp-spot__ava" style={{ boxShadow: `0 0 0 4px var(--c-card), 0 0 0 8px ${ring}` }}>
        <Avatar user={{ username: m.username, avatar: m.avatar }} size={place === 1 ? 92 : 74} online={m.online} />
      </div>
      <b className="mp-spot__name" style={nameStyle(m)}>{m.displayName ?? m.username}<BanLock m={m} /></b>
      <RolePill m={m} sm />
      <div className="mp-spot__likes">
        {metric === "likes" && <span>♥</span>} {fmt(metricValue(m, metric))} {t(`metrics.${metric}`)}
      </div>
    </div>
  );
}

/* ── tab bodies ────────────────────────────────────────────────────────── */
function DirectoryView() {
  const { t } = useTranslation("members");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("active");
  const [page, setPage] = useState(1);

  const SORTS: { id: string; label: string }[] = [
    { id: "active",    label: t("sorts.active") },
    { id: "followers", label: t("sorts.followers") },
    { id: "newest",    label: t("sorts.newest") },
    { id: "az",        label: t("sorts.az") },
  ];

  const { data, isLoading } = useQuery<MemberPage>({
    queryKey: ["members", q, filter, sort, page],
    queryFn: () => api.get(`/members?page=${page}&limit=24&filter=${filter}&sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
    placeholderData: keepPreviousData,
  });

  const members = data?.data ?? [];
  const meta = data?.meta;
  const facets = data?.facets;

  const FILTERS = [
    { id: "all",    label: t("filters.all"),    n: facets?.total ?? 0 },
    { id: "online", label: t("filters.online"), n: facets?.online ?? 0, dot: true },
    { id: "staff",  label: t("filters.staff"),  n: facets?.staff ?? 0 },
    ...(facets?.groups ?? []).map((g) => ({ id: g.key, label: t(`groups.${g.key}`, { defaultValue: g.name }), n: g.count })),
  ];

  return (
    <div className="mp-dir">
      <aside className="mp-rail">
        <div className="mp-rail__search">
          <span>⌕</span>
          <input value={q} placeholder={t("search")}
            onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="mp-rail__h">{t("filterHeading")}</div>
        <nav className="mp-filters">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={filter === f.id ? "is-on" : ""}
              onClick={() => { setFilter(f.id); setPage(1); }}>
              {"dot" in f && f.dot && <i className="mp-fdot" />}{f.label}<em>{f.n}</em>
            </button>
          ))}
        </nav>
        <div className="mp-rail__h">{t("sortHeading")}</div>
        <div className="mp-sortbox">
          {SORTS.map((s) => (
            <button key={s.id} type="button" className={sort === s.id ? "is-on" : ""}
              onClick={() => { setSort(s.id); setPage(1); }}>{s.label}</button>
          ))}
        </div>
      </aside>

      <main className="mp-main">
        <div className="mp-listhead">
          <span>{t("memberCount", { count: meta?.total ?? 0 })}</span>
          <span className="mp-online">● {t("onlineCount", { n: facets?.online ?? 0 })}</span>
        </div>
        {isLoading ? (
          <div className="mp-empty">{t("loading")}</div>
        ) : members.length === 0 ? (
          <div className="mp-empty">{q ? t("emptyQuery", { query: q }) : t("emptyFilter")}</div>
        ) : (
          <div className="mp-list">{members.map((m) => <DirRow key={m.id} m={m} />)}</div>
        )}
        {meta && meta.totalPages > 1 && (
          <nav className="mp-pagination">
            <button type="button" disabled={!meta.hasPrev} onClick={() => setPage((p) => p - 1)}>{t("pagination.prev")}</button>
            <span>{t("pagination.page", { page: meta.page, total: meta.totalPages })}</span>
            <button type="button" disabled={!meta.hasNext} onClick={() => setPage((p) => p + 1)}>{t("pagination.next")}</button>
          </nav>
        )}
      </main>
    </div>
  );
}

function TeamView() {
  const { t } = useTranslation("members");
  const { data = [], isLoading } = useQuery<TeamSection[]>({
    queryKey: ["members-team"],
    queryFn: () => api.get("/members/team"),
  });
  return (
    <>
      <p className="mp-note">{t("team.note")}</p>
      {isLoading ? (
        <div className="mp-empty">{t("loading")}</div>
      ) : data.length === 0 ? (
        <div className="mp-empty">{t("team.empty")}</div>
      ) : (
        data.map((section) => (
          <section key={section.key} className="mp-teamsec">
            <div className="mp-teamsec__head">
              <h2>{t(`groups.${section.key}`, { defaultValue: section.label })}</h2>
              <span>{section.members.length}</span>
            </div>
            <main className="mp-main mp-main--full">
              <div className="mp-list">{section.members.map((m) => <DirRow key={m.id} m={m} />)}</div>
            </main>
          </section>
        ))
      )}
    </>
  );
}

function HallOfFameView() {
  const { t } = useTranslation("members");
  const { data, isLoading } = useQuery<HallOfFame>({
    queryKey: ["members-hof"],
    queryFn: () => api.get("/members/hall-of-fame"),
  });
  if (isLoading) return <div className="mp-empty">{t("loading")}</div>;
  const members = data?.members ?? [];
  const metric = data?.metric ?? "likes";
  const stats = data?.stats;
  if (members.length === 0) return <div className="mp-empty">{t("hof.empty")}</div>;

  const metricLabel = t(`metrics.${metric}`);
  // Podium ordered visually 2 · 1 · 3 so #1 sits centre/highest.
  const podium = [members[1], members[0], members[2]].filter(Boolean) as Member[];
  const places: (1 | 2 | 3)[] = [2, 1, 3];

  return (
    <>
      <div className="mp-stats">
        <div className="mp-stat"><b>{fmt(stats?.total ?? members.length)}</b><span>{t("stats.members")}</span></div>
        <div className="mp-stat"><b className="mp-online">{fmt(stats?.online ?? 0)}</b><span>{t("stats.onlineNow")}</span></div>
        <div className="mp-stat"><b>{fmt(stats?.newThisWeek ?? 0)}</b><span>{t("stats.newThisWeek")}</span></div>
        <div className="mp-stat"><b>{fmt(stats?.totalPosts ?? 0)}</b><span>{t("stats.totalPosts")}</span></div>
      </div>

      <div className="mp-podium-wrap">
        <div className="mp-podium-head">
          <h2>{t("hof.title")}</h2>
          <span>{t("hof.subtitle", { metric: metricLabel })}</span>
        </div>
        <div className="mp-podium">
          {podium.map((m, i) => <PodiumSpot key={m.id} m={m} place={places[i]!} metric={metric} />)}
        </div>
      </div>

      <section className="mp-howto">
        <h3 className="mp-howto__title">{t("howTo.title")}</h3>
        <p className="mp-howto__intro">{t("howTo.intro", { metric: metricLabel })}</p>
        <ul className="mp-howto__list">
          <li><span>✍️</span>{t("howTo.tips.post")}</li>
          <li><span>💬</span>{t("howTo.tips.threads")}</li>
          <li><span>♥</span>{t("howTo.tips.likes")}</li>
          <li><span>⚡</span>{t("howTo.tips.active")}</li>
        </ul>
        <p className="mp-howto__foot">{t("howTo.levelUp")}</p>
      </section>
    </>
  );
}

/* ── page shell ────────────────────────────────────────────────────────── */
export function MembersPage() {
  const { t } = useTranslation("members");
  const [tab, setTab] = useState<Tab>("all");
  const TABS: { id: Tab; label: string }[] = [
    { id: "all",  label: t("tabs.directory") },
    { id: "team", label: t("tabs.team") },
    { id: "hof",  label: t("tabs.hallOfFame") },
  ];
  return (
    <div className="mp-wrap">
      <div className="mp-pagehead">
        <div>
          <span className="mp-eyebrow">{t("eyebrow")}</span>
          <h1 className="mp-h1">{t("title")}</h1>
        </div>
        <div className="mp-segtabs">
          {TABS.map((tb) => (
            <button key={tb.id} type="button" className={tab === tb.id ? "is-on" : ""} onClick={() => setTab(tb.id)}>
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "all"  && <DirectoryView />}
      {tab === "team" && <TeamView />}
      {tab === "hof"  && <HallOfFameView />}
    </div>
  );
}

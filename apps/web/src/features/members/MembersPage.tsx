import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { FontAwesomeIcon } from "../../components/Icon";
import { faLock } from "@fortawesome/free-solid-svg-icons";
import { blockTypesIn } from "@xentium/contracts";
import { api } from "../../lib/api";
import { Avatar } from "../../components/Avatar";
import { Username } from "../../components/Username";
import { useAuth } from "../../hooks/useAuth";
import { swalToast, apiErrorMessage } from "../../lib/swal";
import { LayoutRenderer } from "../../layout/LayoutRenderer";
import { useLayoutDocument } from "../../layout/useLayout";
import "./MembersPage.scss";
import { RankBadge } from "../../components/RankBadge";

/* ── types ─────────────────────────────────────────────────────────────── */
export type Metric = "posts" | "threads" | "likes" | "followers";

export interface Member {
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
export interface Facets {
  total: number;
  online: number;
  staff: number;
  groups: { key: string; name: string; count: number }[];
}
export interface MemberPage {
  data: Member[];
  meta: { page: number; totalPages: number; total: number; hasNext: boolean; hasPrev: boolean };
  facets: Facets;
}
export interface TeamSection { key: string; label: string; members: Member[] }
export interface HallOfFame {
  metric: Metric;
  members: Member[];
  stats: { total: number; online: number; newThisWeek: number; totalPosts: number };
}

type Tab = "all" | "team" | "hof";

/** One filter or sort choice in the directory rail. */
export interface MembersChoice { id: string; label: string; n?: number; dot?: boolean }

/**
 * What `MembersPage` resolves for the member blocks (ADR-0005).
 *
 * Declared here, with the host that produces it, so `memberBlocks` imports one way.
 */
export interface MembersContext {
  tab: string;
  setTab: (id: string) => void;
  tabs: MembersChoice[];
  /** Which views the layout placed AND the current tab allows. */
  show: { directory: boolean; team: boolean; hof: boolean };

  q: string;      setQ: (v: string) => void;
  filter: string; setFilter: (v: string) => void;
  sort: string;   setSort: (v: string) => void;
  filters: MembersChoice[];
  sorts: MembersChoice[];

  members: Member[];
  meta?: MemberPage["meta"];
  facets?: Facets;
  listLoading: boolean;
  page: number;
  setPage: (fn: (p: number) => number) => void;

  team: TeamSection[];
  teamLoading: boolean;

  hof?: HallOfFame;
  hofLoading: boolean;
}

/* ── helpers ───────────────────────────────────────────────────────────── */
export function fmt(n: number): string {
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
  const variant = m.roleKey === "admin" ? "admin"
    : (m.roleKey === "supermod" || m.roleKey === "moderator") ? "mod" : "member";
  return (
    <RankBadge groupKey={m.roleKey} label={label}>
      {m.badgeColor
        ? <span className={cls} style={{ background: `${m.badgeColor}22`, color: m.badgeColor }}>{label}</span>
        : <span className={`${cls} mp-role--${variant}`}>{label}</span>}
    </RankBadge>
  );
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

export function DirRow({ m }: { m: Member }) {
  const { t } = useTranslation("members");
  const navigate = useNavigate();
  const go = () => navigate(`/u/${m.username}`);
  return (
    <div className="mp-row" onClick={go} role="link" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") go(); }}>
      <Avatar user={{ username: m.username, avatar: m.avatar }} size={46} online={m.online} />
      <div className="mp-row__id">
        <div className="mp-row__top"><b><Username username={m.displayName ?? m.username} badgeColor={m.badgeColor} roleKey={m.roleKey} /></b><BanLock m={m} /><RolePill m={m} sm /></div>
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

export function PodiumSpot({ m, place, metric }: { m: Member; place: 1 | 2 | 3; metric: Metric }) {
  const { t } = useTranslation("members");
  const ring = { 1: "#f4b740", 2: "#c2c7d0", 3: "#d6986a" }[place];
  const medal = { 1: "🥇", 2: "🥈", 3: "🥉" }[place];
  return (
    <div className={`mp-spot mp-spot--${place}`}>
      <div className="mp-spot__medal">{medal}</div>
      <div className="mp-spot__ava" style={{ boxShadow: `0 0 0 4px var(--c-card), 0 0 0 8px ${ring}` }}>
        <Avatar user={{ username: m.username, avatar: m.avatar }} size={place === 1 ? 92 : 74} online={m.online} />
      </div>
      <b className="mp-spot__name"><Username username={m.displayName ?? m.username} badgeColor={m.badgeColor} roleKey={m.roleKey} /><BanLock m={m} /></b>
      <RolePill m={m} sm />
      <div className="mp-spot__likes">
        {metric === "likes" && <span>♥</span>} {fmt(metricValue(m, metric))} {t(`metrics.${metric}`)}
      </div>
    </div>
  );
}

/**
 * Host container for the `members` template (ADR-0005).
 *
 * Owns every query and every piece of interaction state the member blocks read, so
 * the search box can sit in one region and the list it filters in another and the two
 * still agree.
 *
 * ## It fetches what the DOCUMENT places
 *
 * The team and hall-of-fame queries used to be lazy by construction: their view
 * mounted only when its tab was active. With the pieces separated that guarantee is
 * gone, so laziness became explicit — and it reads the layout to decide. A block that
 * is not placed is never fetched for, and if an admin removes the tab switcher
 * entirely, everything they DID place is shown at once instead of becoming
 * unreachable.
 */
export function MembersPage() {
  const { t } = useTranslation("members");
  const layout = useLayoutDocument("members");

  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("active");
  const [page, setPage] = useState(1);

  // What the admin actually placed. Without the tab switcher there is no way to
  // change tabs, so every placed view is shown rather than stranded.
  const placed = useMemo(() => blockTypesIn(layout), [layout]);
  const hasTabs = placed.has("membersTabs");
  const wants = (type: string, forTab: Tab) =>
    placed.has(type) && (!hasTabs || tab === forTab);

  const showDirectory = wants("membersList", "all") || wants("membersFilters", "all");
  const showTeam = ["membersTeam"].some((b) => wants(b, "team"));
  const showHof = ["membersHofStats", "membersPodium", "membersHowTo"].some((b) => wants(b, "hof"));

  const directoryQuery = useQuery<MemberPage>({
    queryKey: ["members", q, filter, sort, page],
    queryFn: () => api.get(`/members?page=${page}&limit=24&filter=${filter}&sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
    placeholderData: keepPreviousData,
    enabled: showDirectory,
  });

  const teamQuery = useQuery<TeamSection[]>({
    queryKey: ["members-team"],
    queryFn: () => api.get("/members/team"),
    enabled: showTeam,
  });

  const hofQuery = useQuery<HallOfFame>({
    queryKey: ["members-hof"],
    queryFn: () => api.get("/members/hall-of-fame"),
    enabled: showHof,
  });

  const facets = directoryQuery.data?.facets;

  const context: MembersContext = {
    tab,
    setTab: (id) => setTab(id as Tab),
    tabs: [
      { id: "all",  label: t("tabs.directory") },
      { id: "team", label: t("tabs.team") },
      { id: "hof",  label: t("tabs.hallOfFame") },
    ],
    show: { directory: showDirectory, team: showTeam, hof: showHof },

    q, setQ: (v) => { setQ(v); setPage(1); },
    filter, setFilter: (v) => { setFilter(v); setPage(1); },
    sort, setSort: (v) => { setSort(v); setPage(1); },
    filters: [
      { id: "all",    label: t("filters.all"),    n: facets?.total ?? 0 },
      { id: "online", label: t("filters.online"), n: facets?.online ?? 0, dot: true },
      { id: "staff",  label: t("filters.staff"),  n: facets?.staff ?? 0 },
      ...(facets?.groups ?? []).map((g) => ({
        id: g.key, label: t(`groups.${g.key}`, { defaultValue: g.name }), n: g.count,
      })),
    ],
    sorts: [
      { id: "active",    label: t("sorts.active") },
      { id: "followers", label: t("sorts.followers") },
      { id: "newest",    label: t("sorts.newest") },
      { id: "az",        label: t("sorts.az") },
    ],

    members: directoryQuery.data?.data ?? [],
    meta: directoryQuery.data?.meta,
    facets,
    listLoading: directoryQuery.isLoading,
    page, setPage,

    team: teamQuery.data ?? [],
    teamLoading: teamQuery.isLoading,

    hof: hofQuery.data,
    hofLoading: hofQuery.isLoading,
  };

  return (
    <div className="mp-wrap">
      <LayoutRenderer templateKey="members" document={layout} context={context} />
    </div>
  );
}

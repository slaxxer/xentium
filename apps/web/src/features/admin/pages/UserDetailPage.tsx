import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link } from "react-router-dom";
import type { AwardedBadge, BadgeRow } from "@xentium/contracts";
import { BadgeMark } from "../../../components/UserBadges";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { useAuth } from "../../../hooks/useAuth";
import { useDraft, type DraftChange } from "../../../hooks/useDraft";
import { apiErrorMessage } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faChevronLeft, faChevronRight, faBan, faShield, faRightFromBracket, faKey, faPowerOff,
  faAddressCard, faUserGroup, faShieldHalved, faTriangleExclamation, faNewspaper,
  faAward, faXmark, faLock, faAt, faArrowUpRightFromSquare, faMagnifyingGlass,
} from "@fortawesome/free-solid-svg-icons";
import { faEnvelope } from "@fortawesome/free-regular-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { Avatar } from "../../../components/Avatar";
import { slotRegistry } from "../../../plugins/slotRegistry";
import { timeAgo } from "../../../lib/time";
import {
  type Group, type UserStatus, type UserFlag, BanDialog, RolePill, StatusPill,
  topGroup, groupColor, lastSeenText,
} from "./users/usersShared";
import "./UserDetailPage.scss";
import "./users/Users.scss";
import { Username } from "../../../components/Username";
import { fieldLabel } from "../../../lib/coreText";
import { siteTime } from "../../../lib/datetime";

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ value, title }: { value: string; title?: string }) {
  const { t } = useTranslation("acp");
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  };
  return (
    <button type="button" className={"up-copy" + (done ? " done" : "")} onClick={copy} title={title ?? t("userDetail.copy")}>
      {done ? "✓" : "⧉"}
    </button>
  );
}

interface ProfileFieldEntry {
  field: { id: string; key: string; label: string; type: string };
  value: string;
}

interface LoginEvent {
  id: string;
  ip: string | null;
  userAgent: string | null;
  deviceCookieId: string | null;
  success: boolean;
  eventType: string;
  createdAt: string;
}

interface UserDetail {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
  isActive: boolean;
  bannedUntil: string | null;
  createdAt: string;
  emailVerifiedAt: string | null;
  /** Two-factor sign-in on since — null = off. */
  totpEnabledAt: string | null;
  postCount: number;
  articleCount: number;
  commentCount: number;
  _count: { articles: number; articleComments: number };
  status: UserStatus;
  activeBan: { type: string; reason: string; expiresAt: string | null; createdAt: string } | null;
  lastSeenAt: string | null;
  online: boolean;
  flags: UserFlag[];
  failedSignins24h: number;
  activeSessions: number;
  knownIps: string[];
  deviceCookies: string[];
  ipSeen: { ip: string; lastSeenAt: string }[];
  devices: { id: string; lastSeenAt: string; userAgent: string | null }[];
  securityEventTotal: number;
  groups: Group[];
  profileFields: ProfileFieldEntry[];
}

/** The page's sections, in scroll order. The nav follows the one under the top edge. */
const SECTIONS = ["account", "access", "content", "security"] as const;
type Section = (typeof SECTIONS)[number];
const sectionId = (s: Section) => `up-sec-${s}`;
/** Where a section lands: just below the sticky section nav, whichever ACP chrome is worn. */
function scrollOffset(): number {
  const nav = document.querySelector<HTMLElement>(".up-secnav");
  if (!nav) return 128;
  return (parseFloat(getComputedStyle(nav).top) || 0) + nav.offsetHeight + 12;
}

/** "20+" once a list reaches the server's cap, so a count never under-reports. */
const capped = (n: number) => (n >= 20 ? "20+" : String(n));

/** "macOS · Chrome" out of a user agent: the device column, not a fingerprint. */
function deviceOf(ua: string | null): string {
  if (!ua) return "—";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  return [os, br].filter(Boolean).join(" · ") || ua.slice(0, 40);
}

// ── Security activity (paginated, 10 per page) ─────────────────────────────────

interface LoginEventsPage {
  data: LoginEvent[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

function SecurityEvents({ userId }: { userId: string }) {
  const { t } = useTranslation("acp");
  const [page, setPage] = useState(1);
  const limit = 10;

  const { data, isLoading, isFetching } = useQuery<LoginEventsPage>({
    queryKey: ["acp-user-events", userId, page],
    queryFn:  () => api.get(`/admin/users/${userId}/login-events?page=${page}&limit=${limit}`),
    placeholderData: (prev) => prev,   // keep the current page visible while the next loads
  });

  const events = data?.data ?? [];
  const total  = data?.meta.total ?? 0;
  const pages  = data?.meta.totalPages ?? 1;
  const from   = total === 0 ? 0 : (page - 1) * limit + 1;
  const to     = Math.min(page * limit, total);

  if (isLoading) return <p className="up-empty up-pad">{t("userDetail.loading")}</p>;
  if (events.length === 0) return <p className="up-empty up-pad">{t("userDetail.noEvents")}</p>;
  return (
    <>
      <div className="up-scroll-x">
        <table className="up-table">
          <thead><tr><th>{t("userDetail.evType")}</th><th>{t("userDetail.evIp")}</th><th>{t("users.device")}</th><th className="up-when">{t("userDetail.evWhen")}</th></tr></thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id}>
                <td>
                  <span className="up-evt">
                    <span className={"up-result" + (ev.success ? "" : " fail")}><i />{ev.success ? t("userDetail.success") : t("userDetail.failed")}</span>
                    <span className="up-evt__type">{t(`users.event.${ev.eventType}`, { defaultValue: ev.eventType.replace(/_/g, " ") })}</span>
                  </span>
                </td>
                <td><span className="up-mono">{ev.ip ?? "—"}</span></td>
                <td>
                  <span className="up-dev" title={ev.userAgent ?? undefined}>
                    {deviceOf(ev.userAgent)}{ev.deviceCookieId && <span className="up-mono up-dev__cookie"> · {ev.deviceCookieId.slice(0, 8)}</span>}
                  </span>
                </td>
                <td className="up-when">{siteTime.stamp(ev.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="up-table__foot">
        <span>{t("userDetail.showing", { from, to, total })}</span>
        <div className="up-pager">
          <button type="button" className="up-pglink" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>{t("userDetail.prev")}</button>
          <span className="up-pager__cur">{t("userDetail.pageOf", { page, pages })}</span>
          <button type="button" className="up-pglink" disabled={page >= pages || isFetching} onClick={() => setPage((p) => p + 1)}>{t("userDetail.next")}</button>
        </div>
      </div>
    </>
  );
}

/**
 * Which badges this member has, and the one place an admin changes that.
 *
 * ⚠ Shows how each one was come by. Both kinds are real awards and both can be taken
 * back here — the difference is only who decided: an admin handed it over, or the
 * reward sweep granted it because the member met the badge's thresholds.
 *
 * ⚠ Revoking an EARNED badge is not permanent if the member still meets the
 * thresholds: the next sweep grants it again. Say so, rather than let an admin think
 * a revoke failed.
 *
 * Granting is immediate, not part of the save bar: a badge is an award with its own
 * notification, not a field of the account.
 */
function BadgesPanel({ userId, held }: { userId: string; held: AwardedBadge[] }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();

  const catalogue = useQuery<BadgeRow[]>({
    queryKey: ["admin-badges"],
    queryFn:  () => api.get("/admin/badges"),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-user-badges", userId] });
    // The member's cards elsewhere are keyed by user id.
    void qc.invalidateQueries({ queryKey: ["user-badges", userId] });
  };

  const grant = useMutation({
    mutationFn: (badgeId: string) => api.post(`/admin/badges/${badgeId}/award`, { userId }),
    onSuccess: () => { refresh(); toast.success(t("userDetail.badgeGranted")); },
    onError:   (e) => toast.error(apiErrorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (badgeId: string) => api.delete(`/admin/badges/${badgeId}/award/${userId}`),
    onSuccess: () => { refresh(); toast.success(t("users.badgeRevoked")); },
    onError:   (e) => toast.error(apiErrorMessage(e)),
  });

  const heldIds = new Set(held.map((b) => b.id));
  const grantable = (catalogue.data ?? []).filter((b) => !heldIds.has(b.id));

  return (
    <div className="up-half">
      <div className="up-sec-head">
        <div className="ic"><FontAwesomeIcon icon={faAward} /></div>
        <h3>{t("userDetail.badges")}</h3>
        <span className="count">{t("users.held", { count: held.length })}</span>
      </div>
      <div className="up-badges">
        {held.map((b) => (
          <span key={b.id} className={`up-badge${b.source === "earned" ? " up-badge--earned" : ""}`}
            title={b.source === "earned" ? t("userDetail.badgeEarnedHint") : (b.note ?? b.description ?? b.name)}>
            <BadgeMark badge={b} size="sm" />
            <span className="up-badge__name">{b.name}</span>
            <span className="up-badge__src">{b.source === "earned" ? t("userDetail.badgeEarned") : t("users.badgeGranted")}</span>
            <button type="button" className="up-badge__x" title={t("userDetail.badgeRevoke")}
              onClick={() => revoke.mutate(b.id)} disabled={revoke.isPending}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </span>
        ))}
        {held.length === 0 && <span className="up-empty">{t("userDetail.noBadges")}</span>}
      </div>
      <select className="inp inp--sm up-grant" value="" aria-label={t("userDetail.badgeGrantHint")}
        disabled={grant.isPending || grantable.length === 0}
        onChange={(e) => { if (e.target.value) grant.mutate(e.target.value); }}>
        <option value="">{grantable.length ? t("userDetail.badgeGrantPick") : t("userDetail.badgeGrantNone")}</option>
        {grantable.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </div>
  );
}

/**
 * Known addresses or devices: the first few, and the rest on request. A busy account
 * has twenty; listing them all made the Security section a column of rows.
 */
function SeenList<T>({ label, items, render }: { label: string; items: T[]; render: (item: T) => React.ReactNode }) {
  const { t } = useTranslation("acp");
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SEEN_SHOWN);
  const rest = items.length - SEEN_SHOWN;
  return (
    <div className="up-seen__box">
      <div className="up-id__label">{label}</div>
      {items.length === 0 && <span className="up-empty">—</span>}
      {shown.map(render)}
      {rest > 0 && (
        <button type="button" className="up-link up-seen__more" onClick={() => setAll((v) => !v)}>
          {all ? t("userDetail.showLess") : items.length >= 20 ? t("users.moreCapped", { count: rest }) : t("users.more", { count: rest })}
        </button>
      )}
    </div>
  );
}
const SEEN_SHOWN = 6;

/** One row of the sidebar's action list: icon, what it does, what it will touch. */
function ActionRow({ icon, label, sub, tone, onClick, disabled, lockedTitle }: {
  icon: IconDefinition; label: string; sub: string; tone: "neutral" | "warn" | "danger" | "ok";
  onClick: () => void; disabled?: boolean; lockedTitle?: string;
}) {
  return (
    <button type="button" className={`up-act up-act--${tone}`} onClick={onClick} disabled={disabled}
      title={disabled ? lockedTitle : undefined}>
      <span className="up-act__ic"><FontAwesomeIcon icon={icon} /></span>
      <span className="up-act__text">
        <b>{label}</b>
        <span>{sub}</span>
      </span>
      <FontAwesomeIcon className="up-act__go" icon={disabled ? faLock : faChevronRight} />
    </button>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

type AccountDraft = { username: string; email: string };

export function UserDetailPage() {
  const { t } = useTranslation("acp");
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isSelf = currentUser?.id === id;

  const [banOpen, setBanOpen] = useState(false);

  const { data: user, isLoading } = useQuery<UserDetail>({
    queryKey: ["acp-user", id],
    queryFn: () => api.get(`/admin/users/${id}`),
    enabled: !!id,
  });
  const { data: allGroups = [] } = useQuery<Group[]>({
    queryKey: ["acp-groups-list"],
    queryFn: () => api.get<Group[]>("/admin/groups"),
  });
  const { data: held = [] } = useQuery<AwardedBadge[]>({
    queryKey: ["admin-user-badges", id],
    queryFn:  () => api.get(`/user-badges/${id}`),
    enabled: !!id,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["acp-user", id] });
    void queryClient.invalidateQueries({ queryKey: ["acp-users"] });
  };
  const fail = (e: unknown) => toast.error(apiErrorMessage(e));

  // ── Drafts: the account fields and group membership join the ACP save bar ──────
  const savedAccount = useMemo<AccountDraft | undefined>(
    () => (user ? { username: user.username, email: user.email } : undefined), [user?.username, user?.email]);
  const [account, setAccount] = useState<AccountDraft>({ username: "", email: "" });
  const savedGroupIds = useMemo(() => (user ? user.groups.map((g) => g.id).sort() : undefined), [user?.groups]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  // A different member re-seeds the drafts; a background refetch of the SAME member
  // does not stomp edits in progress.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!user || seededFor.current === user.id) return;
    seededFor.current = user.id;
    setAccount({ username: user.username, email: user.email });
    setGroupIds(user.groups.map((g) => g.id).sort());
  }, [user]);

  const accountMutation = useMutation({
    mutationFn: (d: AccountDraft) => api.patch<AccountDraft>(`/admin/users/${id}/account`, {
      ...(d.username !== savedAccount?.username ? { username: d.username.trim() } : {}),
      ...(d.email !== savedAccount?.email ? { email: d.email.trim() } : {}),
    }),
    onSuccess: (res) => {
      setAccount({ username: res.username, email: res.email });
      refresh();
    },
  });
  useDraft<AccountDraft>({
    id: "acp-user-account",
    value: account,
    savedValue: savedAccount,
    onSave: (d) => accountMutation.mutateAsync(d),
    onDiscard: () => savedAccount && setAccount(savedAccount),
    describe: (v, s): DraftChange[] => [
      ...(v.username !== s.username ? [{ key: "username", label: t("userDetail.username"), from: s.username, to: v.username, revert: () => setAccount((a) => ({ ...a, username: s.username })) }] : []),
      ...(v.email !== s.email ? [{ key: "email", label: t("userDetail.emailAddress"), from: s.email, to: v.email, revert: () => setAccount((a) => ({ ...a, email: s.email })) }] : []),
    ],
  });

  /**
   * ⚠ Never PUT the draft as the member's new set. The draft was taken when the page
   * opened; a promotion by the progression sweep or another admin's edit since then
   * would be reverted by a replacement. `PATCH {add, remove}` touches only the rows the
   * admin toggled here.
   */
  const groupsMutation = useMutation({
    mutationFn: (ids: string[]) => {
      const saved = new Set(savedGroupIds ?? []);
      const next = new Set(ids);
      return api.patch<{ groups: Group[] }>(`/admin/users/${id}/groups`, {
        add: ids.filter((g) => !saved.has(g)),
        remove: [...saved].filter((g) => !next.has(g)),
      });
    },
    onSuccess: (res) => {
      setGroupIds(res.groups.map((g) => g.id).sort());
      refresh();
    },
  });
  const groupName = (gid: string) => allGroups.find((g) => g.id === gid)?.name ?? gid;
  useDraft<string[]>({
    id: "acp-user-groups",
    value: groupIds,
    savedValue: savedGroupIds,
    onSave: (ids) => groupsMutation.mutateAsync(ids),
    onDiscard: () => savedGroupIds && setGroupIds(savedGroupIds),
    describe: (v, s): DraftChange[] => [{
      key: "groups", label: t("userDetail.groups"),
      from: s.map(groupName).join(", ") || "—", to: v.map(groupName).join(", ") || "—",
    }],
  });

  // ── Account actions ────────────────────────────────────────────────────────
  const activeMutation = useMutation({
    mutationFn: (isActive: boolean) => api.patch(`/admin/users/${id}/active`, { isActive }),
    onSuccess: (_, isActive) => { refresh(); toast.success(isActive ? t("userDetail.toastActivated") : t("userDetail.toastDeactivated")); },
    onError: fail,
  });
  const liftBanMutation = useMutation({
    mutationFn: () => api.delete(`/admin/users/${id}/ban`),
    onSuccess: () => { refresh(); toast.success(t("userDetail.toastBanLifted")); },
    onError: fail,
  });
  const forceLogoutMutation = useMutation({
    mutationFn: () => api.post<{ revokedSessions: number }>(`/admin/users/${id}/force-logout`, {}),
    onSuccess: (res) => { refresh(); toast.success(t("userDetail.toastLoggedOut", { count: res.revokedSessions })); },
    onError: fail,
  });
  const resetPasswordMutation = useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/password-reset`, {}),
    onSuccess: () => toast.success(t("userDetail.toastResetSent", { email: user?.email })),
    onError: fail,
  });

  const resetTwoFactorMutation = useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/two-factor/reset`, {}),
    onSuccess: () => { refresh(); toast.success(t("userDetail.toastTwoFactorReset", { name: user?.username })); },
    onError: fail,
  });

  const confirm = (title: string, body: string, confirmText: string, danger = false) =>
    openDialog({ kind: "confirm", icon: danger ? "warning" : "question", title, body, confirmText, cancelText: t("userDetail.cancel"), danger });

  async function handleDeactivate() {
    if (!user) return;
    const willActivate = !user.isActive;
    const ok = await confirm(
      willActivate ? t("userDetail.activateTitle") : t("userDetail.deactivateTitle"),
      willActivate ? t("userDetail.activateText", { name: user.username }) : t("userDetail.deactivateText", { name: user.username }),
      willActivate ? t("userDetail.activate") : t("userDetail.deactivate"),
      !willActivate,
    );
    if (ok) activeMutation.mutate(willActivate);
  }
  async function handleLiftBan() {
    if (await confirm(t("userDetail.liftBanTitle"), t("userDetail.liftBanText", { name: user?.username }), t("userDetail.liftBan"))) {
      liftBanMutation.mutate();
    }
  }
  async function handleForceLogout() {
    if (await confirm(t("userDetail.logoutTitle"), t("userDetail.logoutText", { name: user?.username }), t("userDetail.logout"))) {
      forceLogoutMutation.mutate();
    }
  }
  async function handleResetTwoFactor() {
    if (await confirm(t("userDetail.twoFactorResetTitle"), t("userDetail.twoFactorResetText", { name: user?.username }), t("userDetail.twoFactorReset"), true)) {
      resetTwoFactorMutation.mutate();
    }
  }
  async function handleResetPassword() {
    if (await confirm(t("userDetail.resetTitle"), t("userDetail.resetText", { email: user?.email }), t("userDetail.sendEmail"))) {
      resetPasswordMutation.mutate();
    }
  }

  // ── Section nav: follows the scroll, and jumps on click ──────────────────────
  const [active, setActive] = useState<Section>("account");
  useEffect(() => {
    const onScroll = () => {
      let cur: Section = "account";
      for (const s of SECTIONS) {
        const el = document.getElementById(sectionId(s));
        if (el && el.getBoundingClientRect().top < scrollOffset() + 40) cur = s;
      }
      // The last section may be too short to reach the top: at the bottom, it is the one.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1]!;
      setActive(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [user?.id]);
  const go = (s: Section) => {
    const el = document.getElementById(sectionId(s));
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - scrollOffset(), behavior: "smooth" });
    setActive(s);
  };

  if (isLoading || !user) {
    return (
      <div className="acp-up">
        <section className="up-card up-skel">
          <div className="up-skel__hero"><span className="up-skel__ava" /><span className="up-skel__lines"><i /><i /></span></div>
          <div className="up-skel__tiles"><i /><i /><i /><i /></div>
        </section>
      </div>
    );
  }

  const isBanned = user.status === "banned";
  // Administrator accounts and your own cannot be reset, signed out, banned or edited
  // from here — mirrors the backend guard.
  const isAdminTarget = user.groups.some((g) => g.key === "admin");
  const protectedTarget = isSelf || isAdminTarget;
  const protectedReason = isSelf ? t("userDetail.protectedSelf") : t("userDetail.protectedAdmin");
  const top = topGroup(user.groups);
  const savedGroupSet = new Set(user.groups.map((g) => g.id));
  const draftGroupSet = new Set(groupIds);
  const toggleGroup = (gid: string) =>
    setGroupIds((prev) => (prev.includes(gid) ? prev.filter((x) => x !== gid) : [...prev, gid].sort()));
  const usernameEdited = account.username !== user.username;
  const emailEdited = account.email !== user.email;
  const unverified = !user.emailVerifiedAt;
  const banSub = user.bannedUntil && new Date(user.bannedUntil).getFullYear() >= 9999
    ? t("users.bannedPermanent")
    : user.bannedUntil ? t("users.bannedUntil", { date: siteTime.date(user.bannedUntil) }) : "";

  const signals = [
    {
      label: t("userDetail.sigFailed"),
      value: user.failedSignins24h > 0 ? String(user.failedSignins24h) : t("userDetail.sigNone"),
      tone: user.failedSignins24h > 0 ? "bad" : "ok",
    },
    { label: t("userDetail.kEmail"), value: unverified ? t("users.unverified") : t("userDetail.verified"), tone: unverified ? "warn" : "ok" },
    { label: t("userDetail.statIps"), value: capped(user.knownIps.length), tone: user.knownIps.length > 2 ? "warn" : "ok" },
    { label: t("users.activeSessions"), value: String(user.activeSessions), tone: "muted" },
  ];
  const sectionCount: Record<Section, number> = {
    account: 0,
    access: user.groups.length + held.length,
    content: 0,
    security: user.securityEventTotal,
  };
  const content = [
    { value: user._count.articles, label: t("userDetail.statArticles") },
    { value: user._count.articleComments, label: t("userDetail.statComments") },
    { value: user.postCount, label: t("userDetail.forumPosts") },
  ];

  return (
    <div className="acp-up">
      <div className="acp-up__crumb">
        <Link to="/admin/users"><FontAwesomeIcon icon={faChevronLeft} /> {t("users.allUsers")}</Link>
        <span className="sep">/</span>
        <span className="cur">{user.username}</span>
      </div>

      {isSelf && (
        <div className="up-banner">
          <div className="ic"><FontAwesomeIcon icon={faTriangleExclamation} /></div>
          <div><b>{t("userDetail.selfTitle")}</b> <span>{t("userDetail.selfDesc")}</span></div>
        </div>
      )}

      <div className="up-layout">
        {/* ── Identity sidebar ── */}
        <aside className="up-side">
          <section className="up-card up-id">
            <div className="up-id__top">
              <div className="up-id__who">
                <Avatar user={{ username: user.username, avatar: user.avatar }} size={60} online={user.online} />
                <div className="up-id__names">
                  <Username className="up-id__name" username={user.username} badgeColor={top?.progression?.badgeColor} />
                  <div className="up-id__seen">
                    {user.online ? t("userDetail.onlineNow") : t("userDetail.offlineSeen", { when: lastSeenText(user, t) })}
                  </div>
                </div>
              </div>
              <div className="up-id__pills">
                <RolePill group={top} fallback={t("userDetail.roleMember")} />
                {user.status === "inactive" || isBanned
                  ? <StatusPill status={user.status} long bannedUntil={user.bannedUntil} />
                  : <StatusPill status="active" />}
              </div>
            </div>

            {isBanned && user.activeBan && (
              <div className="up-banline">
                <FontAwesomeIcon icon={faBan} />
                <span><b>{t("users.banReason")}</b> {user.activeBan.reason}</span>
              </div>
            )}

            {/* Risk at a glance; the details are in Security. */}
            <div className="up-id__block">
              <div className="up-id__label">
                <span>{t("userDetail.signals")}</span>
                <button type="button" className="up-link" onClick={() => go("security")}>{t("users.review")}</button>
              </div>
              {signals.map((s) => (
                <div key={s.label} className={`up-signal up-signal--${s.tone}`}>
                  <i />
                  <span>{s.label}</span>
                  <b>{s.value}</b>
                </div>
              ))}
            </div>

            <div className="up-id__block up-id__facts">
              <div className="up-fact">
                <span className="up-id__label">{t("userDetail.kUserId")}</span>
                <span className="up-code"><span>{user.id}</span><CopyButton value={user.id} /></span>
              </div>
              <div className="up-fact">
                <span className="up-id__label">{t("userDetail.kEmail")}</span>
                <span className="up-fact__email">
                  <span>{user.email}</span>
                  {unverified && <span className="up-unverified">{t("users.unverified")}</span>}
                </span>
              </div>
              <div className="up-fact__joined">{t("userDetail.joined", { date: siteTime.date(user.createdAt) })}</div>
            </div>
          </section>

          <section className="up-card up-actions">
            <div className="up-id__label up-actions__title">{t("userDetail.accountActions")}</div>
            {protectedTarget && (
              <div className="up-actions__note">
                <FontAwesomeIcon icon={faLock} />
                <span>{isSelf ? t("userDetail.protectedNoteSelf") : t("userDetail.protectedNoteAdmin")}</span>
              </div>
            )}
            <ActionRow icon={faKey} tone="neutral" label={t("userDetail.resetPassword")}
              sub={t("userDetail.actResetSub", { email: user.email })}
              onClick={handleResetPassword} disabled={protectedTarget || resetPasswordMutation.isPending} lockedTitle={protectedReason} />
            <ActionRow icon={faRightFromBracket} tone="neutral" label={t("userDetail.logoutEverywhere")}
              sub={t("userDetail.actLogoutSub", { count: user.activeSessions })}
              onClick={handleForceLogout} disabled={protectedTarget || forceLogoutMutation.isPending} lockedTitle={protectedReason} />
            {user.totpEnabledAt && (
              <ActionRow icon={faShieldHalved} tone="warn" label={t("userDetail.twoFactorReset")}
                sub={t("userDetail.actTwoFactorSub", { date: siteTime.date(user.totpEnabledAt) })}
                onClick={handleResetTwoFactor} disabled={isSelf || resetTwoFactorMutation.isPending} lockedTitle={t("userDetail.twoFactorResetSelf")} />
            )}
            {isBanned ? (
              <ActionRow icon={faShield} tone="ok" label={t("userDetail.liftBan")} sub={banSub}
                onClick={handleLiftBan} disabled={liftBanMutation.isPending} />
            ) : (
              <ActionRow icon={faBan} tone="warn" label={t("userDetail.banEllipsis")} sub={t("userDetail.actBanSub")}
                onClick={() => setBanOpen(true)} disabled={protectedTarget} lockedTitle={protectedReason} />
            )}
            <ActionRow icon={faPowerOff} tone={user.isActive ? "danger" : "ok"}
              label={user.isActive ? t("userDetail.deactivateAccount") : t("userDetail.activateAccount")}
              sub={user.isActive ? t("userDetail.actDeactivateSub") : t("userDetail.actActivateSub")}
              onClick={handleDeactivate} disabled={isSelf || activeMutation.isPending} lockedTitle={t("userDetail.cannotDeactivateSelf")} />
          </section>
        </aside>

        {/* ── Content column ── */}
        <div className="up-main">
          <nav className="up-secnav" aria-label={t("userDetail.sections")}>
            {SECTIONS.map((s) => (
              <button key={s} type="button" className={active === s ? "is-on" : ""} aria-current={active === s ? "true" : undefined}
                onClick={() => go(s)}>
                {t(`userDetail.sec.${s}`)}
                {sectionCount[s] > 0 && <span className="up-secnav__n">{sectionCount[s]}</span>}
              </button>
            ))}
          </nav>

          {/* Account */}
          <section id={sectionId("account")} className="up-card">
            <div className="up-sec-head up-pad-head">
              <div className="ic"><FontAwesomeIcon icon={faAddressCard} /></div>
              <h3>{t("userDetail.sec.account")}</h3>
            </div>
            <div className="up-fields">
              <label className="up-field">
                <span className="up-field__label">{t("userDetail.username")}</span>
                <span className={"up-input" + (protectedTarget ? " is-locked" : "")}>
                  <FontAwesomeIcon icon={faAt} />
                  <input value={account.username} spellCheck={false} readOnly={protectedTarget} maxLength={30}
                    onChange={(e) => setAccount((a) => ({ ...a, username: e.target.value }))} />
                  {usernameEdited && <span className="up-edited">{t("userDetail.edited")}</span>}
                </span>
              </label>
              <label className="up-field">
                <span className="up-field__label">{t("userDetail.emailAddress")}</span>
                <span className={"up-input" + (protectedTarget ? " is-locked" : "")}>
                  <FontAwesomeIcon icon={faEnvelope} />
                  <input type="email" value={account.email} spellCheck={false} readOnly={protectedTarget} maxLength={254}
                    onChange={(e) => setAccount((a) => ({ ...a, email: e.target.value }))} />
                  {emailEdited && <span className="up-edited">{t("userDetail.edited")}</span>}
                </span>
              </label>
            </div>
            <p className="up-hint">
              {protectedTarget ? (isSelf ? t("userDetail.accountLockedSelf") : t("userDetail.accountLockedAdmin")) : t("userDetail.emailUnverifiedHint")}
            </p>
            <div className="up-pf">
              <div className="up-id__label">{t("userDetail.profileFields")}</div>
              {user.profileFields.length === 0 ? (
                <p className="up-empty">{t("users.noProfileFields")}</p>
              ) : (
                <div className="up-pf__grid">
                  {user.profileFields.map(({ field, value }) => (
                    <div key={field.id} className="up-pf__cell">
                      <span>{fieldLabel(field)}</span>
                      <b className={value ? "" : "is-empty"}>{value || t("userDetail.notSet")}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Access: groups + badges */}
          <section id={sectionId("access")} className="up-card up-access">
            <div className="up-half">
              <div className="up-sec-head">
                <div className="ic"><FontAwesomeIcon icon={faUserGroup} /></div>
                <h3>{t("userDetail.groups")}</h3>
                <span className="count">{t("userDetail.groupsOf", { n: groupIds.length, total: allGroups.length })}</span>
              </div>
              <GroupList allGroups={allGroups} draft={draftGroupSet} saved={savedGroupSet} isSelf={isSelf} onToggle={toggleGroup} />
            </div>
            <BadgesPanel userId={user.id} held={held} />
          </section>

          {/* Content */}
          <section id={sectionId("content")} className="up-card up-content">
            <div className="up-sec-head">
              <div className="ic ic--alt"><FontAwesomeIcon icon={faNewspaper} /></div>
              <h3>{t("userDetail.sec.content")}</h3>
            </div>
            <div className="up-content__stats">
              {content.map((c) => (
                <div key={c.label}><b>{c.value}</b><span>{c.label}</span></div>
              ))}
            </div>
            <Link className="up-content__link" to={`/u/${encodeURIComponent(user.username)}`} target="_blank" rel="noopener">
              {t("userDetail.viewProfile")} <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
            </Link>
          </section>

          {/* Security */}
          <section id={sectionId("security")} className="up-card">
            <div className="up-sec-head up-pad-head">
              <div className="ic"><FontAwesomeIcon icon={faShieldHalved} /></div>
              <h3>{t("userDetail.sec.security")}</h3>
              <span className="count">{t("userDetail.events", { count: user.securityEventTotal })}</span>
            </div>
            <div className="up-seen">
              <SeenList label={t("userDetail.knownIps", { count: user.ipSeen.length, n: capped(user.ipSeen.length) })}
                items={user.ipSeen} render={(r) => (
                  <div key={r.ip} className="up-seen__row">
                    <span className="up-mono up-seen__val">{r.ip}</span>
                    <span className="up-seen__when">{timeAgo(r.lastSeenAt)}</span>
                    <CopyButton value={r.ip} />
                  </div>
                )} />
              <SeenList label={t("userDetail.deviceCookies", { count: user.devices.length, n: capped(user.devices.length) })}
                items={user.devices} render={(d) => (
                  <div key={d.id} className="up-seen__row" title={d.userAgent ?? undefined}>
                    <span className="up-mono up-seen__val">{d.id.slice(0, 13)}</span>
                    <span className="up-seen__when">{deviceOf(d.userAgent)}</span>
                    <CopyButton value={d.id} title={t("userDetail.copyFullId")} />
                  </div>
                )} />
            </div>
            <SecurityEvents userId={user.id} />
          </section>

          {/* PLUGIN PANELS — e.g. advanced-moderation "Suspicious Multiaccounts". */}
          {slotRegistry.getUserDetailPanels().map((p) => (
            <p.component key={p.id} userId={user.id} username={user.username} />
          ))}
        </div>
      </div>

      {banOpen && (
        <BanDialog
          targets={[{ id: user.id, username: user.username }]}
          onClose={() => setBanOpen(false)}
          onDone={(out) => {
            setBanOpen(false);
            if (out.done.length) toast.success(t("userDetail.toastBanned", { name: user.username }));
            for (const r of out.refused) toast.error(r.reason);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** Group checkboxes. A filter appears once there are enough groups to need one. */
function GroupList({ allGroups, draft, saved, isSelf, onToggle }: {
  allGroups: Group[]; draft: Set<string>; saved: Set<string>; isSelf: boolean; onToggle: (id: string) => void;
}) {
  const { t } = useTranslation("acp");
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const shown = allGroups.filter((g) => !q || g.name.toLowerCase().includes(q));
  return (
    <>
      {allGroups.length > 8 && (
        <label className="up-gfilter">
          <FontAwesomeIcon className="up-gfilter__ic" icon={faMagnifyingGlass} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("users.filterGroups")} />
        </label>
      )}
      <div className="up-groups">
        {shown.map((g) => {
          const on = draft.has(g.id);
          // Your own administrator seat is not yours to give up from here; the server refuses it too.
          const locked = isSelf && g.key === "admin" && saved.has(g.id);
          return (
            <div key={g.id} className={"up-grow" + (on ? " on" : "") + (locked ? " is-locked" : "")} role="checkbox" aria-checked={on}
              aria-disabled={locked} tabIndex={0} title={locked ? t("users.selfAdminLocked") : undefined}
              onClick={() => { if (!locked) onToggle(g.id); }}
              onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !locked) { e.preventDefault(); onToggle(g.id); } }}>
              <div className="up-check">{on ? "✓" : ""}</div>
              <span className="up-gdot" style={{ background: groupColor(g) }} />
              <span className="up-grow__name">{g.name}</span>
              {g.isSystem && <span className="up-protected"><FontAwesomeIcon icon={faLock} /> {t("users.system")}</span>}
            </div>
          );
        })}
        {shown.length === 0 && <span className="up-empty">{allGroups.length ? t("users.noGroupMatch") : t("userDetail.noGroups")}</span>}
      </div>
    </>
  );
}

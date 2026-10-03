import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link } from "react-router-dom";
import type { AwardedBadge, BadgeRow } from "@xentium/contracts";
import { BadgeMark } from "../../../components/UserBadges";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/swal";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faFloppyDisk, faChevronLeft, faBan, faShield, faRightFromBracket, faKey,
  faNewspaper, faComment, faArrowsRotate, faNetworkWired, faMagnifyingGlass,
  faAddressCard, faUserGroup, faTableList, faShieldHalved, faTriangleExclamation,
  faAward, faXmark, faLock,
} from "@fortawesome/free-solid-svg-icons";
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

// ── Copyable mono ID chip ─────────────────────────────────────────────────────

function CodeChip({ value }: { value: string }) {
  const { t } = useTranslation("acp");
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  };
  return (
    <span className="up-code">
      <span>{value}</span>
      <button type="button" className={"up-copy" + (done ? " done" : "")} onClick={copy} title={t("userDetail.copy")}>{done ? "✓" : "⧉"}</button>
    </span>
  );
}

/**
 * The first few addresses or devices, and a way to the rest. A busy account has
 * dozens; listing them all turned the Overview into a column of chips.
 */
function ChipList({ values, onMore }: { values: string[]; onMore: () => void }) {
  const { t } = useTranslation("acp");
  if (values.length === 0) return <span className="up-empty">—</span>;
  const shown = values.slice(0, 4);
  const rest = values.length - shown.length;
  return (
    <>
      {shown.map((v) => <CodeChip key={v} value={v} />)}
      {rest > 0 && (
        <button type="button" className="up-more" onClick={onMore}>
          {values.length >= 20 ? t("users.moreCapped", { count: rest }) : t("users.more", { count: rest })}
        </button>
      )}
    </>
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
  securityEventTotal: number;
  groups: Group[];
  profileFields: ProfileFieldEntry[];
}

type Tab = "overview" | "access" | "badges" | "security";

function formatDate(d: string) {
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** "20+" once a list reaches the server's cap, so a count never under-reports. */
const capped = (n: number) => (n >= 20 ? "20+" : String(n));

// ── Security activity (paginated, 10 per page) ─────────────────────────────────

interface LoginEventsPage {
  data: LoginEvent[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/** "macOS · Chrome" out of a user agent — the table's device column, not a fingerprint. */
function deviceOf(ua: string | null): string {
  if (!ua) return "—";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  return [os, br].filter(Boolean).join(" · ") || ua.slice(0, 40);
}

function SecurityActivity({ userId }: { userId: string }) {
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

  return (
    <section className="up-card">
      <div className="up-card__head">
        <div className="ic"><FontAwesomeIcon icon={faShieldHalved} /></div>
        <h3>{t("userDetail.securityActivity")}</h3>
        <span className="count">{t("userDetail.events", { count: total })}</span>
      </div>

      {isLoading ? (
        <div className="up-card__body"><p className="up-empty">{t("userDetail.loading")}</p></div>
      ) : events.length === 0 ? (
        <div className="up-card__body"><p className="up-empty">{t("userDetail.noEvents")}</p></div>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
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
                    <td><span className="up-mono" style={{ fontSize: "var(--fs-xs)" }}>{ev.ip ?? "—"}</span></td>
                    <td>
                      <span className="up-dev">
                        <span title={ev.userAgent ?? undefined}>{deviceOf(ev.userAgent)}</span>
                        <span className="up-mono up-dev__cookie">{ev.deviceCookieId ? ev.deviceCookieId.slice(0, 13) : "—"}</span>
                      </span>
                    </td>
                    <td className="up-when">{new Date(ev.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
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
      )}
    </section>
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
 */
function UserBadgesCard({ userId, held }: { userId: string; held: AwardedBadge[] }) {
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
    <section className="up-card">
      <div className="up-card__head">
        <div className="ic"><FontAwesomeIcon icon={faAward} /></div>
        <h3>{t("userDetail.badges")}</h3>
        <span className="count">{t("users.held", { count: held.length })}</span>
      </div>
      <div className="up-card__body">
        <div className="up-badges">
          {held.map((b) => (
            <span key={b.id} className={`up-badge${b.source === "earned" ? " up-badge--earned" : ""}`}
              title={b.source === "earned"
                ? t("userDetail.badgeEarnedHint")
                : (b.note ?? b.description ?? b.name)}>
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

        <div className="up-groups__foot">
          <span>{t("userDetail.badgeGrantHint")}</span>
          <select className="inp inp--sm up-grant" value=""
            disabled={grant.isPending || grantable.length === 0}
            onChange={(e) => { if (e.target.value) grant.mutate(e.target.value); }}>
            <option value="">
              {grantable.length ? t("userDetail.badgeGrantPick") : t("userDetail.badgeGrantNone")}
            </option>
            {grantable.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>
    </section>
  );
}

/**
 * Group membership: a draft, saved as what CHANGED.
 *
 * ⚠ Never PUT the draft as the member's new set. The draft was taken when the tab
 * opened; a promotion by the progression sweep or another admin's edit since then
 * would be reverted by a replacement. `PATCH {add, remove}` touches only the rows the
 * admin toggled here.
 */
function MembershipCard({ user, allGroups, isSelf }: { user: UserDetail; allGroups: Group[]; isSelf: boolean }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const saved = useMemo(() => new Set(user.groups.map((g) => g.id)), [user.groups]);
  const [draft, setDraft] = useState<Set<string>>(saved);
  const [filter, setFilter] = useState("");

  // A different member resets the draft; a background refetch of the SAME member does
  // not stomp edits in progress.
  useEffect(() => { setDraft(new Set(user.groups.map((g) => g.id))); }, [user.id]);

  const add = [...draft].filter((id) => !saved.has(id));
  const remove = [...saved].filter((id) => !draft.has(id));
  const dirty = add.length + remove.length > 0;

  const save = useMutation({
    mutationFn: () => api.patch<{ groups: Group[] }>(`/admin/users/${user.id}/groups`, { add, remove }),
    onSuccess: (res) => {
      setDraft(new Set(res.groups.map((g) => g.id)));
      void qc.invalidateQueries({ queryKey: ["acp-user", user.id] });
      void qc.invalidateQueries({ queryKey: ["acp-users"] });
      toast.success(t("userDetail.toastGroups"));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const q = filter.trim().toLowerCase();
  const shown = allGroups.filter((g) => !q || g.name.toLowerCase().includes(q));
  const toggle = (id: string) => setDraft((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <section className="up-card">
      <div className="up-card__head">
        <div className="ic"><FontAwesomeIcon icon={faUserGroup} /></div>
        <h3>{t("users.membership")}</h3>
        <label className="up-gfilter">
          <FontAwesomeIcon className="up-gfilter__ic" icon={faMagnifyingGlass} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("users.filterGroups")} />
        </label>
      </div>
      <div className="up-card__body">
        <div className="up-groups">
          {shown.map((g) => {
            const on = draft.has(g.id);
            // Your own administrator seat is not yours to give up from here; the server refuses it too.
            const locked = isSelf && g.key === "admin" && saved.has(g.id);
            return (
              <div key={g.id} className={"up-grow" + (on ? " on" : "") + (locked ? " is-locked" : "")} role="checkbox" aria-checked={on}
                aria-disabled={locked} title={locked ? t("users.selfAdminLocked") : undefined}
                onClick={() => { if (!locked) toggle(g.id); }}>
                <div className="up-check">{on ? "✓" : ""}</div>
                <span className="up-gdot" style={{ background: groupColor(g) }} />
                <span className="up-grow__name">{g.name}</span>
                {g.isSystem && <span className="up-protected"><FontAwesomeIcon icon={faLock} /> {t("users.system")}</span>}
              </div>
            );
          })}
          {shown.length === 0 && <span className="up-empty">{allGroups.length ? t("users.noGroupMatch") : t("userDetail.noGroups")}</span>}
        </div>
      </div>
      <div className={"up-dirty" + (dirty ? " is-dirty" : "")}>
        <span>{dirty ? t("users.unsavedMembership") : t("users.membershipSaved")}</span>
        <button type="button" className="btn-ghost btn-sm" disabled={!dirty || save.isPending} onClick={() => setDraft(new Set(saved))}>
          {t("users.revert")}
        </button>
        <button type="button" className="up-btn up-btn--primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          <FontAwesomeIcon icon={faFloppyDisk} /> {t("users.saveMembership")}
        </button>
      </div>
    </section>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function UserDetailPage() {
  const { t } = useTranslation("acp");
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isSelf = currentUser?.id === id;

  const [tab, setTab] = useState<Tab>("overview");
  const [banOpen, setBanOpen] = useState(false);
  useEffect(() => { setTab("overview"); }, [id]);

  const { data: user, isLoading } = useQuery<UserDetail>({
    queryKey: ["acp-user", id],
    queryFn: () => api.get(`/admin/users/${id}`),
    enabled: !!id,
  });
  const { data: allGroups = [] } = useQuery<Group[]>({
    queryKey: ["acp-groups-list"],
    queryFn: () => api.get<Group[]>("/admin/groups"),
  });
  // Held badges are fetched here, not in the tab, so the tab strip can count them.
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
  async function handleResetPassword() {
    if (await confirm(t("userDetail.resetTitle"), t("userDetail.resetText", { email: user?.email }), t("userDetail.sendEmail"))) {
      resetPasswordMutation.mutate();
    }
  }

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
  // Administrator accounts cannot be managed via the ACP (no force-logout,
  // no password reset) — mirrors the backend guard.
  const isAdminTarget = user.groups.some((g) => g.key === "admin");
  const protectedTarget = isSelf || isAdminTarget;
  const protectedReason = isSelf ? t("userDetail.protectedSelf") : t("userDetail.protectedAdmin");
  const top = topGroup(user.groups);

  const stats = [
    { icon: faNewspaper,    cls: "",   value: user._count.articles,        label: t("userDetail.statArticles") },
    { icon: faComment,      cls: "co", value: user._count.articleComments, label: t("userDetail.statComments") },
    { icon: faArrowsRotate, cls: "gr", value: user.activeSessions,         label: t("users.activeSessions") },
    { icon: faNetworkWired, cls: "am", value: capped(user.knownIps.length), label: t("userDetail.statIps") },
  ];
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "overview", label: t("users.tab.overview"), count: 0 },
    { id: "access",   label: t("users.tab.access"),   count: user.groups.length },
    { id: "badges",   label: t("users.tab.badges"),   count: held.length },
    { id: "security", label: t("users.tab.security"), count: user.securityEventTotal },
  ];
  const flagText = user.flags.map((f) => t(`users.flag.${f}`, { count: user.failedSignins24h })).join(" · ");

  return (
    <div className="acp-up">
      <div className="acp-up__crumb">
        <Link to="/admin/users"><FontAwesomeIcon icon={faChevronLeft} /> {t("users.allUsers")}</Link>
        <span className="sep">/</span>
        <span className="cur">{user.username}</span>
      </div>

      {/* Identity, actions and the tab strip — one card. */}
      <div className="up-hero">
        <div className="up-hero__body">
          <Avatar user={{ username: user.username, avatar: user.avatar }} size={72} online={user.online} />
          <div className="up-hero__id">
            <div className="up-hero__namerow">
              <Username className="up-hero__name" username={user.username} badgeColor={top?.progression?.badgeColor} />
              <RolePill group={top} fallback={t("userDetail.roleMember")} />
              {user.status === "inactive" || isBanned
                ? <StatusPill status={user.status} long bannedUntil={user.bannedUntil} />
                : <StatusPill status="active" />}
            </div>
            <div className="up-hero__handle">
              <span className="up-mono up-hero__idchip">{user.id.slice(0, 18)}…</span>
              <span>{user.email}</span>
              <span>{t("userDetail.joined", { date: formatDate(user.createdAt) })}</span>
              <span>{t("users.lastSeen", { when: lastSeenText(user, t) })}</span>
            </div>
          </div>
          <div className="up-hero__actions">
            <button type="button" className="up-btn up-btn--ghost" onClick={handleResetPassword}
              disabled={resetPasswordMutation.isPending || protectedTarget}
              title={protectedTarget ? protectedReason : t("userDetail.resetHint")}>
              <FontAwesomeIcon icon={faKey} /> {t("userDetail.resetPassword")}
            </button>
            <button type="button" className="up-btn up-btn--ghost" onClick={handleForceLogout}
              disabled={forceLogoutMutation.isPending || protectedTarget}
              title={protectedTarget ? protectedReason : t("userDetail.logoutHint")}>
              <FontAwesomeIcon icon={faRightFromBracket} /> {t("userDetail.logout")}
            </button>
            {isBanned ? (
              <button type="button" className="up-btn up-btn--lift" onClick={handleLiftBan} disabled={liftBanMutation.isPending}>
                <FontAwesomeIcon icon={faShield} /> {t("userDetail.liftBan")}
              </button>
            ) : (
              <button type="button" className="up-btn up-btn--warn" onClick={() => setBanOpen(true)}
                disabled={protectedTarget} title={protectedTarget ? protectedReason : undefined}>
                <FontAwesomeIcon icon={faBan} /> {t("userDetail.ban")}
              </button>
            )}
            <button type="button" className={user.isActive ? "up-btn up-btn--danger" : "up-btn up-btn--primary"}
              onClick={handleDeactivate} disabled={activeMutation.isPending || isSelf}
              title={isSelf ? t("userDetail.cannotDeactivateSelf") : undefined}>
              {user.isActive ? t("userDetail.deactivate") : t("userDetail.activate")}
            </button>
          </div>
        </div>

        {user.flags.length > 0 && (
          <div className="up-risk">
            <div className="up-risk__ic"><FontAwesomeIcon icon={faTriangleExclamation} /></div>
            <div className="up-risk__text">
              <b>{flagText}</b>{" "}
              <span>{t("users.riskBody", { ips: capped(user.knownIps.length), devices: capped(user.deviceCookies.length), failed: user.failedSignins24h })}</span>
            </div>
            <button type="button" className="up-risk__btn" onClick={() => setTab("security")}>{t("users.review")}</button>
          </div>
        )}

        {isBanned && user.activeBan && (
          <div className="up-banline">
            <FontAwesomeIcon icon={faBan} />
            <span><b>{t("users.banReason")}</b> {user.activeBan.reason}</span>
          </div>
        )}

        <nav className="up-tabs" role="tablist">
          {tabs.map((tb) => (
            <button key={tb.id} type="button" role="tab" aria-selected={tab === tb.id}
              className={tab === tb.id ? "is-on" : ""} onClick={() => setTab(tb.id)}>
              {tb.label}
              {tb.count > 0 && <span className="up-tabs__n">{tb.count}</span>}
            </button>
          ))}
        </nav>
      </div>

      {isSelf && (
        <div className="up-banner">
          <div className="ic"><FontAwesomeIcon icon={faTriangleExclamation} /></div>
          <div><b>{t("userDetail.selfTitle")}</b> <span>{t("userDetail.selfDesc")}</span></div>
        </div>
      )}

      {tab === "overview" && (
        <>
          <div className="up-strip">
            {stats.map((s) => (
              <div key={s.label} className="up-stat">
                <div className={"up-stat__ic " + s.cls}><FontAwesomeIcon icon={s.icon} /></div>
                <div><b>{s.value}</b><span>{s.label}</span></div>
              </div>
            ))}
          </div>

          <div className="up-cols">
            <section className="up-card">
              <div className="up-card__head">
                <div className="ic"><FontAwesomeIcon icon={faAddressCard} /></div>
                <h3>{t("userDetail.accountInfo")}</h3>
              </div>
              <div className="up-card__body">
                <div className="up-kv">
                  <div className="up-kv__row"><span className="up-kv__k">{t("userDetail.kUserId")}</span><span className="up-kv__v"><CodeChip value={user.id} /></span></div>
                  <div className="up-kv__row">
                    <span className="up-kv__k">{t("userDetail.kEmail")}</span>
                    <span className="up-kv__v">
                      {user.email}
                      {!user.emailVerifiedAt && <span className="up-unverified">{t("users.unverified")}</span>}
                    </span>
                  </div>
                  <div className="up-kv__row"><span className="up-kv__k">{t("userDetail.kJoined")}</span><span className="up-kv__v">{formatDate(user.createdAt)}</span></div>
                  <div className="up-kv__row">
                    <span className="up-kv__k">{t("userDetail.kIps")}</span>
                    <span className="up-kv__v">
                      <ChipList values={user.knownIps} onMore={() => setTab("security")} />
                    </span>
                  </div>
                  <div className="up-kv__row">
                    <span className="up-kv__k">{t("userDetail.kCookies")}</span>
                    <span className="up-kv__v">
                      <ChipList values={user.deviceCookies} onMore={() => setTab("security")} />
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="up-card">
              <div className="up-card__head"><div className="ic"><FontAwesomeIcon icon={faTableList} /></div><h3>{t("userDetail.profileFields")}</h3></div>
              <div className="up-card__body">
                <div className="up-kv">
                  {user.profileFields.map(({ field, value }) => (
                    <div key={field.id} className="up-kv__row">
                      <span className="up-kv__k">{field.label}</span>
                      <span className="up-kv__v">{value ? value : <span className="up-empty">{t("userDetail.notSet")}</span>}</span>
                    </div>
                  ))}
                  {user.profileFields.length === 0 && <p className="up-empty">{t("users.noProfileFields")}</p>}
                </div>
              </div>
            </section>
          </div>
        </>
      )}

      {tab === "access" && <MembershipCard user={user} allGroups={allGroups} isSelf={isSelf} />}

      {/* Granting lives HERE, beside the member it concerns, rather than on the Badges
          page. That page is the CATALOGUE: what the site can award. Who holds what is
          a fact about a person, and an admin looking at a person is where they want to
          change it. */}
      {tab === "badges" && <UserBadgesCard userId={user.id} held={held} />}

      {tab === "security" && (
        <>
          <div className="up-sec">
            <div className="up-sec__tile">
              <span>{t("users.sec.signins")}</span>
              <b className={user.failedSignins24h > 0 ? "is-bad" : ""}>
                {user.failedSignins24h > 0 ? t("users.sec.failed", { count: user.failedSignins24h }) : t("users.sec.clean")}
              </b>
              <em>{user.failedSignins24h > 0 ? t("users.sec.failedNote") : t("users.sec.cleanNote")}</em>
            </div>
            <div className="up-sec__tile">
              <span>{t("userDetail.statIps")}</span>
              <b>{capped(user.knownIps.length)}</b>
              <em>{user.knownIps.length > 2 ? t("users.sec.spread") : t("users.sec.stable")}</em>
            </div>
            <div className="up-sec__tile">
              <span>{t("users.sec.devices")}</span>
              <b>{capped(user.deviceCookies.length)}</b>
              <em>{user.deviceCookies.length > 1 ? t("users.sec.multiDevice") : t("users.sec.oneDevice")}</em>
            </div>
            <div className="up-sec__tile">
              <span>{t("users.activeSessions")}</span>
              <b>{user.activeSessions}</b>
              <em>{t("users.sec.revocable")} · {user.lastSeenAt ? timeAgo(user.lastSeenAt) : t("users.seenNever")}</em>
            </div>
          </div>
          <SecurityActivity userId={user.id} />
          {/* PLUGIN PANELS — e.g. advanced-moderation "Suspicious Multiaccounts". */}
          {slotRegistry.getUserDetailPanels().map((p) => (
            <p.component key={p.id} userId={user.id} username={user.username} />
          ))}
        </>
      )}

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

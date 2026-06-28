import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { useAuth } from "../../../hooks/useAuth";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSave, faChevronLeft, faBan, faShield, faRightFromBracket, faKey,
  faNewspaper, faComment, faArrowsRotate, faNetworkWired,
  faAddressCard, faUserGroup, faTableList, faShieldHalved, faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { Username } from "../../../components/Username";
import { UserAvatar } from "../../../components/UserAvatar";
import { slotRegistry } from "../../../plugins/slotRegistry";
import "./UserDetailPage.scss";

// ── Copyable mono ID chip ─────────────────────────────────────────────────────

function CodeChip({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  };
  return (
    <span className="up-code">
      <span>{value}</span>
      <button type="button" className={"up-copy" + (done ? " done" : "")} onClick={copy} title="Copy">{done ? "✓" : "⧉"}</button>
    </span>
  );
}

interface Group {
  id: string;
  name: string;
  key: string;
  isSystem: boolean;
  icon: string | null;
  progression: { badgeColor: string | null; badgeLabel: string | null } | null;
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
  articleCount: number;
  _count: { articles: number; articleComments: number; sessions: number };
  groups: Group[];
  profileFields: ProfileFieldEntry[];
  loginEvents: LoginEvent[];
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
}

// ── Ban modal ────────────────────────────────────────────────────────────────

function BanModal({
  user,
  onClose,
  onDone,
}: {
  user: UserDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const [type,      setType]      = useState<"temporary" | "permanent">("temporary");
  const [reason,    setReason]    = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const banMutation = useMutation({
    mutationFn: () => api.post(`/admin/users/${user.id}/ban`, {
      type,
      reason,
      expiresAt: type === "temporary" && expiresAt ? new Date(expiresAt).toISOString() : null,
    }),
    onSuccess: () => {
      swalToast(`${user.username} has been banned.`, "success");
      onDone();
      onClose();
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div className="acp-modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <FontAwesomeIcon icon={faBan} style={{ color: "var(--c-danger)", fontSize: 18 }} />
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Ban @{user.username}</h2>
        </div>

        <div className="acp-form-field">
          <label className="acp-label">Ban type</label>
          <select
            className="acp-select"
            value={type}
            onChange={(e) => setType(e.target.value as "temporary" | "permanent")}
          >
            <option value="temporary">Temporary</option>
            <option value="permanent">Permanent</option>
          </select>
        </div>

        {type === "temporary" && (
          <div className="acp-form-field">
            <label className="acp-label">Expires at</label>
            <input
              type="datetime-local"
              className="acp-input"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
          </div>
        )}

        <div className="acp-form-field">
          <label className="acp-label">Reason <span style={{ color: "var(--c-danger)" }}>*</span></label>
          <textarea
            className="acp-input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for this ban…"
            style={{ resize: "vertical" }}
          />
        </div>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1rem" }}>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-danger btn-sm"
            disabled={!reason.trim() || (type === "temporary" && !expiresAt) || banMutation.isPending}
            onClick={() => banMutation.mutate()}
          >
            <FontAwesomeIcon icon={faBan} style={{ marginRight: 5 }} />
            {banMutation.isPending ? "Banning…" : "Issue Ban"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Security activity (paginated, 10 per page) ─────────────────────────────────

interface LoginEventsPage {
  data: LoginEvent[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

function SecurityActivity({ userId }: { userId: string }) {
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
        <h3>Security Activity</h3>
        <span className="count">{total} {total === 1 ? "event" : "events"}</span>
      </div>

      {isLoading ? (
        <div className="up-card__body"><p className="up-empty">Loading…</p></div>
      ) : events.length === 0 ? (
        <div className="up-card__body"><p className="up-empty">No login events on record.</p></div>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table className="up-table">
              <thead><tr><th>Type</th><th>Result</th><th>IP Address</th><th>Device Cookie</th><th>User Agent</th><th>When</th></tr></thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td><span className="up-type"><span className="d" />{ev.eventType}</span></td>
                    <td><span className={"up-result" + (ev.success ? "" : " fail")}><i />{ev.success ? "success" : "failed"}</span></td>
                    <td><span className="up-mono" style={{ fontSize: 12 }}>{ev.ip ?? "—"}</span></td>
                    <td><span className="up-mono" style={{ fontSize: 11.5, color: "var(--c-fg-muted)" }}>{ev.deviceCookieId ?? "—"}</span></td>
                    <td><span className="up-ua">{ev.userAgent ?? "—"}</span></td>
                    <td className="up-when">{new Date(ev.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="up-table__foot">
            <span>Showing {from}–{to} of {total}</span>
            <div className="up-pager">
              <button type="button" className="up-pglink" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Prev</button>
              <span className="up-pager__cur">Page {page} of {pages}</span>
              <button type="button" className="up-pglink" disabled={page >= pages || isFetching} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isSelf = currentUser?.id === id;

  const [showBanModal, setShowBanModal] = useState(false);

  const { data: user, isLoading } = useQuery<UserDetail>({
    queryKey: ["acp-user", id],
    queryFn: () => api.get(`/admin/users/${id}`),
    enabled: !!id,
  });

  const { data: allGroups = [] } = useQuery<Group[]>({
    queryKey: ["acp-groups-list"],
    queryFn: () => api.get<Group[]>("/admin/groups"),
  });

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  // Initialize once when user data first arrives, then let the admin freely edit.
  // Keyed to user.id so navigating to a different user resets the form, but a
  // background refetch on the SAME user does not stomp over in-flight edits.
  useEffect(() => {
    if (user) setSelectedGroupIds(user.groups.map((g) => g.id));
  }, [user?.id]);

  const groupsMutation = useMutation({
    mutationFn: (groupIds: string[]) =>
      api.put(`/admin/users/${id}/groups`, { groupIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acp-user", id] });
      swalToast("Groups updated!", "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const activeMutation = useMutation({
    mutationFn: (isActive: boolean) =>
      api.patch(`/admin/users/${id}/active`, { isActive }),
    onSuccess: (_, isActive) => {
      queryClient.invalidateQueries({ queryKey: ["acp-user", id] });
      queryClient.invalidateQueries({ queryKey: ["acp-users"] });
      swalToast(isActive ? "User activated!" : "User deactivated!", "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const liftBanMutation = useMutation({
    mutationFn: () => api.delete(`/admin/users/${id}/ban`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acp-user", id] });
      swalToast("Ban lifted!", "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const forceLogoutMutation = useMutation({
    mutationFn: () => api.post<{ revokedSessions: number }>(`/admin/users/${id}/force-logout`, {}),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["acp-user", id] });
      swalToast(`Logged out — revoked ${res.revokedSessions} session(s).`, "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/password-reset`, {}),
    onSuccess: () => swalToast(`Password reset email sent to ${user?.email}.`, "success"),
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((gid) => gid !== groupId) : [...prev, groupId],
    );
  }

  async function handleDeactivate() {
    if (!user) return;
    const willActivate = !user.isActive;
    const result = await swalConfirm(
      willActivate ? "Activate user?" : "Deactivate user?",
      willActivate
        ? `${user.username} will be able to log in again.`
        : `${user.username} will be unable to log in.`,
      willActivate ? "Activate" : "Deactivate",
      "Cancel",
    );
    if (result) activeMutation.mutate(willActivate);
  }

  async function handleLiftBan() {
    const result = await swalConfirm(
      "Lift ban?",
      `${user?.username}'s active ban will be removed and they will be able to log in.`,
      "Lift Ban",
      "Cancel",
    );
    if (result) liftBanMutation.mutate();
  }

  async function handleForceLogout() {
    const result = await swalConfirm(
      "Log user out?",
      `All of ${user?.username}'s active sessions will be revoked. They will need to sign in again on every device.`,
      "Log Out",
      "Cancel",
    );
    if (result) forceLogoutMutation.mutate();
  }

  async function handleResetPassword() {
    const result = await swalConfirm(
      "Send password reset?",
      `A password reset email will be sent to ${user?.email}. The link expires in 15 minutes.`,
      "Send Email",
      "Cancel",
    );
    if (result) resetPasswordMutation.mutate();
  }

  if (isLoading || !user) {
    return <div style={{ padding: "2rem", color: "var(--c-fg-muted)" }}>Loading…</div>;
  }

  const isBanned = !!user.bannedUntil;
  // Administrator accounts cannot be managed via the ACP (no force-logout,
  // no password reset) — mirrors the backend guard.
  const isAdminTarget = user.groups.some((g) => g.key === "admin");
  const protectedTarget = isSelf || isAdminTarget;
  const protectedReason = isSelf
    ? "You cannot perform this action on your own account"
    : "Administrator accounts cannot be managed via the admin panel";

  const topGroup    = user.groups[0];
  const roleColor   = topGroup?.progression?.badgeColor ?? "var(--c-accent)";
  const roleLabel   = topGroup?.progression?.badgeLabel ?? topGroup?.name ?? "Member";
  const roleSoft    = `color-mix(in srgb, ${roleColor} 14%, transparent)`;

  const events  = user.loginEvents ?? [];
  const ips     = [...new Set(events.map((e) => e.ip).filter(Boolean))] as string[];
  const cookies = [...new Set(events.map((e) => e.deviceCookieId).filter(Boolean))] as string[];

  const stats = [
    { icon: faNewspaper,    cls: "",   value: user._count.articles,        label: "Articles" },
    { icon: faComment,      cls: "co", value: user._count.articleComments, label: "Comments" },
    { icon: faArrowsRotate, cls: "gr", value: user._count.sessions,        label: "Sessions" },
    { icon: faNetworkWired, cls: "am", value: ips.length,                  label: "Known IPs" },
  ];

  return (
    <div className="acp-up">
      <div className="acp-up__crumb">
        <Link to="/admin/users"><FontAwesomeIcon icon={faChevronLeft} /> Users</Link>
        <span className="sep">/</span>
        <span className="cur">{user.username}</span>
      </div>

      {/* HERO */}
      <div className="up-hero">
        <div className="up-hero__body">
          <div className="up-ava-ring">
            <UserAvatar user={{ username: user.username, avatar: user.avatar }} size={92} />
          </div>
          <div className="up-hero__id">
            <div className="up-hero__namerow">
              <span className="up-hero__name">
                <Username username={user.username} badgeColor={topGroup?.progression?.badgeColor} />
              </span>
              <span className="up-role" style={{ color: roleColor, background: roleSoft }}>
                <i style={{ background: roleColor }} />{roleLabel}
              </span>
              {isBanned ? (
                <span className="up-status is-banned"><i />
                  Banned
                  {user.bannedUntil && new Date(user.bannedUntil).getFullYear() < 9999
                    ? ` until ${formatDate(user.bannedUntil)}`
                    : " (permanent)"}
                </span>
              ) : (
                <span className={"up-status" + (user.isActive ? "" : " is-inactive")}><i />{user.isActive ? "Active" : "Inactive"}</span>
              )}
            </div>
            <div className="up-hero__handle">
              <span className="up-mono" style={{ fontSize: 12.5 }}>{user.id.slice(0, 18)}…</span>
              <span className="sep" />
              <span>{user.email}</span>
              <span className="sep" />
              <span>Joined {formatDate(user.createdAt)}</span>
            </div>
          </div>
          <div className="up-hero__actions">
            <button type="button" className="up-btn up-btn--ghost"
              onClick={handleResetPassword}
              disabled={resetPasswordMutation.isPending || protectedTarget}
              title={protectedTarget ? protectedReason : "Email this user a password reset link"}>
              <FontAwesomeIcon icon={faKey} /> Reset Password
            </button>
            <button type="button" className="up-btn up-btn--ghost"
              onClick={handleForceLogout}
              disabled={forceLogoutMutation.isPending || protectedTarget}
              title={protectedTarget ? protectedReason : "Revoke all of this user's sessions"}>
              <FontAwesomeIcon icon={faRightFromBracket} /> Log Out
            </button>
            {isBanned ? (
              <button type="button" className="up-btn up-btn--ghost"
                onClick={handleLiftBan} disabled={liftBanMutation.isPending}>
                <FontAwesomeIcon icon={faShield} /> Lift Ban
              </button>
            ) : (
              <button type="button" className="up-btn up-btn--warn"
                onClick={() => setShowBanModal(true)}
                disabled={isSelf}
                title={isSelf ? "You cannot ban yourself" : undefined}>
                <FontAwesomeIcon icon={faBan} /> Ban
              </button>
            )}
            <button type="button" className={user.isActive ? "up-btn up-btn--danger" : "up-btn up-btn--primary"}
              onClick={handleDeactivate}
              disabled={activeMutation.isPending || isSelf}
              title={isSelf ? "You cannot deactivate your own account" : undefined}>
              {user.isActive ? "Deactivate" : "Activate"}
            </button>
          </div>
        </div>
      </div>

      {/* SELF BANNER */}
      {isSelf && (
        <div className="up-banner">
          <div className="ic"><FontAwesomeIcon icon={faTriangleExclamation} /></div>
          <div><b>You're viewing your own account.</b> <span>Deactivation and banning are disabled to prevent lockout.</span></div>
        </div>
      )}

      {/* STAT STRIP */}
      <div className="up-strip">
        {stats.map((s) => (
          <div key={s.label} className="up-stat">
            <div className={"up-stat__ic " + s.cls}><FontAwesomeIcon icon={s.icon} /></div>
            <div><b>{s.value}</b><span>{s.label}</span></div>
          </div>
        ))}
      </div>

      {/* ACCOUNT + GROUPS */}
      <div className="up-cols">
        <section className="up-card">
          <div className="up-card__head">
            <div className="ic"><FontAwesomeIcon icon={faAddressCard} /></div>
            <h3>Account Info</h3>
          </div>
          <div className="up-card__body">
            <div className="up-kv">
              <div className="up-kv__row"><span className="up-kv__k">User ID</span><span className="up-kv__v"><CodeChip value={user.id} /></span></div>
              <div className="up-kv__row"><span className="up-kv__k">Email</span><span className="up-kv__v">{user.email}</span></div>
              <div className="up-kv__row">
                <span className="up-kv__k">Status</span>
                <span className="up-kv__v">
                  {isBanned ? <span className="up-status is-banned"><i />Banned</span>
                            : <span className={"up-status" + (user.isActive ? "" : " is-inactive")}><i />{user.isActive ? "Active" : "Inactive"}</span>}
                </span>
              </div>
              <div className="up-kv__row"><span className="up-kv__k">Joined</span><span className="up-kv__v">{formatDate(user.createdAt)}</span></div>
              <div className="up-kv__row">
                <span className="up-kv__k">Known IPs</span>
                <span className="up-kv__v">
                  {ips.length === 0 ? <span className="up-empty">—</span> : ips.map((ip) => <CodeChip key={ip} value={ip} />)}
                </span>
              </div>
              <div className="up-kv__row">
                <span className="up-kv__k">Device Cookies</span>
                <span className="up-kv__v">
                  {cookies.length === 0 ? <span className="up-empty">—</span> : cookies.map((c) => <CodeChip key={c} value={c} />)}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="up-card">
          <div className="up-card__head">
            <div className="ic"><FontAwesomeIcon icon={faUserGroup} /></div>
            <h3>Groups</h3>
            <span className="count">{selectedGroupIds.length} of {(allGroups as Group[]).length}</span>
          </div>
          <div className="up-card__body">
            <div className="up-groups">
              {(allGroups as Group[]).map((g) => {
                const color   = g.progression?.badgeColor ?? "var(--c-accent)";
                const checked = selectedGroupIds.includes(g.id);
                return (
                  <div key={g.id} className={"up-grow" + (checked ? " on" : "")} role="checkbox" aria-checked={checked} onClick={() => toggleGroup(g.id)}>
                    <div className="up-check">{checked ? "✓" : ""}</div>
                    <span className="up-gdot" style={{ background: color }} />
                    <span className="up-grow__name">{g.name}</span>
                    {g.isSystem && <span className="up-protected">🔒 Protected</span>}
                  </div>
                );
              })}
              {(allGroups as Group[]).length === 0 && <span className="up-empty">No groups found</span>}
            </div>
            <div className="up-groups__foot">
              <span>Changes apply on save</span>
              <button type="button" className="up-btn up-btn--primary" onClick={() => groupsMutation.mutate(selectedGroupIds)} disabled={groupsMutation.isPending}>
                <FontAwesomeIcon icon={faSave} /> Save Groups
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* PROFILE FIELDS */}
      {user.profileFields.length > 0 && (
        <section className="up-card">
          <div className="up-card__head"><div className="ic"><FontAwesomeIcon icon={faTableList} /></div><h3>Profile Fields</h3></div>
          <table className="up-table">
            <thead><tr><th style={{ width: "30%" }}>Field</th><th>Value</th></tr></thead>
            <tbody>
              {user.profileFields.map(({ field, value }) => (
                <tr key={field.id}>
                  <td className="up-field-k">{field.label}</td>
                  <td>{value ? value : <span className="up-empty">— not set</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ height: 14 }} />
        </section>
      )}

      {/* SECURITY ACTIVITY */}
      <SecurityActivity userId={user.id} />

      {/* PLUGIN PANELS — e.g. advanced-moderation "Suspicious Multiaccounts". */}
      {slotRegistry.getUserDetailPanels().map((p) => (
        <p.component key={p.id} userId={user.id} username={user.username} />
      ))}

      {showBanModal && (
        <BanModal
          user={user}
          onClose={() => setShowBanModal(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ["acp-user", id] })}
        />
      )}
    </div>
  );
}

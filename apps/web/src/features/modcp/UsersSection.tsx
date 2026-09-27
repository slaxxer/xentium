import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../components/Icon";
import {
  faTriangleExclamation, faBan, faNetworkWired, faFingerprint,
  faDesktop, faMagnifyingGlass, faRightFromBracket, faCircleCheck, faCircleXmark,
  faUnlock, faCheck,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/time";
import { useAuth } from "../../hooks/useAuth";
import { swalToast, apiErrorMessage, swalConfirm } from "../../lib/swal";
import { Username } from "../../components/Username";
import { UserAvatar } from "../../components/UserAvatar";
import { UserSearch } from "./UserSearch";
import { slotRegistry } from "../../plugins/slotRegistry";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Issuer  { id: string; username: string; badgeColor: string | null }
interface Warning { id: string; reason: string; status: string; expiresAt: string | null; createdAt: string; issuedBy: Issuer }
interface Ban     { id: string; type: string; reason: string; status: string; expiresAt: string | null; createdAt: string; issuedBy: Issuer }
interface ModUserProfile {
  user: {
    id: string; username: string; displayName: string | null; avatar: string | null;
    bio: string | null; isActive: boolean; bannedUntil: string | null;
    emailVerifiedAt: string | null; createdAt: string;
    groups: { name: string; key: string; displayOrder: number; badgeColor: string | null; badgeLabel: string | null }[];
    counters: {
      postCount: number; threadCount: number; articleCount: number;
      likeCountReceived: number; followerCount: number; followingCount: number;
    };
  };
  activeBan: { id: string; type: string; expiresAt: string | null } | null;
  network:  {
    ips:     { ip: string; count: number; lastSeen: string | null }[];
    cookies: { deviceCookieId: string; count: number; lastSeen: string | null }[];
  };
  sessions: { id: string; ip: string | null; userAgent: string | null; deviceCookieId: string | null; lastUsedAt: string; createdAt: string; expiresAt: string }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Tag({ children, crit }: { children: React.ReactNode; crit?: boolean }) {
  return <span className={`mc-tag${crit ? " mc-tag--crit" : ""}`}>{children}</span>;
}

// ── Inline warn / ban forms ─────────────────────────────────────────────────────

function ActionBar({ userId, username, banned, onDone }: { userId: string; username: string; banned: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<null | "warn" | "ban">(null);
  const [reason, setReason] = useState("");
  const [hasExp, setHasExp] = useState(false);
  const [expiry, setExpiry] = useState("");
  const [banType, setBanType] = useState<"temporary" | "permanent">("temporary");

  const reset = () => { setMode(null); setReason(""); setHasExp(false); setExpiry(""); setBanType("temporary"); };

  const warnMut = useMutation({
    mutationFn: () => api.post("/moderation/warnings", { userId, reason, expiresAt: hasExp && expiry ? new Date(expiry).toISOString() : null }),
    onSuccess: () => { reset(); onDone(); swalToast("Warning issued.", "success"); },
    onError:   (e) => swalToast(apiErrorMessage(e)),
  });

  const banMut = useMutation({
    mutationFn: () => api.post("/moderation/bans", { userId, type: banType, reason, expiresAt: banType === "temporary" && expiry ? new Date(expiry).toISOString() : null }),
    onSuccess: () => { reset(); onDone(); swalToast("Ban issued.", "success"); },
    onError:   (e) => swalToast(apiErrorMessage(e)),
  });

  const minDate = new Date(Date.now() + 3600000).toISOString().slice(0, 16);

  // A ban form opens at the default length set in ACP → Mod Settings.
  const { data: policy } = useQuery<{ defaultDays: number }>({
    queryKey: ["ban-policy"],
    queryFn: () => api.get("/moderation/ban-policy"),
    staleTime: 60_000,
    enabled: mode === "ban",
  });
  useEffect(() => {
    if (mode !== "ban" || !policy) return;
    setExpiry((cur) => {
      if (cur) return cur;
      const d = new Date(Date.now() + policy.defaultDays * 86_400_000);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    });
  }, [mode, policy]);

  return (
    <div className="mc-uprofile__actions">
      {!mode && (
        <div className="mc-row__act" style={{ flexWrap: "wrap" }}>
          <button type="button" className="mc-btn mc-btn--warn mc-btn--sm" onClick={() => setMode("warn")}>
            <FontAwesomeIcon icon={faTriangleExclamation} /> Warn
          </button>
          {!banned && (
            <button type="button" className="mc-btn mc-btn--danger mc-btn--sm" onClick={() => setMode("ban")}>
              <FontAwesomeIcon icon={faBan} /> Ban
            </button>
          )}
        </div>
      )}

      {mode === "warn" && (
        <div className="mc-form">
          <div className="mc-form__title">Warn {username}</div>
          <textarea className="mc-inp" rows={2} placeholder="Reason…" value={reason} onChange={(e) => setReason(e.target.value)} />
          <label className="mc-form__opt">
            <input type="checkbox" checked={hasExp} onChange={(e) => setHasExp(e.target.checked)} /> Set expiry
          </label>
          {hasExp && <input className="mc-inp" type="datetime-local" min={minDate} value={expiry} onChange={(e) => setExpiry(e.target.value)} />}
          <div className="mc-form__row">
            <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" disabled={reason.trim().length < 3 || warnMut.isPending} onClick={() => warnMut.mutate()}>
              {warnMut.isPending ? "Issuing…" : "Issue warning"}
            </button>
            <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {mode === "ban" && (
        <div className="mc-form mc-form--danger">
          <div className="mc-form__title">Ban {username}</div>
          <div className="mc-form__opts">
            {(["temporary", "permanent"] as const).map((t) => (
              <label key={t} className="mc-form__opt">
                <input type="radio" name="mc-up-ban-type" value={t} checked={banType === t} onChange={() => setBanType(t)} />
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </label>
            ))}
          </div>
          {banType === "temporary" && <input className="mc-inp" type="datetime-local" min={minDate} value={expiry} onChange={(e) => setExpiry(e.target.value)} />}
          <textarea className="mc-inp" rows={2} placeholder="Reason…" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="mc-form__row">
            <button type="button" className="mc-btn mc-btn--danger mc-btn--sm"
              disabled={reason.trim().length < 3 || (banType === "temporary" && !expiry) || banMut.isPending}
              onClick={() => banMut.mutate()}>
              {banMut.isPending ? "Banning…" : "Issue ban"}
            </button>
            <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={reset}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────────

export function UsersSection({ contextUsername }: { contextUsername: string }) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [userId, setUserId] = useState("");

  // Auto-load the user whose profile page the canvas was opened on.
  const ctxResolve = useQuery<{ data: { id: string; username: string }[] }>({
    queryKey: ["mc-ctx-user", contextUsername],
    queryFn:  () => api.get(`/moderation/users?search=${encodeURIComponent(contextUsername)}&limit=5`),
    enabled:  !!contextUsername && !userId,
  });
  useEffect(() => {
    if (userId || !contextUsername) return;
    const match = ctxResolve.data?.data.find((u) => u.username.toLowerCase() === contextUsername.toLowerCase());
    if (match) setUserId(match.id);
  }, [ctxResolve.data, contextUsername, userId]);

  const { data, isLoading, isError } = useQuery<ModUserProfile>({
    queryKey: ["mc-user-profile", userId],
    queryFn:  () => api.get(`/moderation/users/${userId}/profile`),
    enabled:  !!userId,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["mc-user-profile", userId] });
    qc.invalidateQueries({ queryKey: ["mc-user-warnings", userId] });
    qc.invalidateQueries({ queryKey: ["mc-user-bans", userId] });
    qc.invalidateQueries({ queryKey: ["mod-summary"] });
    qc.invalidateQueries({ queryKey: ["canvas-warnings"] });
    qc.invalidateQueries({ queryKey: ["canvas-bans"] });
  };

  return (
    <div className="mc-pane">
      <div className="mc-sechead">
        <div>
          <h3>User lookup</h3>
          <span>Search a user to review and moderate</span>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <UserSearch value={userId} onChange={(id) => setUserId(id)} />
      </div>

      {!userId ? (
        <div className="mc-empty">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="mc-empty__ic" />
          <span>Search for a user to see their moderation profile.</span>
        </div>
      ) : isLoading ? (
        <div className="mc-empty">Loading…</div>
      ) : isError || !data ? (
        <div className="mc-empty">Could not load this user.</div>
      ) : (
        <UserProfileView profile={data} me={me} onChanged={refresh} />
      )}
    </div>
  );
}

// ── Warnings / Bans tabs (each loads its own request on demand) ──────────────────

function UserModTabs({ userId, username, canLogout, onChanged, network, sessions }: {
  userId: string; username: string; canLogout: boolean; onChanged: () => void;
  network: ModUserProfile["network"]; sessions: ModUserProfile["sessions"];
}) {
  const [tab, setTab] = useState<"warnings" | "bans" | "ips" | "cookies" | "sessions">("warnings");

  const warningsQ = useQuery<Warning[]>({
    queryKey: ["mc-user-warnings", userId],
    queryFn:  () => api.get(`/moderation/users/${userId}/warnings`),
    enabled:  tab === "warnings",
  });
  const bansQ = useQuery<Ban[]>({
    queryKey: ["mc-user-bans", userId],
    queryFn:  () => api.get(`/moderation/users/${userId}/bans`),
    enabled:  tab === "bans",
  });

  const pardonMut = useMutation({
    mutationFn: (id: string) => api.patch(`/moderation/warnings/${id}/pardon`, {}),
    onSuccess:  () => { onChanged(); swalToast("Warning pardoned.", "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });
  const liftMut = useMutation({
    mutationFn: (id: string) => api.patch(`/moderation/bans/${id}/lift`, {}),
    onSuccess:  () => { onChanged(); swalToast("Ban lifted.", "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });
  const revokeMut = useMutation({
    mutationFn: () => api.post<{ revoked: number }>(`/moderation/users/${userId}/sessions/revoke-all`, {}),
    onSuccess:  (r) => { onChanged(); swalToast(`Logged out ${r.revoked} session(s).`, "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  const handleLift = async (id: string) => {
    const ok = await swalConfirm(`Lift ban on ${username}?`, "This restores their access immediately.", "Lift ban");
    if (ok) liftMut.mutate(id);
  };
  const handleLogoutAll = async () => {
    const ok = await swalConfirm(`Log ${username} out everywhere?`, "All of their active sessions will be revoked immediately.", "Log out all");
    if (ok) revokeMut.mutate();
  };

  const TabBtn = ({ id, icon, label, count }: { id: typeof tab; icon: typeof faBan; label: string; count?: number }) => (
    <button type="button" className={`mc-uptabs__tab${tab === id ? " is-on" : ""}`} onClick={() => setTab(id)}>
      <FontAwesomeIcon icon={icon} /> {label}
      {count != null && <span className="mc-uptabs__count">{count}</span>}
    </button>
  );

  return (
    <div className="mc-uptabs">
      <div className="mc-uptabs__bar">
        <div className="mc-uptabs__tabs">
          <TabBtn id="warnings" icon={faTriangleExclamation} label="Warnings" count={warningsQ.data?.length} />
          <TabBtn id="bans"     icon={faBan}                 label="Bans"     count={bansQ.data?.length} />
          <TabBtn id="ips"      icon={faNetworkWired}        label="IPs"      count={network.ips.length} />
          <TabBtn id="cookies"  icon={faFingerprint}         label="Cookies"  count={network.cookies.length} />
          <TabBtn id="sessions" icon={faDesktop}             label="Sessions" count={sessions.length} />
        </div>
        {canLogout && (
          <button type="button" className="mc-btn mc-btn--danger mc-btn--sm" onClick={handleLogoutAll} disabled={revokeMut.isPending}>
            <FontAwesomeIcon icon={faRightFromBracket} /> Log out everywhere
          </button>
        )}
      </div>

      <div className="mc-uptabs__body">
        {tab === "warnings" && (
          warningsQ.isLoading ? <p className="mc-uprofile__none">Loading…</p>
          : warningsQ.isError ? <p className="mc-uprofile__none">Could not load warnings.</p>
          : (warningsQ.data?.length ?? 0) === 0 ? <p className="mc-uprofile__none">No warnings.</p>
          : (
            <div className="mc-list">
              {warningsQ.data!.map((w) => (
                <div key={w.id} className={`mc-row${w.status !== "active" ? " is-dim" : ""}`}>
                  <div className="mc-row__main">
                    <p className="mc-row__title"><Tag crit={w.status === "active"}>{w.status}</Tag>{w.reason}</p>
                    <span className="mc-row__meta">
                      by <Username username={w.issuedBy.username} badgeColor={w.issuedBy.badgeColor} /> · {timeAgo(w.createdAt)}
                      {w.expiresAt && ` · expires ${new Date(w.expiresAt).toLocaleDateString()}`}
                    </span>
                  </div>
                  {w.status === "active" && (
                    <div className="mc-row__act">
                      <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" disabled={pardonMut.isPending} onClick={() => pardonMut.mutate(w.id)}>
                        <FontAwesomeIcon icon={faCheck} /> Pardon
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {tab === "bans" && (
          bansQ.isLoading ? <p className="mc-uprofile__none">Loading…</p>
          : bansQ.isError ? <p className="mc-uprofile__none">Could not load bans.</p>
          : (bansQ.data?.length ?? 0) === 0 ? <p className="mc-uprofile__none">No bans.</p>
          : (
            <div className="mc-list">
              {bansQ.data!.map((b) => (
                <div key={b.id} className={`mc-row${b.status !== "active" ? " is-dim" : ""}`}>
                  <div className="mc-row__main">
                    <p className="mc-row__title">
                      <Tag crit={b.status === "active"}>{b.status}</Tag>
                      <Tag crit={b.type === "permanent"}>{b.type}</Tag>
                      {b.reason}
                    </p>
                    <span className="mc-row__meta">
                      by <Username username={b.issuedBy.username} badgeColor={b.issuedBy.badgeColor} /> · {timeAgo(b.createdAt)}
                      {b.expiresAt ? ` · expires ${new Date(b.expiresAt).toLocaleDateString()}` : " · permanent"}
                    </span>
                  </div>
                  {b.status === "active" && (
                    <div className="mc-row__act">
                      <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" disabled={liftMut.isPending} onClick={() => handleLift(b.id)}>
                        <FontAwesomeIcon icon={faUnlock} /> Lift ban
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {tab === "ips" && (
          network.ips.length === 0 ? <p className="mc-uprofile__none">No recorded IPs.</p> : (
            <div className="mc-list">
              {network.ips.map((r) => (
                <div key={r.ip} className="mc-row"><div className="mc-row__main">
                  <p className="mc-row__title" style={{ fontFamily: "var(--ff-mono)" }}>{r.ip}</p>
                  <span className="mc-row__meta">{r.count} event(s) · last {timeAgo(r.lastSeen)}</span>
                  {slotRegistry.getIpEnrichments().map((e) => <e.component key={e.id} ip={r.ip} />)}
                </div></div>
              ))}
            </div>
          )
        )}

        {tab === "cookies" && (
          network.cookies.length === 0 ? <p className="mc-uprofile__none">No device cookies.</p> : (
            <div className="mc-list">
              {network.cookies.map((r) => (
                <div key={r.deviceCookieId} className="mc-row"><div className="mc-row__main">
                  <p className="mc-row__title" style={{ fontFamily: "var(--ff-mono)" }}>{r.deviceCookieId.slice(0, 18)}…</p>
                  <span className="mc-row__meta">{r.count} event(s) · last {timeAgo(r.lastSeen)}</span>
                </div></div>
              ))}
            </div>
          )
        )}

        {tab === "sessions" && (
          sessions.length === 0 ? <p className="mc-uprofile__none">No active sessions.</p> : (
            <div className="mc-list">
              {sessions.map((s) => (
                <div key={s.id} className="mc-row"><div className="mc-row__main">
                  <p className="mc-row__title">{s.userAgent ? s.userAgent.slice(0, 60) : "Unknown device"}</p>
                  <span className="mc-row__meta" style={{ fontFamily: "var(--ff-mono)" }}>{s.ip ?? "no ip"} · active {timeAgo(s.lastUsedAt)}</span>
                </div></div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function UserProfileView({
  profile, me, onChanged,
}: {
  profile: ModUserProfile;
  me: ReturnType<typeof useAuth>["user"];
  onChanged: () => void;
}) {
  const { user, activeBan, network, sessions } = profile;
  const isBanned = !!user.bannedUntil && new Date(user.bannedUntil) > new Date();
  const verified = !!user.emailVerifiedAt;

  // Rank = highest group precedence (lower displayOrder = higher rank).
  const rankOf = (groups: { displayOrder: number }[]) =>
    groups.length ? Math.min(...groups.map((g) => g.displayOrder)) : Infinity;
  const isSelf    = me?.id === user.id;
  const canLogout = !isSelf && rankOf(user.groups) >= rankOf(me?.groups ?? []);

  // Lift the active ban directly from the banner at the top of the mini-profile.
  const liftMut = useMutation({
    mutationFn: (id: string) => api.patch(`/moderation/bans/${id}/lift`, {}),
    onSuccess:  () => { onChanged(); swalToast("Ban lifted.", "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });
  const handleLift = async (id: string) => {
    const ok = await swalConfirm(`Lift ban on ${user.username}?`, "This restores their access immediately.", "Lift ban");
    if (ok) liftMut.mutate(id);
  };

  // Activity counters link out to the user's public profile (opens the matching tab).
  const u = encodeURIComponent(user.username);
  const stats: { label: string; value: number; tab: string }[] = [
    { label: "Articles",  value: user.counters.articleCount,   tab: "articles"  },
    { label: "Posts",     value: user.counters.postCount,      tab: "forum"     },
    { label: "Threads",   value: user.counters.threadCount,    tab: "forum"     },
    { label: "Followers", value: user.counters.followerCount,  tab: "followers" },
    { label: "Following", value: user.counters.followingCount, tab: "following" },
  ];

  return (
    <div className="mc-uprofile">
      {/* Identity header */}
      <div className="mc-uprofile__head">
        <UserAvatar user={{ username: user.username, avatar: user.avatar }} size={52} />
        <div className="mc-uprofile__id">
          <div className="mc-uprofile__name">
            <Username username={user.username} badgeColor={user.groups[0]?.badgeColor ?? null} />
            {!user.isActive && <Tag>deactivated</Tag>}
          </div>
          {user.displayName && <span className="mc-uprofile__display">{user.displayName}</span>}
          <div className="mc-uprofile__meta">
            <span title={verified ? "Email verified" : "Email not verified"}>
              <FontAwesomeIcon icon={verified ? faCircleCheck : faCircleXmark} style={{ color: verified ? "var(--c-success)" : "var(--c-fg-subtle)" }} />
              {" "}{verified ? "Verified" : "Unverified"}
            </span>
            <span>· Joined {new Date(user.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="mc-uprofile__badges">
            {user.groups.map((g) => (
              <span key={g.key} className="mc-tag" style={g.badgeColor ? { borderColor: g.badgeColor, color: g.badgeColor } : undefined}>
                {g.badgeLabel ?? g.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {isBanned && (
        <div className="mc-uprofile__banbar">
          <span>
            <FontAwesomeIcon icon={faBan} /> Currently banned
            {user.bannedUntil && new Date(user.bannedUntil).getFullYear() < 9000
              ? ` until ${new Date(user.bannedUntil).toLocaleString()}`
              : " — permanent"}
          </span>
          {activeBan && (
            <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" style={{ marginLeft: "auto" }}
              disabled={liftMut.isPending} onClick={() => handleLift(activeBan.id)}>
              <FontAwesomeIcon icon={faUnlock} /> Lift ban
            </button>
          )}
        </div>
      )}

      {/* Plugin user panels (e.g. shoutbox mute alert). Each self-gates — renders
          nothing when it has nothing to show for this user. */}
      {slotRegistry.getModCanvasUserPanels().map((p) => (
        <p.component key={p.id} userId={user.id} username={user.username} />
      ))}

      {/* Counters — link to the user's public profile */}
      <div className="mc-uprofile__stats">
        {stats.map((s) => (
          <a key={s.label} className="mc-uprofile__stat" href={`/u/${u}?tab=${s.tab}`} target="_blank" rel="noreferrer">
            <b>{s.value}</b>
            <span>{s.label}</span>
          </a>
        ))}
      </div>

      {/* Actions */}
      {!isSelf && (
        <ActionBar userId={user.id} username={user.username} banned={isBanned} onDone={onChanged} />
      )}

      {/* Warnings · Bans · IPs · Device cookies · Sessions — all tabbed */}
      <UserModTabs userId={user.id} username={user.username} canLogout={canLogout} onChanged={onChanged} network={network} sessions={sessions} />

    </div>
  );
}

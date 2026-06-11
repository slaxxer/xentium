import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronLeft, faChevronRight, faPenToSquare, faBan, faUnlock,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { UserAvatar } from "../../../components/UserAvatar";
import { Username } from "../../../components/Username";

interface Group {
  id: string;
  name: string;
  key: string;
  icon: string | null;
  isSystem: boolean;
  progression: { badgeColor: string | null; badgeLabel: string | null } | null;
}

interface User {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
  isActive: boolean;
  createdAt: string;
  articleCount: number;
  postCount?: number;
  bannedUntil?: string | null;
  groups: Group[];
}

interface PaginatedUsers {
  data: User[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

function formatJoinDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function groupColor(g: Group): string {
  return g.progression?.badgeColor ?? "var(--c-accent)";
}

function groupLabel(g: Group): string {
  return g.progression?.badgeLabel ?? g.name;
}

// ── Ban modal ───────────────────────────────────────────────────────────────

function BanModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
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
      qc.invalidateQueries({ queryKey: ["acp-users"] });
      swalToast(t("userList.banned", { username: user.username }), "success");
      onClose();
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const minDate = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);

  const canSubmit = reason.trim().length > 0 &&
    (type === "permanent" || (type === "temporary" && !!expiresAt));

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div className="acp-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: 4 }}>{t("userList.banTitle")}</h2>
        <p style={{ fontSize: 13, color: "var(--c-fg-muted)", marginBottom: 20 }}>
          {t("userList.banBody", { username: user.username })}
        </p>

        {/* Type */}
        <div className="acp-form-field">
          <label className="acp-label">{t("userList.banType")}</label>
          <div style={{ display: "flex", gap: 10 }}>
            {(["temporary", "permanent"] as const).map((bt) => (
              <label
                key={bt}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 8, padding: "9px 14px", borderRadius: "var(--radius-sm)", cursor: "pointer",
                  border: `1px solid ${type === bt ? "var(--c-danger)" : "var(--c-border)"}`,
                  background: type === bt ? "rgba(248,113,113,0.08)" : "var(--c-surface)",
                  fontSize: 13, fontWeight: 600,
                  color: type === bt ? "var(--c-danger)" : "var(--c-fg-muted)",
                  transition: "all .15s",
                }}
              >
                <input
                  type="radio"
                  name="ban-type"
                  value={bt}
                  checked={type === bt}
                  onChange={() => setType(bt)}
                  style={{ display: "none" }}
                />
                {bt === "temporary" ? t("userList.typeTemporary") : t("userList.typePermanent")}
              </label>
            ))}
          </div>
        </div>

        {/* Expires at — only for temporary */}
        {type === "temporary" && (
          <div className="acp-form-field">
            <label className="acp-label">{t("userList.expiresAt")}</label>
            <input
              className="acp-input"
              type="datetime-local"
              min={minDate}
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        )}

        {/* Reason */}
        <div className="acp-form-field">
          <label className="acp-label">{t("userList.reason")} <span style={{ color: "var(--c-danger)" }}>*</span></label>
          <textarea
            className="acp-input"
            rows={3}
            style={{ resize: "vertical", fontFamily: "inherit" }}
            placeholder={t("userList.reasonPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: 8 }}>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{t("common:actions.cancel")}</button>
          <button
            type="button"
            className="btn-danger btn-sm"
            disabled={!canSubmit || banMutation.isPending}
            onClick={() => banMutation.mutate()}
          >
            <FontAwesomeIcon icon={faBan} style={{ marginRight: 5 }} />
            {banMutation.isPending ? t("userList.banning") : t("userList.banTitle")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export function UserListPage() {
  const { t } = useTranslation("acp");
  const qc                              = useQueryClient();
  const [page, setPage]                 = useState(1);
  const [search, setSearch]             = useState("");
  const [debouncedSearch, setDebounced] = useState("");
  const [groupId, setGroupId]           = useState("");
  const [status, setStatus]             = useState("");
  const [banTarget, setBanTarget]       = useState<User | null>(null);
  const debRef = { current: 0 };

  const { data, isLoading } = useQuery<PaginatedUsers>({
    queryKey: ["acp-users", page, debouncedSearch, groupId, status],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: "20" });
      if (debouncedSearch) p.set("search", debouncedSearch);
      if (groupId)         p.set("groupId", groupId);
      if (status)          p.set("status", status);
      return api.get(`/admin/users?${p}`);
    },
  });

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["acp-groups-list"],
    queryFn:  () => api.get<Group[]>("/admin/groups"),
  });

  const liftBanMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/admin/users/${userId}/ban`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-users"] });
      swalToast(t("userList.banLifted"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  async function handleLiftBan(u: User) {
    const result = await swalConfirm(
      t("userList.liftConfirmTitle"),
      t("userList.liftConfirmBody", { username: u.username }),
      t("userList.liftBan"),
      t("common:actions.cancel"),
    );
    if (result) liftBanMutation.mutate(u.id);
  }

  function handleSearch(val: string) {
    setSearch(val);
    clearTimeout(debRef.current);
    debRef.current = window.setTimeout(() => { setDebounced(val); setPage(1); }, 350);
  }

  const meta = data?.meta;

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("userList.eyebrow")}</div>
          <h1 className="acp-page-title">{t("nav.users")}</h1>
        </div>
      </div>

      {/* Filters */}
      <div className="acp-filter-row">
        <input
          className="acp-input"
          style={{ width: 280, flexShrink: 0 }}
          placeholder={t("userList.searchPlaceholder")}
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
        <select
          className="acp-select"
          style={{ width: "auto" }}
          value={groupId}
          onChange={(e) => { setGroupId(e.target.value); setPage(1); }}
        >
          <option value="">{t("userList.allRoles")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <select
          className="acp-select"
          style={{ width: "auto" }}
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
        >
          <option value="">{t("userList.allStatus")}</option>
          <option value="active">{t("userList.statusActive")}</option>
          <option value="banned">{t("userList.statusBanned")}</option>
        </select>
        {meta && (
          <span className="acp-filter-count">
            {t("userList.countUsers", { count: meta.total })}
          </span>
        )}
      </div>

      <div className="acp-card" style={{ padding: 0, overflow: "hidden" }}>
        {/* Column headers */}
        <div className="acp-list-head acp-users-cols">
          {[t("userList.colUser"), t("userList.colEmail"), t("userList.colRole"), t("userList.colPosts"), t("userList.colStatus"), t("userList.colActions")].map((h) => (
            <div key={h}>{h}</div>
          ))}
        </div>

        {isLoading ? (
          <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--c-fg-muted)", fontSize: 14 }}>
            {t("userList.loading")}
          </div>
        ) : (
          <div>
            {data?.data.map((u) => {
              const pg       = u.groups[0];
              const color    = pg ? groupColor(pg) : "var(--c-accent)";
              const isBanned = !u.isActive || !!u.bannedUntil;
              const isAdmin  = u.groups.some((g) => g.key === "admin");
              return (
                <div key={u.id} className="acp-list-row acp-users-cols">
                  {/* User: avatar + name + joined */}
                  <div className="acp-user-cell">
                    <UserAvatar
                      user={{
                        username: u.username,
                        avatar: u.avatar ? `/uploads/${u.avatar}` : null,
                      }}
                      size={34}
                    />
                    <div>
                      <Username className="acp-user-cell__name" username={u.username} badgeColor={u.groups[0] ? groupColor(u.groups[0]) : undefined} />
                      <div className="acp-user-cell__sub">{t("userList.joined", { date: formatJoinDate(u.createdAt) })}</div>
                    </div>
                  </div>

                  {/* Email */}
                  <div className="acp-cell-muted">{u.email}</div>

                  {/* Role */}
                  <div>
                    {pg ? (
                      <span
                        className="acp-badge"
                        style={{
                          background: `${color}20`,
                          color,
                          border: `1px solid ${color}40`,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        {pg.icon && (
                          <img
                            src={`/uploads/${pg.icon}`}
                            alt=""
                            style={{ width: 12, height: 12, borderRadius: 2, objectFit: "cover" }}
                          />
                        )}
                        {groupLabel(pg)}
                      </span>
                    ) : (
                      <span className="acp-cell-muted">—</span>
                    )}
                  </div>

                  {/* Posts */}
                  <div className="acp-cell-muted">
                    {u.postCount ?? u.articleCount}
                  </div>

                  {/* Status */}
                  <div>
                    <span className={`acp-badge ${isBanned ? "acp-badge--danger" : "acp-badge--success"}`}>
                      {isBanned ? t("userList.statusBanned") : t("userList.statusActive")}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="acp-user-actions">
                    <Link
                      to={`/admin/users/${u.id}`}
                      className="btn-ghost btn-sm"
                      style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}
                    >
                      <FontAwesomeIcon icon={faPenToSquare} /> {t("userList.edit")}
                    </Link>
                    {isBanned ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        style={{ color: "var(--c-success)" }}
                        disabled={liftBanMutation.isPending}
                        onClick={() => handleLiftBan(u)}
                      >
                        <FontAwesomeIcon icon={faUnlock} /> {t("userList.liftBan")}
                      </button>
                    ) : isAdmin ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled
                        title={t("userList.adminCannotBan")}
                        style={{ opacity: 0.35, cursor: "not-allowed" }}
                      >
                        <FontAwesomeIcon icon={faBan} /> {t("userList.ban")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-ghost-danger btn-sm"
                        onClick={() => setBanTarget(u)}
                      >
                        <FontAwesomeIcon icon={faBan} /> {t("userList.ban")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {data?.data.length === 0 && (
              <div style={{ padding: "3rem", textAlign: "center", color: "var(--c-fg-muted)", fontSize: 14 }}>
                {t("userList.noUsers")}
              </div>
            )}
          </div>
        )}

        {meta && meta.totalPages > 1 && (
          <div className="acp-pagination" style={{ padding: "12px 18px", borderTop: "1px solid var(--c-border)", marginTop: 0 }}>
            <button className="btn-ghost btn-sm" onClick={() => setPage((p) => p - 1)} disabled={page === 1}>
              <FontAwesomeIcon icon={faChevronLeft} />
            </button>
            <span>{t("userList.paginationSummary", { page: meta.page, pages: meta.totalPages, count: meta.total })}</span>
            <button className="btn-ghost btn-sm" onClick={() => setPage((p) => p + 1)} disabled={page >= meta.totalPages}>
              <FontAwesomeIcon icon={faChevronRight} />
            </button>
          </div>
        )}
      </div>

      {banTarget && (
        <BanModal user={banTarget} onClose={() => setBanTarget(null)} />
      )}
    </div>
  );
}

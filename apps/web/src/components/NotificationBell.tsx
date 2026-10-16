import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { TokenIcon } from "./TokenIcon";
import { FontAwesomeIcon } from "./Icon";
import { faBell, faGear, faUserShield } from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";
import { timeAgo } from "../lib/time";
import { slotRegistry } from "../plugins/slotRegistry";
import { UserAvatar } from "./UserAvatar";
import i18n from "../lib/i18n";

interface Notification {
  id:        string;
  type:      string;
  title:     string;
  body:      string;
  link:      string | null;
  readAt:    string | null;
  createdAt: string;
  meta?:     {
    senderUsername?: string; senderAvatar?: string | null; senderBadgeColor?: string | null;
    warningId?: string;
    commentId?: string;
    i18n?: { key: string; params?: Record<string, string | number> };
  } | null;
}

/**
 * Where a notification takes its reader: the thing it is about. Newer notifications
 * store that exact link; older wall ones stored only the profile, so the comment is
 * added here from what they did store.
 */
function sourceLink(n: Notification): string | null {
  const commentId = n.meta?.commentId;
  if (n.link && commentId && /^\/u\/[^/?#]+$/.test(n.link) && (n.type.startsWith("profile.comment") || n.type === "mention.profile_comment")) {
    return `${n.link}?tab=wall&comment=${commentId}`;
  }
  // The old ACP reports page is gone; the moderation shield lists reports now.
  if (n.link === "/admin/moderation/reports") return "/?modcanvas=reports";
  return n.link;
}

/** Values that are themselves machine keys, named into words for the sentence. */
const PARAM_TEXT: Record<string, (v: string) => string> = {
  caseType: (v) => `common:modcanvas.data.caseTitle.${v}`,
  target:   (v) => `common:notify.targets.${v}`,
};

/**
 * The notification in the reader's language when it was sent as a translation
 * (`meta.i18n`); the stored text otherwise — older rows, a plugin without the key,
 * and a body that is someone's own words (a ban reason) has no `.body` key.
 */
function notificationText(n: Notification): { title: string; body: string } {
  const text = n.meta?.i18n;
  if (!text?.key) return { title: n.title, body: n.body };
  const params: Record<string, string | number> = { ...text.params };
  for (const [name, keyOf] of Object.entries(PARAM_TEXT)) {
    const v = params[name];
    if (typeof v === "string" && i18n.exists(keyOf(v))) params[name] = String(i18n.t(keyOf(v)));
  }
  const pick = (part: "title" | "body", stored: string) =>
    i18n.exists(`${text.key}.${part}`) ? String(i18n.t(`${text.key}.${part}`, params)) : stored;
  return { title: pick("title", n.title), body: pick("body", n.body) };
}

/** `icon`: a glyph chosen in the layout editor (the `notifications` block), else the bell. */
export function NotificationBell({ icon }: { icon?: string } = {}) {
  const { t } = useTranslation("common", { keyPrefix: "notifications" });
  const qc              = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);

  const { data: countData } = useQuery<{ count: number }>({
    queryKey:      ["notif-unread-count"],
    queryFn:       () => api.get("/notifications/unread-count"),
    refetchInterval: 60_000,
  });

  const { data: listData, isLoading: listLoading } = useQuery<{ data: Notification[] }>({
    queryKey: ["notif-list"],
    queryFn:  () => api.get("/notifications?limit=15"),
    enabled:  open,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`, {}),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ["notif-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notif-list"] });
    },
  });

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const unread = countData?.count ?? 0;
  const { user: me } = useAuth();
  const notifications = listData?.data ?? [];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Bell button */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "relative",
          background: "var(--input-bg)",
          border: "none",
          borderRadius: "var(--radius-md)",
          width: 40, height: 40,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: "var(--c-fg-muted)",
          transition: "background .15s, color .15s",
          ...(open ? { background: "var(--c-accent-soft)", color: "var(--c-accent)" } : {}),
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--c-accent-soft)"; e.currentTarget.style.color = "var(--c-fg)"; }}
        onMouseLeave={(e) => {
          if (!open) { e.currentTarget.style.background = "var(--input-bg)"; e.currentTarget.style.color = "var(--c-fg-muted)"; }
        }}
        aria-label={unread > 0 ? `${t("title")} (${unread})` : t("title")}
      >
        {/* fa-solid fa-bell — through the kit-aware icon, so an icon kit / style restyles it too. */}
        {icon ? <span style={{ fontSize: "var(--fs-md)", display: "inline-flex" }}><TokenIcon token={icon} /></span>
          : <FontAwesomeIcon icon={faBell} style={{ fontSize: "var(--fs-md)" }} />}
        {/* A red dot, no count: the header's shared "something new" mark (core's .pub-nav__dot). */}
        {unread > 0 && <span className="pub-nav__dot" aria-hidden="true" />}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="xt-pop" style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0,
          width: 340, maxHeight: 420,
          background: "var(--c-card)", border: "1px solid var(--c-border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          display: "flex", flexDirection: "column",
          overflow: "hidden", zIndex: 200,
        }}>
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px", borderBottom: "1px solid var(--c-border)", flexShrink: 0,
          }}>
            <span style={{ fontSize: "var(--fs-sm)", fontWeight: "var(--menu-title-fw)" as never, color: "var(--c-fg)" }}>
              {t("title")} {unread > 0 && <span style={{ color: "var(--c-accent)", fontSize: "var(--fs-xs)" }}>({unread})</span>}
            </span>
          </div>

          {/* List */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {listLoading ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--c-fg-muted)", fontSize: "var(--fs-sm)" }}>
                {t("loading")}
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--c-fg-muted)", fontSize: "var(--fs-sm)" }}>
                {t("empty")}
              </div>
            ) : (
              notifications.map((n) => {
                const isUnread = !n.readAt;
                // A warning (issued or pardoned): the moderation shield, and a link to the
                // member's own Warnings tab with that warning picked out. Older ones were
                // stored pointing at account security, so the link is built here, not read.
                const isWarning = n.type.startsWith("moderation.warning_");
                // Anything a moderator's action caused (core's moderation.* and what plugins
                // declare) wears the moderation shield: a red user-shield in a 1px red ring.
                const isModeration = slotRegistry.getModerationNotificationPrefixes()
                  .some((prefix) => n.type.startsWith(prefix));
                const link = isWarning && me
                  ? `/u/${encodeURIComponent(me.username)}?tab=warnings${n.meta?.warningId ? `&warning=${n.meta.warningId}` : ""}`
                  : sourceLink(n);
                const isSystemNotif = slotRegistry.getSystemNotificationPrefixes().some((prefix) => n.type.startsWith(prefix) || n.type === prefix);
                const senderUser = n.meta?.senderUsername
                  ? { username: n.meta.senderUsername, avatar: n.meta.senderAvatar ?? null }
                  : null;
                // A moderation notice is from "the moderators", not from whichever staff member
                // clicked: no group colour on its title (a red admin colour read as an error).
                const senderColor = isModeration ? undefined : n.meta?.senderBadgeColor ?? undefined;

                const inner = (
                  <div style={{
                    display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 16px",
                    background: isUnread ? "rgba(124,106,247,0.06)" : "transparent",
                    borderBottom: "1px solid var(--c-border)",
                    cursor: "pointer", transition: "background .15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--c-surface)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isUnread ? "rgba(124,106,247,0.06)" : "transparent"; }}
                  onClick={() => { if (isUnread) markReadMutation.mutate(n.id); setOpen(false); }}
                  >
                    {/* Avatar: gear for system, UserAvatar for everything else */}
                    <div style={{ flexShrink: 0, position: "relative", marginTop: 1 }}>
                      {isModeration ? (
                        <div data-mod-notice="" style={{ width: 30, height: 30, boxSizing: "border-box", borderRadius: "50%", border: "1px solid var(--c-danger)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--fs-xs)", color: "var(--c-danger)" }}>
                          <FontAwesomeIcon icon={faUserShield} />
                        </div>
                      ) : isSystemNotif ? (
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--c-surface)", border: "1px solid var(--c-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--fs-xs)", color: "var(--c-fg-muted)" }}>
                          <FontAwesomeIcon icon={faGear} />
                        </div>
                      ) : (
                        <UserAvatar
                          user={senderUser ?? { username: n.title, avatar: null }}
                          size={30}
                        />
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "var(--fs-sm)", fontWeight: (isUnread ? "var(--menu-title-fw)" : "var(--menu-fw)") as never, color: senderColor ?? "var(--c-fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {notificationText(n).title}
                      </div>
                      <div style={{ fontSize: "var(--fs-xs)", color: "var(--c-fg-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {notificationText(n).body}
                      </div>
                      <div style={{ fontSize: "var(--fs-2xs)", color: "var(--c-fg-muted)", marginTop: 4 }}>{timeAgo(n.createdAt)}</div>
                    </div>
                  </div>
                );

                return link ? (
                  <Link key={n.id} to={link} style={{ textDecoration: "none", display: "block" }}>
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

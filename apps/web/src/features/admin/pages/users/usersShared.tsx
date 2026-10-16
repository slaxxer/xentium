/**
 * What the ACP's user list and user page share: the wire types, how a status, a
 * role and a flag are drawn, and the one ban dialog.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../../components/Icon";
import { faBan, faXmark, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../../lib/api";
import { apiErrorMessage } from "../../../../lib/swal";
import { timeAgo } from "../../../../lib/time";
import { uiLocale } from "../../../../lib/i18n";

export interface Group {
  id: string;
  name: string;
  key: string;
  icon: string | null;
  isSystem: boolean;
  progression: { badgeColor: string | null; badgeLabel: string | null } | null;
}

export type UserStatus = "active" | "banned" | "inactive";
export type UserFlag = "failed_signins" | "unverified_email";

export interface ListUser {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
  createdAt: string;
  postCount: number;
  articleCount: number;
  commentCount: number;
  status: UserStatus;
  bannedUntil: string | null;
  lastSeenAt: string | null;
  online: boolean;
  flags: UserFlag[];
  failedSignins24h: number;
  groups: Group[];
}

export interface UserCounts { total: number; active: number; banned: number; inactive: number; flagged: number }

/** The strongest group a member holds is the one the list names them by. */
export function topGroup(groups: Group[]): Group | undefined {
  return groups[0];
}

export function groupColor(g: Group | undefined): string {
  return g?.progression?.badgeColor ?? "var(--c-accent)";
}

export function groupLabel(g: Group): string {
  return g.progression?.badgeLabel ?? g.name;
}

export function RolePill({ group, fallback }: { group: Group | undefined; fallback: string }) {
  const color = groupColor(group);
  return (
    <span className="usr-role" style={{ ["--usr-role" as string]: color }}>
      <i />{group ? groupLabel(group) : fallback}
    </span>
  );
}

export function StatusPill({ status, long, bannedUntil }: { status: UserStatus; long?: boolean; bannedUntil?: string | null }) {
  const { t } = useTranslation("acp");
  let label = t(`users.status.${status}`);
  if (long && status === "banned" && bannedUntil) {
    label = new Date(bannedUntil).getFullYear() >= 9999
      ? t("users.bannedPermanent")
      : t("users.bannedUntil", { date: new Date(bannedUntil).toLocaleDateString(uiLocale(), { day: "numeric", month: "short", year: "numeric" }) });
  }
  return <span className={`usr-status usr-status--${status}`}>{label}</span>;
}

export function FlagChip({ flags, failed }: { flags: UserFlag[]; failed: number }) {
  const { t } = useTranslation("acp");
  if (!flags.length) return null;
  const text = flags.map((f) => t(`users.flag.${f}`, { count: failed })).join(" · ");
  return (
    <span className="usr-flag" title={text}>
      <FontAwesomeIcon className="usr-flag__ic" icon={faTriangleExclamation} />{text}
    </span>
  );
}

/** "now" while the presence set has them, otherwise how long since a session was used. */
export function lastSeenText(u: { online: boolean; lastSeenAt: string | null }, t: (k: string) => string): string {
  if (u.online) return t("users.seenNow");
  return u.lastSeenAt ? timeAgo(u.lastSeenAt) : t("users.seenNever");
}

// ── Ban dialog ───────────────────────────────────────────────────────────────

const PRESETS: [key: string, hours: number][] = [["24h", 24], ["7d", 168], ["30d", 720], ["90d", 2160]];

/** `datetime-local` wants local wall-clock time, not an ISO instant. */
function toLocalInput(d: Date): string {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export interface BanOutcome { done: string[]; refused: { username: string; reason: string }[] }

/**
 * Ban one member or a selection.
 *
 * ⚠ A selection is banned one request per member, through the same endpoint and
 * the same checks as a single ban — an administrator or yourself is refused per
 * person and reported, not silently skipped and not failing the whole batch.
 */
export function BanDialog({ targets, onClose, onDone }: {
  targets: { id: string; username: string }[];
  onClose: () => void;
  onDone: (outcome: BanOutcome) => void;
}) {
  const { t } = useTranslation("acp");
  const [type, setType] = useState<"temporary" | "permanent">("temporary");
  const [expires, setExpires] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const bulk = targets.length > 1;

  // Opens at the length set in Mod Settings, so the default is the admin's, not ours.
  const { data: policy } = useQuery<{ defaultDays: number }>({
    queryKey: ["ban-policy"],
    queryFn: () => api.get("/moderation/ban-policy"),
    staleTime: 60_000,
  });
  useEffect(() => {
    if (policy) setExpires((cur) => cur || toLocalInput(new Date(Date.now() + policy.defaultDays * 86_400_000)));
  }, [policy]);
  const blocked = !reason.trim() || (type === "temporary" && !expires) || busy;

  async function submit() {
    setBusy(true);
    const body = {
      type,
      reason: reason.trim(),
      expiresAt: type === "temporary" ? new Date(expires).toISOString() : null,
    };
    const results = await Promise.allSettled(targets.map((u) => api.post(`/admin/users/${u.id}/ban`, body)));
    const outcome: BanOutcome = { done: [], refused: [] };
    results.forEach((r, i) => {
      const u = targets[i]!;
      if (r.status === "fulfilled") outcome.done.push(u.username);
      else outcome.refused.push({ username: u.username, reason: apiErrorMessage(r.reason) });
    });
    setBusy(false);
    onDone(outcome);
  }

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div className="acp-modal usr-ban" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="usr-ban__head">
          <div className="usr-ban__ic"><FontAwesomeIcon icon={faBan} /></div>
          <div className="usr-ban__titles">
            <h2>{bulk ? t("users.ban.titleMany", { count: targets.length }) : t("users.ban.titleOne", { name: targets[0]?.username })}</h2>
            <span>{bulk ? targets.map((u) => u.username).join(", ") : t("users.ban.subtitle")}</span>
          </div>
          <button type="button" className="usr-ban__x" onClick={onClose} aria-label={t("common:actions.cancel")}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="usr-ban__body">
          <label className="usr-ban__label">{t("users.ban.duration")}</label>
          <div className="usr-ban__types">
            {(["temporary", "permanent"] as const).map((bt) => (
              <button key={bt} type="button" className={type === bt ? "is-on" : ""} onClick={() => setType(bt)}>
                {t(`users.ban.${bt}`)}
              </button>
            ))}
          </div>

          {type === "temporary" && (
            <>
              <label className="usr-ban__label">{t("users.ban.expires")}</label>
              <div className="usr-ban__presets">
                {PRESETS.map(([key, hours]) => (
                  <button key={key} type="button"
                    onClick={() => setExpires(toLocalInput(new Date(Date.now() + hours * 3600e3)))}>
                    {t(`users.ban.preset.${key}`)}
                  </button>
                ))}
              </div>
              <input className="inp usr-ban__field" type="datetime-local" value={expires}
                min={toLocalInput(new Date(Date.now() + 5 * 60_000))}
                onChange={(e) => setExpires(e.target.value)} />
            </>
          )}

          <label className="usr-ban__label">
            {t("users.ban.reason")} <span className="usr-ban__req">*</span>
          </label>
          <textarea className="inp usr-ban__field usr-ban__reason" rows={3} value={reason}
            placeholder={t("users.ban.reasonPlaceholder")} onChange={(e) => setReason(e.target.value)} />
        </div>

        <div className="usr-ban__foot">
          <span>{t("users.ban.note")}</span>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{t("common:actions.cancel")}</button>
          <button type="button" className="btn-danger btn-sm" disabled={blocked} onClick={submit}>
            <FontAwesomeIcon icon={faBan} /> {busy ? t("users.ban.issuing") : t("users.ban.issue")}
          </button>
        </div>
      </div>
    </div>
  );
}

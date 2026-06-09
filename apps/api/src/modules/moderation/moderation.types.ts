export type ReportTargetType = "article" | "article_comment" | "profile_comment" | "user" | "plugin-content";
export type ReportStatus     = "pending" | "reviewed" | "resolved" | "dismissed";
export type WarningStatus    = "active" | "expired" | "pardoned";
export type BanType          = "temporary" | "permanent";
export type BanStatus        = "active" | "expired" | "lifted";
export type CaseStatus       = "open" | "reviewed" | "dismissed";
export type CaseType         = "rapid_login_attempts" | "multi_account_suspicion" | "ban_evasion_suspicion" | "registration_burst";

export interface ThresholdRule {
  warningCount: number;
  action:       "ban_temporary" | "ban_permanent";
  banDays?:     number;
}

export interface ModerationPolicy {
  thresholds: ThresholdRule[];
}

/** Short, human label for a case type — used as the subject in mod-log entries
 *  (e.g. "Multiaccounting") instead of an opaque "Case: a, b". */
export function humanizeCaseType(type: string): string {
  switch (type) {
    case "multi_account_suspicion": return "Multiaccounting";
    case "rapid_login_attempts":    return "Rapid Login";
    case "ban_evasion_suspicion":   return "Ban Evasion";
    case "registration_burst":      return "Registration Burst";
    default:                        return "Case";
  }
}

/** One-line "who shares what" detail for a case, derived from its type + the
 *  linked usernames — the information behind the case. */
export function describeCaseSignal(type: string, usernames: string[]): string {
  const who = usernames.length ? usernames.join(" & ") : "multiple accounts";
  switch (type) {
    case "multi_account_suspicion": return `${who} share the same device cookie`;
    case "rapid_login_attempts":    return `repeated failed logins from the same IP (${who})`;
    case "ban_evasion_suspicion":   return `${who} — new account near a ban from the same IP`;
    case "registration_burst":      return `${who} registered from the same IP`;
    default:                        return who;
  }
}

export const DEFAULT_MODERATION_POLICY: ModerationPolicy = {
  thresholds: [
    { warningCount: 3, action: "ban_temporary", banDays: 7 },
    { warningCount: 5, action: "ban_permanent" },
  ],
};

import { Worker } from "bullmq";
import { prisma } from "../infrastructure/db.js";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";
import { getSettings } from "../shared/utils/settings.js";

const QUEUE_NAME = "log-retention";

// Retention windows in days; 0 = keep forever (that table is skipped).
// Defaults mirror adminService.SETTING_DEFAULTS — kept in sync there so the
// keys surface in the ACP settings API.
const RETENTION_DEFAULTS = {
  "retention.activity_page_visit_days": 30,
  "retention.activity_action_days":     180,
  "retention.error_log_days":           90,
  "retention.login_events_days":        180,
  "retention.task_runs_days":           90,
  "retention.sessions_days":            30,
  "retention.auth_tokens_days":         7,
};

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/**
 * Prune unbounded log tables (§55 hardening): activity log (page visits get a
 * shorter window than the ACP-action audit trail), error log, login events,
 * scheduled-task run history, dead auth sessions and spent auth tokens.
 *
 * Dialog acknowledgments are NOT affected: they live in ncf_acp_visits (durable
 * last-visit marks, bounded to users × paths), precisely so this job can prune
 * page_visit telemetry freely. Login-event retention must stay comfortably above
 * the security scanners' correlation windows (multi-account/impossible-travel
 * look back days, not months) — the 180-day default is far clear of that.
 */
export async function processLogRetention(): Promise<void> {
  const cfg = await getSettings(RETENTION_DEFAULTS);

  const pageVisitDays = Number(cfg["retention.activity_page_visit_days"]) || 0;
  const actionDays    = Number(cfg["retention.activity_action_days"])     || 0;
  const errorDays     = Number(cfg["retention.error_log_days"])           || 0;
  const loginDays     = Number(cfg["retention.login_events_days"])        || 0;
  const taskRunDays   = Number(cfg["retention.task_runs_days"])           || 0;
  const sessionDays   = Number(cfg["retention.sessions_days"])            || 0;
  const authTokenDays = Number(cfg["retention.auth_tokens_days"])         || 0;

  const results: string[] = [];

  if (pageVisitDays > 0) {
    const { count } = await prisma.activityLog.deleteMany({
      where: { category: "page_visit", createdAt: { lt: cutoff(pageVisitDays) } },
    });
    if (count) results.push(`${count} page visit(s) > ${pageVisitDays}d`);
  }

  if (actionDays > 0) {
    const { count } = await prisma.activityLog.deleteMany({
      where: { category: "acp_action", createdAt: { lt: cutoff(actionDays) } },
    });
    if (count) results.push(`${count} ACP action(s) > ${actionDays}d`);
  }

  if (errorDays > 0) {
    const { count } = await prisma.errorLog.deleteMany({
      where: { createdAt: { lt: cutoff(errorDays) } },
    });
    if (count) results.push(`${count} error-log row(s) > ${errorDays}d`);
  }

  if (loginDays > 0) {
    const { count } = await prisma.loginEvent.deleteMany({
      where: { createdAt: { lt: cutoff(loginDays) } },
    });
    if (count) results.push(`${count} login event(s) > ${loginDays}d`);
  }

  // Scheduled-task run history. A task on a 5-minute schedule writes ~105k rows
  // a year, so this table needs the same pruning as the other unbounded logs
  // rather than a cleanup path of its own. The most recent run also lives
  // denormalized on the task row, so pruning never blanks the ACP summary line.
  if (taskRunDays > 0) {
    const { count } = await prisma.scheduledTaskRun.deleteMany({
      where: { startedAt: { lt: cutoff(taskRunDays) } },
    });
    if (count) results.push(`${count} task run(s) > ${taskRunDays}d`);
  }

  // Dead auth sessions. This is the fastest-growing table in the schema: the
  // refresh token rotates on every use, and a rotation REVOKES the old row and
  // CREATES a new one (auth.tokens.ts) rather than updating in place. With a
  // 15-minute access token that is ~96 rows per continuously-active user per
  // day, and nothing else in the codebase ever deletes a session row.
  //
  // Only rows that can no longer authenticate anything are eligible — revoked,
  // or past their own expiry. Every reader of this table already filters to
  // live sessions (`revokedAt: null, expiresAt > now`), and the security
  // scanners correlate device/IP through ncf_login_events, not through here, so
  // pruning dead rows costs no forensic history.
  if (sessionDays > 0) {
    const { count } = await prisma.session.deleteMany({
      where: {
        lastUsedAt: { lt: cutoff(sessionDays) },
        OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
      },
    });
    if (count) results.push(`${count} dead session(s) > ${sessionDays}d`);
  }

  // Spent single-use auth tokens. Both are minutes-lived, so anything past its
  // expiry by days is unreachable by definition — the window exists only to keep
  // a short trail for support ("did that reset mail ever get used?").
  if (authTokenDays > 0) {
    const at = cutoff(authTokenDays);
    const [resets, changes] = await Promise.all([
      prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: at } } }),
      prisma.emailChangeToken.deleteMany({ where: { expiresAt: { lt: at } } }),
    ]);
    const n = resets.count + changes.count;
    if (n) results.push(`${n} spent auth token(s) > ${authTokenDays}d`);
  }

  console.log(`[log-retention] ${results.length ? `pruned ${results.join(", ")}` : "nothing to prune"}`);
}

export function startLogRetentionWorker() {
  return new Worker(QUEUE_NAME, processLogRetention, {
    connection: bullConnection,
    prefix:     bullPrefix,
  });
}

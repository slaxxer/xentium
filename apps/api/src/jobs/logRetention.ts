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
};

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/**
 * Prune unbounded log tables (§55 hardening): activity log (page visits get a
 * shorter window than the ACP-action audit trail), error log, and login events.
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

  console.log(`[log-retention] ${results.length ? `pruned ${results.join(", ")}` : "nothing to prune"}`);
}

export function startLogRetentionWorker() {
  return new Worker(QUEUE_NAME, processLogRetention, {
    connection: bullConnection,
    prefix:     bullPrefix,
  });
}

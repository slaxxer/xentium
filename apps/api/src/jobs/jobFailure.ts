import type { Job, Worker } from "bullmq";
import { prisma } from "../infrastructure/db.js";
import { logger } from "../infrastructure/logging/logger.js";
import { notificationService } from "../modules/notifications/notification.service.js";
import { NEC } from "../shared/errors/nec.js";

// Queues whose final failure pages admins (§55). Others are logged + retained.
// "update-check" carries the license refresh since the two merged (2026-08-22),
// so it inherits license-refresh's criticality — a silently failing entitlement
// refresh is exactly the thing an admin needs paging before grace runs out.
const CRITICAL_QUEUES = new Set(["email-notification", "update-check"]);

/**
 * Attaches reliability handlers to a BullMQ worker:
 *  - logs every failure (distinguishing retryable vs final attempt);
 *  - on the FINAL attempt, persists a record to `error_log` (NEC-QUEUE-5000) —
 *    this, together with BullMQ's retained failed-set (removeOnFail age), is the
 *    dead-letter / inspection surface (ACP → System → Error Log);
 *  - for critical queues, dispatches a `system.job_failure` notification to all admins.
 *  - logs worker-level errors.
 */
export function attachFailureHandler(worker: Worker, queueName: string): Worker {
  worker.on("failed", (job: Job | undefined, err: Error) => {
    const attempts = job?.opts.attempts ?? 1;
    const made     = job?.attemptsMade ?? 0;
    const isFinal  = made >= attempts;

    logger.warn(
      { queue: queueName, jobId: job?.id, jobName: job?.name, attemptsMade: made, attempts, err: err?.message },
      isFinal ? "Job failed — final attempt, dead-lettered" : "Job failed — will retry",
    );

    if (isFinal) void onFinalFailure(queueName, job, err);
  });

  worker.on("error", (err) => {
    logger.error({ queue: queueName, err: err?.message }, "BullMQ worker error");
  });

  return worker;
}

async function onFinalFailure(queueName: string, job: Job | undefined, err: Error): Promise<void> {
  // Persist to error_log for ACP inspection (fire-and-forget).
  prisma.errorLog.create({
    data: {
      code:     NEC.QUEUE_JOB_FAILED,
      message:  `Job "${job?.name ?? queueName}" failed after exhausting retries: ${err?.message ?? "unknown error"}`,
      severity: CRITICAL_QUEUES.has(queueName) ? "critical" : "error",
      context:  { queue: queueName, jobId: job?.id, jobName: job?.name, data: job?.data ?? null },
    },
  }).catch((e) => logger.error({ queue: queueName, e }, "Failed to write job-failure to error_log"));

  if (!CRITICAL_QUEUES.has(queueName)) return;

  // Page all admins for critical-queue failures.
  try {
    const admins = await prisma.userGroup.findMany({
      where:  { group: { key: "admin" } },
      select: { userId: true },
    });
    await Promise.all(
      [...new Set(admins.map((a) => a.userId))].map((userId) =>
        notificationService.dispatch({
          userId,
          type:     "system.job_failure",
          title:    "Background job failed",
          body:     `A "${queueName}" job failed after exhausting retries. Check System → Error Log.`,
          link:     "/admin/error-log",
          channels: ["in_app", "email"],
        }),
      ),
    );
  } catch (e) {
    logger.error({ queue: queueName, e }, "Failed to notify admins of job failure");
  }
}

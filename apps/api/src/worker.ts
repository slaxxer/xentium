import './config/env.js';
import { bullConnection } from './infrastructure/queue.js';
import { startArticleRevisionCleanupWorker } from './jobs/articleRevisionCleanup.js';
import { startCheckPromotionWorker }          from './jobs/checkPromotion.js';
import { startEmailNotificationWorker }       from './jobs/emailNotification.js';
import { startBanExpiryWorker }               from './jobs/banExpiry.js';
import { startWarningExpiryWorker }           from './jobs/warningExpiry.js';
import { startSecurityAnalysisWorker }        from './jobs/securityAnalysis.js';
import { startLicenseRefreshWorker }          from './jobs/licenseRefresh.js';
import { attachFailureHandler }               from './jobs/jobFailure.js';
import { SCHEDULED_JOBS, getJobConfig, applyJobSchedule } from './jobs/scheduledJobs.js';

// Each worker gets failure logging + dead-letter (error_log) + admin-notify
// reliability handlers (§55). Retry/backoff come from defaultJobOptions.
const workers = [
  attachFailureHandler(startArticleRevisionCleanupWorker(), 'article-revision-cleanup'),
  attachFailureHandler(startCheckPromotionWorker(),         'check-promotion'),
  attachFailureHandler(startEmailNotificationWorker(),      'email-notification'),
  attachFailureHandler(startBanExpiryWorker(),              'ban-expiry'),
  attachFailureHandler(startWarningExpiryWorker(),          'warning-expiry'),
  attachFailureHandler(startSecurityAnalysisWorker(),       'security-analysis'),
  attachFailureHandler(startLicenseRefreshWorker(),         'license-refresh'),
];

// Schedule repeating jobs from the registry, honoring admin config in `settings`
// (ACP → System → Scheduled Tasks). A disabled job is removed from the scheduler.
// A bad saved config never crashes boot — it's logged and that job is skipped.
async function scheduleJobs() {
  for (const def of SCHEDULED_JOBS) {
    try {
      await applyJobSchedule(def, await getJobConfig(def));
    } catch (err) {
      console.error(`[worker] failed to schedule "${def.key}":`, (err as Error)?.message ?? err);
    }
  }
}

scheduleJobs().then(() => {
  console.log(`[worker] up, ${workers.length} worker(s) running, scheduled jobs registered`);
});

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  await bullConnection.quit();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

import './config/env.js';
import type { Worker } from 'bullmq';
import { bullConnection } from './infrastructure/queue.js';
import { startArticleRevisionCleanupWorker } from './jobs/articleRevisionCleanup.js';
import { startCheckPromotionWorker }          from './jobs/checkPromotion.js';
import { startEmailNotificationWorker }       from './jobs/emailNotification.js';
import { startBanExpiryWorker }               from './jobs/banExpiry.js';
import { startWarningExpiryWorker }           from './jobs/warningExpiry.js';
import { startSecurityAnalysisWorker }        from './jobs/securityAnalysis.js';
import { startUpdateCheckWorker, processUpdateCheck } from './jobs/updateCheck.js';
import { processCoreUpdateCheck } from './jobs/coreUpdateCheck.js';
import { processAnnouncementCheck } from './jobs/announcementCheck.js';
import { startLogRetentionWorker }            from './jobs/logRetention.js';
import { startGeoipRefreshWorker }            from './jobs/geoipRefresh.js';
import { startScheduledTaskWorker, reconcileScheduledTasks } from './jobs/scheduledTask.js';
import { attachFailureHandler }               from './jobs/jobFailure.js';
import { SCHEDULED_JOBS, getJobConfig, applyJobSchedule, removeRetiredSchedulers } from './jobs/scheduledJobs.js';
import { initializeEnabledPlugins }           from './core/plugin-engine/plugin-engine.js';

// Each worker gets failure logging + dead-letter (error_log) + admin-notify
// reliability handlers (§55). Retry/backoff come from defaultJobOptions.
//
// A BullMQ worker starts consuming the moment it is constructed, so these are
// built inside boot() AFTER plugins load — never at module scope. A job that
// ran against a half-initialized process would read empty plugin registries and
// reach a wrong answer silently: check-promotion would miss a plugin's
// progression criteria (§38) and promote someone who has not met them, and
// security-analysis would miss plugin scans.
const workers: Worker[] = [];

function startWorkers() {
  workers.push(
    attachFailureHandler(startArticleRevisionCleanupWorker(), 'article-revision-cleanup'),
    attachFailureHandler(startCheckPromotionWorker(),         'check-promotion'),
    attachFailureHandler(startEmailNotificationWorker(),      'email-notification'),
    attachFailureHandler(startBanExpiryWorker(),              'ban-expiry'),
    attachFailureHandler(startWarningExpiryWorker(),          'warning-expiry'),
    attachFailureHandler(startSecurityAnalysisWorker(),       'security-analysis'),
    attachFailureHandler(startUpdateCheckWorker(),            'update-check'),
    attachFailureHandler(startLogRetentionWorker(),           'log-retention'),
    attachFailureHandler(startGeoipRefreshWorker(),           'geoip-refresh'),
    attachFailureHandler(startScheduledTaskWorker(),          'scheduled-task'),
  );
}

// Schedule repeating jobs from the registry, honoring admin config in `settings`
// (ACP → System → Scheduled Tasks). A disabled job is removed from the scheduler.
// A bad saved config never crashes boot — it's logged and that job is skipped.
async function scheduleJobs() {
  // Retired schedulers first: a job definition that no longer exists is never
  // visited by the loop below, so its Redis repeat entry would keep firing into
  // a queue with no worker. Best-effort — a failure here must not stop the jobs
  // that DO exist from being scheduled.
  await removeRetiredSchedulers().catch((err) =>
    console.error('[worker] failed to remove retired schedulers:', (err as Error)?.message ?? err));

  for (const def of SCHEDULED_JOBS) {
    try {
      await applyJobSchedule(def, await getJobConfig(def));
    } catch (err) {
      console.error(`[worker] failed to schedule "${def.key}":`, (err as Error)?.message ?? err);
    }
  }
}

async function boot() {
  // Load enabled plugins in THIS process so their security scans (multi-account
  // detection, impossible travel, …) register before any scan job runs. The
  // security-analysis job executes here in the worker; without this its scan
  // registry is empty and plugin detection never fires. Plugins also (re)schedule
  // their own recurring jobs from onEnable (e.g. the detection sweep).
  try {
    await initializeEnabledPlugins();
  } catch (err) {
    console.error('[worker] plugin init failed:', (err as Error)?.message ?? err);
  }
  startWorkers();
  await scheduleJobs();

  // Converge Redis schedulers with the xcf_scheduled_tasks rows: drop orphans
  // (a task deleted while the worker was down keeps firing otherwise) and
  // re-assert every enabled task. After plugin init for the same reason the
  // workers are — a half-initialized process draws wrong conclusions.
  try {
    await reconcileScheduledTasks();
  } catch (err) {
    console.error('[worker] scheduled-task reconcile failed:', (err as Error)?.message ?? err);
  }
  console.log(`[worker] up, ${workers.length} worker(s) running, plugins loaded, scheduled jobs registered`);

  // Run the update-check HALF of the marketplace sync once on boot so a critical
  // plugin patch surfaces immediately instead of waiting up to ~24h for the next
  // daily run — matters most right after a worker restart following an update
  // deploy. Deliberately NOT the full sync: refreshLicense() has no refreshAfter
  // guard, so including it would call the license server on every restart.
  //
  // The CORE check runs here for the same reason and more so: core is what every
  // plugin runs on. It is a separate call because the plugin half returns early
  // without an account token, and an install that never connected an account
  // still has to hear about a security release.
  // Best-effort and non-blocking (processUpdateCheck self-guards dev/no-token and
  // keeps the last cache when the marketplace is unreachable). Honors the admin's
  // ACP → Scheduled Tasks toggle: if the sync job is disabled, the boot check is
  // skipped too, so turning it off silences update checking entirely.
  const updateDef = SCHEDULED_JOBS.find((d) => d.key === "update-check");
  if (updateDef) {
    getJobConfig(updateDef)
      .then(async (cfg) => {
        if (!cfg.enabled) return;
        await processUpdateCheck();
        await processCoreUpdateCheck();
        // Same argument again for broadcasts: an admin restarting a site after
        // an incident should not have to wait until tomorrow to be told about it.
        await processAnnouncementCheck();
      })
      .catch((err) => console.error('[worker] boot update-check failed:', (err as Error)?.message ?? err));
  }
}

boot();

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  await bullConnection.quit();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

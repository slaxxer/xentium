import { Queue, type JobsOptions } from 'bullmq';
import { bullConnection } from './redis.js';

import { env } from '../config/env.js';

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86_400 },
};

const prefix = `${env.REDIS_KEY_PREFIX}bull`;

const queueOpts = { connection: bullConnection, prefix, defaultJobOptions } as const;

export const queues = {
  articleRevisionCleanup: new Queue('article-revision-cleanup', queueOpts),
  checkPromotion:         new Queue('check-promotion',          queueOpts),
  emailNotification:      new Queue('email-notification',       queueOpts),
  banExpiry:              new Queue('ban-expiry',               queueOpts),
  warningExpiry:          new Queue('warning-expiry',           queueOpts),
  securityAnalysis:       new Queue('security-analysis',        queueOpts),
  licenseRefresh:         new Queue('license-refresh',           queueOpts),
  updateCheck:            new Queue('update-check',              queueOpts),
  // Retired 2026-10-15; kept only so RETIRED_SCHEDULERS can remove its scheduler.
  appearancePublish:      new Queue('appearance-publish',        queueOpts),
  logRetention:           new Queue('log-retention',             queueOpts),
  geoipRefresh:           new Queue('geoip-refresh',             queueOpts),
  // One queue for ALL admin-created tasks; the scheduler id carries the task id.
  scheduledTask:          new Queue('scheduled-task',            queueOpts),
  // Every plugin's background work (ADR-0011); the job data carries the plugin id.
  pluginJobs:             new Queue('plugin-jobs',               queueOpts),
} as const;

export { bullConnection, prefix as bullPrefix, defaultJobOptions as _opts };

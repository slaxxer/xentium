import { Worker } from 'bullmq';
import { bullConnection, bullPrefix } from '../infrastructure/queue.js';
import { sendEmail } from '../infrastructure/email/email.service.js';

export interface EmailNotificationJobData {
  to:      string;
  subject: string;
  html:    string;
}

export function startEmailNotificationWorker() {
  return new Worker<EmailNotificationJobData>(
    'email-notification',
    async (job) => {
      const { to, subject, html } = job.data;
      await sendEmail(to, subject, html);
    },
    {
      connection: bullConnection,
      prefix:     bullPrefix,
    },
  );
}

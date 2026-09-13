import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "@xentium/contracts";
import { getSetting } from "../../shared/utils/settings.js";
import {
  EMAIL_TEMPLATE_DEFAULTS,
  EMAIL_TEMPLATE_KEYS,
  getEffectiveTemplate,
  renderEmailTemplate,
  renderLinkButton,
  type EmailTemplateKey,
} from "../../infrastructure/email/email-templates.js";
import { sendEmail, verifySmtp, isEmailConfigured } from "../../infrastructure/email/email.service.js";

/** Sample values so a test send and the ACP preview show something realistic. */
async function sampleVars(): Promise<Record<string, string>> {
  const siteName = await getSetting<string>("site.name", "Xentium");
  const siteUrl = await getSetting<string>("site.url", "");
  return {
    site_name: siteName,
    site_url: siteUrl,
    username: "example-user",
    title: "A sample notification",
    body: "This is what the body text looks like.",
    link_url: siteUrl || "/",
    link_button: renderLinkButton(siteUrl || "/"),
    reset_url: `${siteUrl}/reset-password?token=sample`,
    code: "123456",
    new_email: "new-address@example.com",
    expiry_minutes: "15",
  };
}

export const emailAdminService = {
  async listTemplates() {
    const rows = await prisma.emailTemplate.findMany();
    const overrides = new Map(rows.map(r => [r.key, r]));
    return EMAIL_TEMPLATE_KEYS.map(key => {
      const def = EMAIL_TEMPLATE_DEFAULTS[key];
      const row = overrides.get(key);
      return {
        key,
        subject: row?.subject ?? def.subject,
        body: row?.body ?? def.body,
        placeholders: def.placeholders,
        customized: !!row,
        updatedAt: row?.updatedAt ?? null,
        // Shipped copy travels with the response so the editor can diff against
        // it and offer Reset without a second round-trip.
        defaultSubject: def.subject,
        defaultBody: def.body,
      };
    });
  },

  async getTemplate(key: EmailTemplateKey) {
    const def = EMAIL_TEMPLATE_DEFAULTS[key];
    if (!def) throw new XentiumError({ code: XEC.EMAIL_TEMPLATE_UNKNOWN, httpStatus: 404, message: "Unknown template" });
    const eff = await getEffectiveTemplate(key);
    return { key, ...eff, placeholders: def.placeholders, defaultSubject: def.subject, defaultBody: def.body };
  },

  async saveTemplate(key: EmailTemplateKey, subject: string, body: string) {
    const row = await prisma.emailTemplate.upsert({
      where: { key },
      update: { subject, body },
      create: { key, subject, body },
    });
    return { key: row.key, subject: row.subject, body: row.body, customized: true, updatedAt: row.updatedAt };
  },

  /**
   * Reset deletes the override rather than writing the shipped copy back, so
   * the template resumes tracking future changes to the default instead of
   * being pinned to today's wording.
   */
  async resetTemplate(key: EmailTemplateKey) {
    await prisma.emailTemplate.deleteMany({ where: { key } });
    const def = EMAIL_TEMPLATE_DEFAULTS[key];
    return { key, subject: def.subject, body: def.body, customized: false, updatedAt: null };
  },

  /** Render with sample data — used by the ACP preview. */
  async preview(key: EmailTemplateKey) {
    return renderEmailTemplate(key, await sampleVars());
  },

  async sendTest(to: string, key: EmailTemplateKey) {
    if (!(await isEmailConfigured())) {
      throw new XentiumError({
        code: XEC.EMAIL_NOT_CONFIGURED,
        httpStatus: 400,
        message: "No SMTP host configured.",
      });
    }
    // Surface a bad host/port as a clear error instead of a generic send failure.
    const check = await verifySmtp();
    if (!check.ok) {
      throw new XentiumError({
        code: XEC.EMAIL_SEND_FAILED,
        httpStatus: 502,
        message: `SMTP connection failed: ${check.error ?? "unknown"}`,
      });
    }
    const { subject, html } = await renderEmailTemplate(key, await sampleVars());
    try {
      await sendEmail(to, subject, html);
    } catch (e) {
      throw new XentiumError({
        code: XEC.EMAIL_SEND_FAILED,
        httpStatus: 502,
        message: e instanceof Error ? e.message : "Send failed",
      });
    }
    return { sent: true, to, key, subject };
  },

  async smtpStatus() {
    const configured = await isEmailConfigured();
    if (!configured) return { configured: false, reachable: false, error: null as string | null };
    const check = await verifySmtp();
    return { configured: true, reachable: check.ok, error: check.error ?? null };
  },
};

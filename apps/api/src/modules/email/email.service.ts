import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "@xentium/contracts";
import {
  EMAIL_TEMPLATE_DEFAULTS,
  EMAIL_TEMPLATE_KEYS,
  defaultTemplate,
  getEffectiveTemplate,
  isLegacyBody,
  renderEmailTemplate,
  siteVars,
  renderEmailBody,
  getEmailDesign,
  normalizeEmailDesign,
  type EmailDesign,
  type EmailTemplateKey,
} from "../../infrastructure/email/email-templates.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { sendEmail, verifySmtp, isEmailConfigured } from "../../infrastructure/email/email.service.js";
import { SERVER_LOCALES, type ServerLocale } from "../../shared/i18n/serverText.js";

/** The shipped subject + body in every language, so the ACP shows the admin's own. */
function shippedDefaults(key: EmailTemplateKey) {
  return Object.fromEntries(SERVER_LOCALES.map((l) => {
    const d = defaultTemplate(key, l);
    return [l, { subject: d.subject, body: d.body }];
  }));
}

/** Saving one of the shipped versions unchanged is not a customisation: it keeps following the reader's language. */
function isShippedCopy(key: EmailTemplateKey, subject: string, body: string): boolean {
  return SERVER_LOCALES.some((l) => {
    const d = defaultTemplate(key, l);
    return d.subject === subject && d.body === body;
  });
}

/** Sample values so a test send and the ACP preview show something realistic. */
async function sampleVars(): Promise<Record<string, string>> {
  const site = await siteVars();
  const siteUrl = site.site_url;
  return {
    ...site,
    username: "example-user",
    title: "A sample notification",
    body: "This is what the body text looks like.",
    link_url: siteUrl || "/",
    reset_url: `${siteUrl}/reset-password?token=sample`,
    login_url: `${siteUrl}/auth/magic?token=sample`,
    code: "123456",
    new_email: "new-address@example.com",
    expiry_minutes: "15",
    request_time: new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date()),
    request_device: "Chrome 141 · macOS",
    request_location: "Germany",
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
        // Saved as a whole HTML document by an older version: sent as written,
        // not editable as content (the ACP offers Reset instead).
        legacy: isLegacyBody(row?.body ?? def.body),
        updatedAt: row?.updatedAt ?? null,
        // Shipped copy travels with the response so the editor can diff against
        // it and offer Reset without a second round-trip.
        defaultSubject: def.subject,
        defaultBody: def.body,
        // Untouched templates go out in each recipient's language; the ACP edits from its own.
        defaults: shippedDefaults(key),
      };
    });
  },

  async getTemplate(key: EmailTemplateKey) {
    const def = EMAIL_TEMPLATE_DEFAULTS[key];
    if (!def) throw new XentiumError({ code: XEC.EMAIL_TEMPLATE_UNKNOWN, httpStatus: 404, message: "Unknown template" });
    const eff = await getEffectiveTemplate(key);
    return { key, ...eff, legacy: isLegacyBody(eff.body), placeholders: def.placeholders, defaultSubject: def.subject, defaultBody: def.body };
  },

  async saveTemplate(key: EmailTemplateKey, subject: string, body: string) {
    if (isShippedCopy(key, subject, body)) return this.resetTemplate(key);
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
  async preview(key: EmailTemplateKey, locale: ServerLocale = "en") {
    return renderEmailTemplate(key, await sampleVars(), locale);
  },

  /** The design and whether the site has a logo a mail client can show (the "logo" header needs one). */
  async getDesign() {
    return { design: await getEmailDesign(), logoAvailable: !!(await siteVars()).site_logo_url };
  },

  async saveDesign(input: EmailDesign) {
    const design = normalizeEmailDesign(input);
    await prisma.setting.upsert({
      where: { key: "email.design" },
      update: { value: design as object },
      create: { key: "email.design", value: design as object },
    });
    bustSettingsCache("email.design");
    return { design };
  },

  /** A draft design on the password-reset mail as this site sends it — the ACP's live preview. */
  async previewDesign(input: EmailDesign, locale: ServerLocale = "en") {
    const tpl = await getEffectiveTemplate("password_reset", locale);
    return { html: renderEmailBody(tpl.body, await sampleVars(), locale, normalizeEmailDesign(input)) };
  },

  async sendTest(to: string, key: EmailTemplateKey, locale: ServerLocale = "en") {
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
    const { subject, html } = await renderEmailTemplate(key, await sampleVars(), locale);
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

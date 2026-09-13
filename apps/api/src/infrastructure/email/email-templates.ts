import { prisma } from "../db.js";
import { getSetting } from "../../shared/utils/settings.js";

/**
 * Outbound mail templates.
 *
 * Defaults live here in code; a row in `ncf_email_templates` overrides one key.
 * Absence of a row is valid and means "use the shipped default" — which is also
 * what Reset restores, by deleting the row rather than writing the default back.
 * That way a template an admin never touched keeps tracking future improvements
 * to the shipped copy instead of being frozen at the version they first saw.
 *
 * Placeholders are `{{name}}`. The TEMPLATE is trusted (an admin wrote it, and
 * editing it already requires admin.access), but the VALUES are not: notification
 * titles carry user content such as forum thread names, so every substituted
 * value is HTML-escaped. Without that, a thread called `<a href=…>` would inject
 * markup into a trusted-looking email — a phishing vector.
 */

export const EMAIL_TEMPLATE_KEYS = [
  "notification",
  "password_reset",
  "email_verify",
  "email_change",
  "smtp_test",
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export interface EmailTemplateDef {
  subject: string;
  body: string;
  /** Advertised to the ACP so admins see what they can use. */
  placeholders: readonly string[];
}

const SHELL_OPEN =
  `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">`;
const BRAND =
  `<div style="margin-bottom:24px"><span style="font-size:20px;font-weight:800;letter-spacing:-0.03em">{{site_name}}</span></div>`;

export const EMAIL_TEMPLATE_DEFAULTS: Record<EmailTemplateKey, EmailTemplateDef> = {
  notification: {
    subject: "{{title}} — {{site_name}}",
    placeholders: ["site_name", "site_url", "title", "body", "link_url", "link_button", "username"],
    body: `${SHELL_OPEN}
  ${BRAND}
  <h2 style="font-size:20px;font-weight:700;margin:0 0 10px;color:#0d0d22">{{title}}</h2>
  <p style="color:#4a4a7a;margin:0 0 20px;line-height:1.6;font-size:15px">{{body}}</p>
  {{link_button}}
  <hr style="border:none;border-top:1px solid #e7e7f1;margin:28px 0 16px">
  <p style="color:#9ca3af;font-size:12px;margin:0">
    You're receiving this because you have notifications enabled. Manage your preferences in Account Settings.
  </p>
</div>`,
  },

  password_reset: {
    subject: "Reset your {{site_name}} password",
    placeholders: ["site_name", "site_url", "reset_url", "username", "expiry_minutes"],
    body: `${SHELL_OPEN}
  ${BRAND}
  <h2 style="font-size:22px;font-weight:700;margin:0 0 8px">Reset your password</h2>
  <p style="color:#6b7280;margin:0 0 24px;line-height:1.6">
    We received a request to reset your password. Click the button below to choose a new one.
    This link expires in {{expiry_minutes}} minutes and can only be used once.
  </p>
  <a href="{{reset_url}}" style="display:inline-block;background:#7c6af7;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:14px">Reset password →</a>
  <p style="color:#9ca3af;font-size:13px;margin:24px 0 0">
    If you didn't request this, you can safely ignore this email — your password will stay the same.
  </p>
</div>`,
  },

  email_verify: {
    subject: "Verify your email — {{site_name}}",
    placeholders: ["site_name", "site_url", "code", "username", "expiry_minutes"],
    body: `${SHELL_OPEN}
  ${BRAND}
  <h2 style="font-size:22px;font-weight:700;margin:0 0 8px">Verify your email</h2>
  <p style="color:#6b7280;margin:0 0 28px;line-height:1.6">
    Enter this code in the registration form to complete your account setup.
    It expires in {{expiry_minutes}} minutes.
  </p>
  <div style="background:#f5f5fb;border:1px solid #e7e7f1;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px">
    <span style="font-size:36px;font-weight:800;letter-spacing:0.18em;color:#1a1a2e">{{code}}</span>
  </div>
  <p style="color:#9ca3af;font-size:13px;margin:0">
    If you didn't request this, you can safely ignore this email.
  </p>
</div>`,
  },

  email_change: {
    subject: "Your email change verification code — {{site_name}}",
    placeholders: ["site_name", "site_url", "code", "username", "new_email", "expiry_minutes"],
    body: `${SHELL_OPEN}
  ${BRAND}
  <h2 style="font-size:22px;font-weight:700;margin:0 0 8px">Confirm your new email</h2>
  <p style="color:#6b7280;margin:0 0 28px;line-height:1.6">
    Enter this code to confirm {{new_email}} as your new email address.
    It expires in {{expiry_minutes}} minutes.
  </p>
  <div style="background:#f5f5fb;border:1px solid #e7e7f1;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px">
    <span style="font-size:36px;font-weight:800;letter-spacing:0.18em;color:#1a1a2e">{{code}}</span>
  </div>
  <p style="color:#9ca3af;font-size:13px;margin:0">
    If you didn't request this, you can safely ignore this email — your address is unchanged.
  </p>
</div>`,
  },

  smtp_test: {
    subject: "SMTP test — {{site_name}}",
    placeholders: ["site_name", "site_url"],
    body: `${SHELL_OPEN}
  ${BRAND}
  <h2 style="font-size:22px;font-weight:700;margin:0 0 8px">Outbound mail works</h2>
  <p style="color:#6b7280;margin:0 0 24px;line-height:1.6">
    This is the test message from {{site_name}}. If you are reading it, the SMTP
    settings in your ACP are correct and mail is leaving the server.
  </p>
  <p style="color:#9ca3af;font-size:13px;margin:0">Sent from {{site_url}}</p>
</div>`,
  },
};

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Absolute http(s) or a root-relative path only — never protocol-relative
 * ("//evil.test") and never javascript:/data: URIs, which would otherwise be
 * reachable through any placeholder that lands in an href.
 */
export function isSafeUrl(v: string): boolean {
  return /^https?:\/\//i.test(v) || /^\/(?!\/)/.test(v);
}

const URL_PLACEHOLDER = /(^|_)url$/;

/**
 * Replace `{{name}}` with the escaped value. Unknown placeholders are left
 * untouched rather than blanked, so a typo shows up plainly in a test send
 * instead of silently producing an empty sentence.
 */
export function substitutePlaceholders(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, rawName: string) => {
    const name = rawName.toLowerCase();
    if (!(name in vars)) return whole;
    const value = vars[name] ?? "";
    // `_button` placeholders are host-rendered HTML fragments, not user data.
    if (name.endsWith("_button")) return value;
    if (URL_PLACEHOLDER.test(name)) return escapeHtml(isSafeUrl(value) ? value : "");
    return escapeHtml(value);
  });
}

export function isEmailTemplateKey(v: string): v is EmailTemplateKey {
  return (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(v);
}

/** The effective template: the admin override if one exists, else the default. */
export async function getEffectiveTemplate(
  key: EmailTemplateKey,
): Promise<{ subject: string; body: string; customized: boolean }> {
  const row = await prisma.emailTemplate.findUnique({ where: { key } });
  if (row) return { subject: row.subject, body: row.body, customized: true };
  const def = EMAIL_TEMPLATE_DEFAULTS[key];
  return { subject: def.subject, body: def.body, customized: false };
}

/** Render a template to a ready-to-send subject + html. */
export async function renderEmailTemplate(
  key: EmailTemplateKey,
  vars: Record<string, string | undefined>,
): Promise<{ subject: string; html: string }> {
  const tpl = await getEffectiveTemplate(key);
  return {
    // Subjects are plain text; escaping there would surface literal &amp; in
    // the client's subject line, so strip tags instead.
    subject: substitutePlaceholders(tpl.subject, vars).replace(/<[^>]*>/g, "").trim(),
    html: substitutePlaceholders(tpl.body, vars),
  };
}

/**
 * Site identity every template can use. `site.name` / `site.url` are the same
 * values the frontend renders in canonical meta, so branded mail follows what
 * the site publicly calls itself rather than a build-time constant.
 */
export async function siteVars(): Promise<{ site_name: string; site_url: string }> {
  return {
    site_name: await getSetting<string>("site.name", "Xentium"),
    site_url: (await getSetting<string>("site.url", "")).replace(/\/$/, ""),
  };
}

/** The purple CTA used by the notification default when a link is present. */
export function renderLinkButton(url: string | undefined, label = "View →"): string {
  if (!url || !isSafeUrl(url)) return "";
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:#7c6af7;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;font-size:14px;margin-top:8px">${escapeHtml(label)}</a>`;
}

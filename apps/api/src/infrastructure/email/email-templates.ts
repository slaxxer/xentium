import { prisma } from "../db.js";
import { getSetting } from "../../shared/utils/settings.js";
import { serverText, type ServerLocale } from "../../shared/i18n/serverText.js";

/**
 * Outbound mail templates.
 *
 * Defaults live here in code; a row in `xcf_email_templates` overrides one key.
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
  "magic_link",
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

/*
 * A template body is CONTENT — headings, paragraphs, lists, links — written in the
 * ACP with our editor. The frame around it (width, font, brand line) and the
 * inline styles email clients need are added here at send time, so an admin
 * formats a message without writing HTML and every message keeps one look.
 *
 * Buttons and the code box are placeholders (`{{reset_button}}`, `{{code_box}}`):
 * markup no editor should be asked to author, rendered from their value here.
 *
 * The frame paints its OWN background: a white card on a grey page, as tables with
 * `bgcolor`, which every client honours. Without it a dark-mode client (iCloud,
 * Gmail, Outlook) puts its own near-black behind our dark text and the mail is
 * unreadable; the colours below assume the white card.
 */
const FONT = "font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FRAME_OPEN =
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f1f6" style="background-color:#f1f1f6;color-scheme:light;${FONT}">` +
  `<tr><td align="center" style="padding:32px 16px">` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:520px;background-color:#ffffff;border:1px solid #e7e7f1;border-top:4px solid #7c6af7;border-radius:12px">` +
  `<tr><td style="padding:28px 32px 12px">` +
  `<div style="margin-bottom:24px"><span style="font-size:20px;font-weight:800;letter-spacing:-0.03em;color:#0d0d22">{{site_name}}</span></div>`;

/** Closes the card; below it, the site's name and address in small grey type. */
function frameClose(vars: Record<string, string | undefined>): string {
  const url = vars.site_url && isSafeUrl(vars.site_url) ? vars.site_url : "";
  const site = url
    ? `{{site_name}} · <a href="{{site_url}}" style="color:#8a8aa8;text-decoration:underline">${escapeHtml(url.replace(/^https?:\/\//i, ""))}</a>`
    : "{{site_name}}";
  return `</td></tr></table>` +
    `<div style="max-width:520px;margin:0 auto;padding:16px 8px 0;font-size:12px;line-height:1.5;color:#8a8aa8;text-align:center">${site}</div>` +
    `</td></tr></table>`;
}

/** What each template can use; the texts themselves live in `locales/<lng>/email.json`. */
const PLACEHOLDERS: Record<EmailTemplateKey, readonly string[]> = {
  notification:   ["site_name", "site_url", "title", "body", "link_url", "link_button", "username"],
  password_reset: ["site_name", "site_url", "reset_url", "reset_button", "username", "expiry_minutes"],
  magic_link:     ["site_name", "site_url", "login_url", "login_button", "username", "expiry_minutes"],
  email_verify:   ["site_name", "site_url", "code", "code_box", "username", "expiry_minutes"],
  email_change:   ["site_name", "site_url", "code", "code_box", "username", "new_email", "expiry_minutes"],
  smtp_test:      ["site_name", "site_url"],
};

/** The shipped template in one language (English when that language lacks it). */
export function defaultTemplate(key: EmailTemplateKey, locale: ServerLocale = "en"): EmailTemplateDef {
  return {
    subject:      serverText(locale, "email", `templates.${key}.subject`),
    body:         serverText(locale, "email", `templates.${key}.body`),
    placeholders: PLACEHOLDERS[key],
  };
}

/** The shipped templates in English — the source language. */
export const EMAIL_TEMPLATE_DEFAULTS: Record<EmailTemplateKey, EmailTemplateDef> =
  Object.fromEntries(EMAIL_TEMPLATE_KEYS.map((k) => [k, defaultTemplate(k)])) as Record<EmailTemplateKey, EmailTemplateDef>;

/**
 * A body saved before templates became editor content: a whole HTML document with
 * its own inline-styled wrapper. It is sent exactly as written, never framed twice,
 * and the ACP offers Reset rather than loading it into the editor.
 */
export function isLegacyBody(body: string): boolean {
  return /^\s*<div\s+style=/i.test(body);
}

/** Inline styles for what the editor writes; Gmail ignores <style> blocks, so every tag carries its own. */
const CONTENT_STYLES: Record<string, string> = {
  h1: "font-size:24px;font-weight:700;margin:0 0 10px;color:#0d0d22",
  h2: "font-size:20px;font-weight:700;margin:0 0 10px;color:#0d0d22",
  h3: "font-size:16px;font-weight:700;margin:0 0 8px;color:#0d0d22",
  p: "color:#4a4a7a;margin:0 0 16px;line-height:1.6;font-size:15px",
  ul: "color:#4a4a7a;margin:0 0 16px;padding-left:22px;line-height:1.6;font-size:15px",
  ol: "color:#4a4a7a;margin:0 0 16px;padding-left:22px;line-height:1.6;font-size:15px",
  li: "margin:0 0 4px",
  blockquote: "margin:0 0 16px;padding:8px 14px;border-left:3px solid #e7e7f1;color:#6b7280",
  hr: "border:none;border-top:1px solid #e7e7f1;margin:24px 0 16px",
  a: "color:#7c6af7",
  code: "font-family:ui-monospace,monospace;background:#f5f5fb;padding:1px 5px;border-radius:4px",
};

/** Give each known tag its email style, ahead of any style it already carries (alignment). */
export function styleContent(html: string): string {
  return html.replace(/<(h1|h2|h3|p|ul|ol|li|blockquote|hr|a|code)(\s[^>]*)?>/gi, (whole, tag: string, attrs = "") => {
    const base = CONTENT_STYLES[tag.toLowerCase()];
    if (!base) return whole;
    if (/\sstyle\s*=\s*"/i.test(attrs)) {
      return `<${tag}${attrs.replace(/\sstyle\s*=\s*"/i, ` style="${base};`)}>`;
    }
    return `<${tag}${attrs} style="${base}">`;
  });
}

/** A block placeholder alone in a paragraph stands in for that paragraph (no <div> inside <p>). */
function unwrapBlockPlaceholders(html: string): string {
  return html.replace(/<p(?:\s[^>]*)?>\s*(\{\{\s*[a-z0-9_]+_(?:button|box)\s*\}\})\s*<\/p>/gi, "$1");
}

/** The large one-time code, centred in its box. */
export function renderCodeBox(code: string | undefined): string {
  if (!code) return "";
  return `<div style="background:#f5f5fb;border:1px solid #e7e7f1;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px">` +
    `<span style="font-size:36px;font-weight:800;letter-spacing:0.18em;color:#1a1a2e">${escapeHtml(code)}</span></div>`;
}

/** Buttons and boxes rendered from the values they stand for, unless the caller sent its own. */
function blockVars(vars: Record<string, string | undefined>, locale: ServerLocale): Record<string, string> {
  return {
    reset_button: renderLinkButton(vars.reset_url, serverText(locale, "email", "buttons.reset")),
    login_button: renderLinkButton(vars.login_url, serverText(locale, "email", "buttons.signIn")),
    code_box:     renderCodeBox(vars.code),
  };
}

/** Content → a ready-to-send body: styled, placeholders filled, inside the frame. */
export function renderEmailBody(body: string, vars: Record<string, string | undefined>, locale: ServerLocale = "en"): string {
  const all = { ...blockVars(vars, locale), ...vars };
  if (isLegacyBody(body)) return substitutePlaceholders(body, all);
  return substitutePlaceholders(FRAME_OPEN + styleContent(unwrapBlockPlaceholders(body)) + frameClose(all), all);
}

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
    // `_button` / `_box` placeholders are host-rendered HTML fragments, not user data.
    if (name.endsWith("_button") || name.endsWith("_box")) return value;
    if (URL_PLACEHOLDER.test(name)) return escapeHtml(isSafeUrl(value) ? value : "");
    return escapeHtml(value);
  });
}

export function isEmailTemplateKey(v: string): v is EmailTemplateKey {
  return (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(v);
}

/**
 * The effective template: the admin's own version if there is one (sent as written,
 * in whatever language they wrote it), else the shipped one in `locale`.
 */
export async function getEffectiveTemplate(
  key: EmailTemplateKey,
  locale: ServerLocale = "en",
): Promise<{ subject: string; body: string; customized: boolean }> {
  const row = await prisma.emailTemplate.findUnique({ where: { key } });
  if (row) return { subject: row.subject, body: row.body, customized: true };
  const def = defaultTemplate(key, locale);
  return { subject: def.subject, body: def.body, customized: false };
}

/** Render a template to a ready-to-send subject + html. */
export async function renderEmailTemplate(
  key: EmailTemplateKey,
  vars: Record<string, string | undefined>,
  locale: ServerLocale = "en",
): Promise<{ subject: string; html: string }> {
  const tpl = await getEffectiveTemplate(key, locale);
  return {
    // Subjects are plain text; escaping there would surface literal &amp; in
    // the client's subject line, so strip tags instead.
    subject: substitutePlaceholders(tpl.subject, vars).replace(/<[^>]*>/g, "").trim(),
    html: renderEmailBody(tpl.body, vars, locale),
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
  return `<p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#7c6af7;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;font-size:14px">${escapeHtml(label)}</a></p>`;
}

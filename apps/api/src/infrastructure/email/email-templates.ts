import { prisma } from "../db.js";
import { getSetting } from "../../shared/utils/settings.js";
import { serverText, type ServerLocale } from "../../shared/i18n/serverText.js";
import { sanitizeRichText } from "../../shared/sanitize/richText.js";
import { describeUserAgent } from "@xentium/contracts";
import { countryOf } from "../geoip.js";
import { siteZone } from "../../core/plugin-platform/time.js";

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
  "security_alert",
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
// Poppins where the reader has it, then fonts every client has. No web-font link:
// it would make every opened mail ask Google for a file, which tells Google who read it.
const FONT = "font-family:Poppins,'Trebuchet MS',Helvetica,Arial,sans-serif";
/** Ink on the white card, quiet grey for the small print, and the page under the card. */
const INK = "#141716";
const TEXT = "#4a5250";
const QUIET = "#6b7370";
const FAINT = "#8a918e";

/**
 * How this site's emails look, set in ACP → Email → Design (setting `email.design`).
 * Only these four things: the card stays white and the text dark, because those are
 * what keep a mail readable in every client — an admin picks the brand, not the ink.
 * Colours land in inline styles, so they are checked on the way OUT too
 * (`normalizeEmailDesign`), not only when saved: a settings row can come from a
 * restored backup or a hand-edited database.
 */
export const EMAIL_HEADERS = ["icon", "logo", "name"] as const;
export type EmailHeader = (typeof EMAIL_HEADERS)[number];
export interface EmailDesign {
  /** The line along the top of the card, buttons and links. */
  accent: string;
  /** The page around the card. */
  page: string;
  /** icon = the site icon beside its name; logo = the uploaded logo alone; name = text only. */
  header: EmailHeader;
  /**
   * A note under the card (an address, a sign-off), written with our editor: HTML.
   * A note saved before the editor is plain text and still shows as written.
   */
  footer: string;
  /**
   * Where "contact support" points: a web address or an email address. Empty = the
   * words without a link (`{{support_link}}`).
   */
  support: string;
}
export const EMAIL_DESIGN_DEFAULTS: EmailDesign = { accent: "#14796b", page: "#eef1ef", header: "icon", footer: "", support: "" };
export const EMAIL_FOOTER_MAX = 4000;
export const EMAIL_SUPPORT_MAX = 300;
const EMAIL_ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** The support link's address: an http(s) URL as it is, an email address as mailto:, else "". */
export function supportHref(raw: string): string {
  const v = raw.trim();
  if (/^https?:\/\/[^\s<>"]+$/i.test(v)) return v;
  if (EMAIL_ADDRESS.test(v)) return `mailto:${v}`;
  return "";
}
const HEX = /^#[0-9a-f]{6}$/i;

export function normalizeEmailDesign(raw: unknown): EmailDesign {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hex = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : d);
  return {
    accent: hex(r.accent, EMAIL_DESIGN_DEFAULTS.accent),
    page:   hex(r.page, EMAIL_DESIGN_DEFAULTS.page),
    header: (EMAIL_HEADERS as readonly unknown[]).includes(r.header) ? (r.header as EmailHeader) : EMAIL_DESIGN_DEFAULTS.header,
    footer: typeof r.footer === "string" ? r.footer.slice(0, EMAIL_FOOTER_MAX) : "",
    support: typeof r.support === "string" && supportHref(r.support.slice(0, EMAIL_SUPPORT_MAX)) ? r.support.trim().slice(0, EMAIL_SUPPORT_MAX) : "",
  };
}

export async function getEmailDesign(): Promise<EmailDesign> {
  return normalizeEmailDesign(await getSetting<unknown>("email.design", null));
}

/** White or dark ink, whichever reads on `hex` — so any accent keeps a legible button. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // White while it keeps 3:1 (the bar for bold button text), as buttons are usually
  // white-on-colour; only a genuinely light accent gets the dark ink.
  return 1.05 / (L + 0.05) >= 3 ? "#ffffff" : "#0d0d22";
}

/**
 * Opens the card: a band in the accent with the brand line and the message's
 * heading, then the white body. Images are PNG/JPEG/GIF from the site itself
 * (`site_icon_url`, `site_logo_url`, see `siteVars`) because Gmail and Outlook show
 * no SVG; without one the line falls back to the name, so it is never empty.
 * `preheader` is the line mail apps show beside the subject in the inbox.
 */
function frameOpen(vars: Record<string, string | undefined>, design: EmailDesign, heading: string, preheader: string): string {
  const safe = (v: string | undefined) => !!v && isSafeUrl(v);
  const ink = inkOn(design.accent);
  const name = `<td style="${FONT};font-size:17px;font-weight:700;color:${ink}">{{site_name}}</td>`;
  let brand = name;
  if (design.header === "logo" && safe(vars.site_logo_url)) {
    brand = `<td><img src="{{site_logo_url}}" height="32" alt="{{site_name}}" style="display:block;height:32px;width:auto;max-width:240px;border:0"></td>`;
  } else if (design.header !== "name" && safe(vars.site_icon_url)) {
    brand = `<td width="30" style="padding:0 12px 0 0;vertical-align:middle"><img src="{{site_icon_url}}" width="30" height="30" alt="" style="display:block;width:30px;height:30px;border:0;border-radius:8px"></td>` + name;
  }
  const band = `bgcolor="${design.accent}" style="background-color:${design.accent};`;
  const hidden = preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${preheader}</div>`
    : "";
  // Narrower sides and a smaller heading on a phone, where the client reads <style>
  // (Apple Mail, iOS, Gmail's apps); everywhere else the inline values stand.
  const phone = `<style>@media screen and (max-width:600px){.xt-px{padding-left:24px!important;padding-right:24px!important}.xt-h1{font-size:24px!important;line-height:30px!important}}</style>`;
  return phone + hidden +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${design.page}" style="background-color:${design.page};color-scheme:light;${FONT}">` +
    `<tr><td align="center" style="padding:48px 16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:520px;background-color:#ffffff;border-radius:12px;${FONT}">` +
    `<tr><td class="xt-px" ${band}padding:28px 40px ${heading ? "0" : "28px"};border-radius:12px 12px 0 0">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${brand}</tr></table></td></tr>` +
    (heading
      ? `<tr><td class="xt-px xt-h1" ${band}padding:20px 40px 36px;${FONT};font-size:28px;line-height:34px;font-weight:700;color:${ink}">${heading}</td></tr>`
      : "") +
    `<tr><td class="xt-px" style="padding:32px 40px 36px;${FONT}">`;
}

/** Closes the card; below it, the admin's note, then who sent it, in small grey type. */
function frameClose(vars: Record<string, string | undefined>, design: EmailDesign, locale: ServerLocale): string {
  const url = vars.site_url && isSafeUrl(vars.site_url) ? vars.site_url : "";
  const site = url
    ? `{{site_name}} &middot; <a href="{{site_url}}" style="color:${FAINT};text-decoration:underline">${escapeHtml(url.replace(/^https?:\/\//i, ""))}</a>`
    : "{{site_name}}";
  const footer = footerNote(design.footer, design.accent);
  const note = footer ? `<div style="margin:0 0 8px">${footer}</div>` : "";
  return `</td></tr></table>` +
    `<div style="max-width:520px;margin:0 auto;padding:24px 8px 0;${FONT};font-size:12px;line-height:18px;color:${FAINT};text-align:center">${note}${serverText(locale, "email", "sentBy", { site })}</div>` +
    `</td></tr></table>`;
}

/** The footer's own scale: small grey type, so headings and paragraphs stay a note. */
const FOOTER_STYLES: Record<string, string> = {
  h1: "font-size:14px;font-weight:700;margin:0 0 4px",
  h2: "font-size:13px;font-weight:700;margin:0 0 4px",
  h3: "font-size:12px;font-weight:700;margin:0 0 4px",
  p: "margin:0 0 4px",
  ul: "margin:0 0 4px;padding-left:18px;text-align:left",
  ol: "margin:0 0 4px;padding-left:18px;text-align:left",
  li: "margin:0",
  blockquote: "margin:0 0 4px;padding:2px 10px;border-left:2px solid #e7e7f1",
  hr: "border:none;border-top:1px solid #e7e7f1;margin:8px 0",
  code: "font-family:ui-monospace,monospace",
};

/**
 * The admin's footer note as email HTML, or "" when it says nothing. Editor HTML is
 * cleaned with the rich-text allowlist (the row can come from a backup or a
 * hand-edited database, like the colours); plain text from before the editor is
 * escaped with its line breaks kept.
 */
export function footerNote(raw: string, accent = EMAIL_DESIGN_DEFAULTS.accent): string {
  const text = raw.trim();
  if (!text) return "";
  if (!text.startsWith("<")) return escapeHtml(text).replace(/\r?\n/g, "<br>");
  const clean = sanitizeRichText(text);
  if (!clean.replace(/<[^>]*>|&nbsp;/g, "").trim()) return "";
  return styleContent(clean, accent, FOOTER_STYLES);
}

/** What each template can use; the texts themselves live in `locales/<lng>/email.json`. */
const PLACEHOLDERS: Record<EmailTemplateKey, readonly string[]> = {
  notification:   ["site_name", "site_url", "title", "body", "link_url", "link_button", "username"],
  password_reset: ["site_name", "site_url", "reset_url", "reset_button", "username", "expiry_minutes",
                   "request_box", "request_time", "request_device", "request_location", "support_link"],
  magic_link:     ["site_name", "site_url", "login_url", "login_button", "username", "expiry_minutes"],
  email_verify:   ["site_name", "site_url", "code", "code_box", "username", "expiry_minutes"],
  email_change:   ["site_name", "site_url", "code", "code_box", "username", "new_email", "expiry_minutes"],
  security_alert: ["site_name", "site_url", "username", "event", "detail",
                   "request_box", "request_time", "request_device", "request_location", "support_link"],
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
  h1: `font-size:22px;line-height:28px;font-weight:700;margin:0 0 12px;color:${INK}`,
  h2: `font-size:19px;line-height:26px;font-weight:700;margin:0 0 10px;color:${INK}`,
  h3: `font-size:16px;line-height:22px;font-weight:700;margin:0 0 8px;color:${INK}`,
  p: `color:${TEXT};margin:0 0 16px;line-height:24px;font-size:15px`,
  ul: `color:${TEXT};margin:0 0 16px;padding-left:22px;line-height:24px;font-size:15px`,
  ol: `color:${TEXT};margin:0 0 16px;padding-left:22px;line-height:24px;font-size:15px`,
  li: "margin:0 0 4px",
  blockquote: `margin:0 0 16px;padding:8px 14px;border-left:3px solid #e3e8e6;color:${QUIET}`,
  hr: "border:none;border-top:1px solid #e3e8e6;margin:24px 0 16px",
  code: "font-family:ui-monospace,monospace;background:#f5f7f6;padding:1px 5px;border-radius:4px",
};

/**
 * What follows the first line (`<hr>`) is the small print: "Not you?", why this mail
 * came. Smaller and quieter, and the line itself only makes the space.
 */
const FINE_STYLES: Record<string, string> = {
  ...CONTENT_STYLES,
  p: `color:${QUIET};margin:0 0 8px;line-height:20px;font-size:13px`,
  ul: `color:${QUIET};margin:0 0 8px;padding-left:18px;line-height:20px;font-size:13px`,
  ol: `color:${QUIET};margin:0 0 8px;padding-left:18px;line-height:20px;font-size:13px`,
};

/** Give each known tag its email style, ahead of any style it already carries (alignment). */
export function styleContent(html: string, accent = EMAIL_DESIGN_DEFAULTS.accent, styles = CONTENT_STYLES): string {
  return html.replace(/<(h1|h2|h3|p|ul|ol|li|blockquote|hr|a|code)(\s[^>]*)?>/gi, (whole, tag: string, attrs = "") => {
    const t = tag.toLowerCase();
    const base = t === "a" ? `color:${accent}` : styles[t];
    if (!base) return whole;
    if (/\sstyle\s*=\s*"/i.test(attrs)) {
      return `<${tag}${attrs.replace(/\sstyle\s*=\s*"/i, ` style="${base};`)}>`;
    }
    return `<${tag}${attrs} style="${base}">`;
  });
}

/**
 * Where a request came from (`{{request_box}}`): time, device and place, each row
 * only when known. A reset an admin started has none of them, and no box.
 */
export function renderRequestBox(vars: Record<string, string | undefined>, locale: ServerLocale): string {
  const rows = (["time", "device", "location"] as const)
    .map((k) => [serverText(locale, "email", `request.${k}`), vars[`request_${k}`]?.trim() ?? ""] as const)
    .filter(([, v]) => v);
  if (!rows.length) return "";
  const cell = `${FONT};font-size:13px;line-height:18px`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f7f6" style="background-color:#f5f7f6;border-radius:8px;margin:0 0 20px">` +
    `<tr><td colspan="2" style="padding:16px 20px 4px;${FONT};font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:${QUIET}">${escapeHtml(serverText(locale, "email", "request.title"))}</td></tr>` +
    rows.map(([label, value], i) => {
      const bottom = i === rows.length - 1 ? "16px" : "6px";
      return `<tr><td width="90" style="padding:6px 20px ${bottom};${cell};color:${QUIET}">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 20px ${bottom} 0;${cell};color:${INK}">${escapeHtml(value)}</td></tr>`;
    }).join("") +
    `</table>`;
}

/** "contact support", linked to ACP → Email → Design's address, or just the words. */
export function renderSupportLink(design: EmailDesign, locale: ServerLocale, accent: string): string {
  const label = escapeHtml(serverText(locale, "email", "supportLink"));
  const href = supportHref(design.support);
  return href ? `<a href="${escapeHtml(href)}" style="color:${accent}">${label}</a>` : label;
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

/**
 * Buttons and boxes rendered from the values they stand for, in the site's accent.
 * `link_button` is the notification's: its label comes as `link_label`.
 */
function blockVars(vars: Record<string, string | undefined>, locale: ServerLocale, design: EmailDesign): Record<string, string> {
  return {
    reset_button: renderLinkButton(vars.reset_url, serverText(locale, "email", "buttons.reset"), design.accent,
      vars.expiry_minutes ? serverText(locale, "email", "buttons.resetNote", { minutes: vars.expiry_minutes }) : ""),
    login_button: renderLinkButton(vars.login_url, serverText(locale, "email", "buttons.signIn"), design.accent),
    link_button:  renderLinkButton(vars.link_url, vars.link_label || serverText(locale, "email", "buttons.view"), design.accent),
    code_box:     renderCodeBox(vars.code),
    request_box:  renderRequestBox(vars, locale),
    support_link: renderSupportLink(design, locale, design.accent),
  };
}

/**
 * Where a request came from, in the reader's language: the time in the site's zone,
 * the browser and system, and the country (looked up locally, see `geoip.ts`; the
 * address itself is never written into the mail). Fills `{{request_box}}`.
 */
export async function requestVars(
  request: { ip?: string | null; userAgent?: string | null },
  locale: ServerLocale,
  at = new Date(),
): Promise<{ request_time: string; request_device: string; request_location: string }> {
  // Each detail on its own: one that can't be worked out leaves its row out, and
  // never stops the reset mail itself.
  let time = "";
  try {
    // ⚠ Fields, not dateStyle/timeStyle: those refuse timeZoneName ("Invalid option").
    time = new Intl.DateTimeFormat(locale, {
      year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: await siteZone(), timeZoneName: "short",
    }).format(at);
  } catch { /* no time row */ }
  let place = "";
  try {
    const country = countryOf(request.ip);
    place = country ? new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country : "";
  } catch { /* no location row */ }
  return { request_time: time, request_device: describeUserAgent(request.userAgent) ?? "", request_location: place };
}

/** Content → a ready-to-send body: styled, placeholders filled, inside the frame. */
export function renderEmailBody(
  body: string,
  vars: Record<string, string | undefined>,
  locale: ServerLocale = "en",
  design: EmailDesign = EMAIL_DESIGN_DEFAULTS,
): string {
  const all = { ...vars, ...blockVars(vars, locale, design) };
  if (isLegacyBody(body)) return substitutePlaceholders(body, all);
  // A heading that opens the message moves up into the band.
  const lead = /^\s*<(h1|h2)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/i.exec(body);
  const rest = lead ? body.slice(lead[0].length) : body;
  const cut = rest.search(/<hr\s*\/?>/i);
  const main = cut < 0 ? rest : rest.slice(0, cut);
  const fine = cut < 0 ? "" : rest.slice(cut).replace(/^<hr\s*\/?>/i, "");
  const content = styleContent(unwrapBlockPlaceholders(main), design.accent) +
    (fine.trim() ? `<div style="padding-top:12px">${styleContent(unwrapBlockPlaceholders(fine), design.accent, FINE_STYLES)}</div>` : "");
  const firstLine = (/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/i.exec(main) ?? [])[1] ?? "";
  const preheader = escapeHtml(plainText(substitutePlaceholders(firstLine, vars).replace(/\{\{[^}]*\}\}/g, "")).slice(0, 140));
  return substitutePlaceholders(
    frameOpen(all, design, lead?.[2]?.trim() ?? "", preheader) + content + frameClose(all, design, locale),
    all,
  );
}

/** Markup out, entities back to characters, spaces collapsed. */
function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
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
    // `_button` / `_box` / `_link` placeholders are host-rendered HTML fragments, not user data.
    if (name.endsWith("_button") || name.endsWith("_box") || name.endsWith("_link")) return value;
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
    html: renderEmailBody(tpl.body, vars, locale, await getEmailDesign()),
  };
}

/**
 * Site identity every template can use. `site.name` / `site.url` are the same
 * values the frontend renders in canonical meta, so branded mail follows what
 * the site publicly calls itself rather than a build-time constant.
 */
export async function siteVars(): Promise<{ site_name: string; site_url: string; site_icon_url: string; site_logo_url: string }> {
  const site_url = (await getSetting<string>("site.url", "")).replace(/\/$/, "");
  return {
    site_name: await getSetting<string>("site.name", "Xentium"),
    site_url,
    site_icon_url: emailIconUrl(site_url, await getSetting<string | null>("appearance.logo.icon", null)),
    site_logo_url: emailImageUrl(site_url, await getSetting<string | null>("appearance.logo.navbar", null)),
  };
}

/**
 * An uploaded image as a mail client can show it: PNG, JPEG or GIF (no SVG, ICO or
 * WebP — Gmail and Outlook drop them), at an absolute address, since mail is read
 * off-site. Anything else is "".
 */
export function emailImageUrl(siteUrl: string, uploaded: string | null): string {
  if (!uploaded || !/\.(png|jpe?g|gif)$/i.test(uploaded)) return "";
  if (/^https?:\/\//i.test(uploaded)) return uploaded;
  return siteUrl ? `${siteUrl}/uploads/${uploaded.replace(/^\/+/, "")}` : "";
}

/** The admin's icon if a mail client can show it, else the Xentium icon every install ships. */
export function emailIconUrl(siteUrl: string, uploaded: string | null): string {
  return emailImageUrl(siteUrl, uploaded) || (siteUrl ? `${siteUrl}/brand/icon-192.png` : "");
}

/**
 * The call-to-action button: the card's full width, in the accent with whichever ink
 * reads on it. A table cell carries the colour, so clients that drop padding on links
 * (Outlook) still show a coloured bar. `note` is a small line under it.
 */
export function renderLinkButton(url: string | undefined, label = "View →", accent = EMAIL_DESIGN_DEFAULTS.accent, note = ""): string {
  if (!url || !isSafeUrl(url)) return "";
  const bg = HEX.test(accent) ? accent : EMAIL_DESIGN_DEFAULTS.accent;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${note ? "0" : "24px"}"><tr>` +
    `<td align="center" bgcolor="${bg}" style="background-color:${bg};border-radius:8px">` +
    `<a href="${escapeHtml(url)}" style="display:block;padding:15px 0;${FONT};font-size:15px;font-weight:700;color:${inkOn(bg)};text-decoration:none;border-radius:8px">${escapeHtml(label)}</a>` +
    `</td></tr></table>` +
    (note ? `<p style="margin:12px 0 28px;${FONT};font-size:12px;line-height:18px;color:${QUIET};text-align:center">${escapeHtml(note)}</p>` : "");
}

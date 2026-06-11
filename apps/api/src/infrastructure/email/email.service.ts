import nodemailer from "nodemailer";
import { prisma } from "../db.js";

// Escape user-controlled values before interpolating them into email HTML.
// Notification titles/bodies carry user content (e.g. forum thread titles), so
// without this a thread named `<a href=...>` injects markup into a trusted
// "Nodevo" email — a phishing vector.
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

async function resolveSmtp(): Promise<SmtpConfig | null> {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: ["smtp.host", "smtp.port", "smtp.user", "smtp.pass", "smtp.from", "smtp.secure"] } },
    });
    const s: Record<string, string> = Object.fromEntries(rows.map((r) => [r.key, String(r.value)]));

    const host = s["smtp.host"] || process.env.SMTP_HOST;
    const user = s["smtp.user"] || process.env.SMTP_USER;
    const pass = s["smtp.pass"] || process.env.SMTP_PASS;

    if (!host || !user || !pass) return null;

    return {
      host,
      port: parseInt(s["smtp.port"] || process.env.SMTP_PORT || "587"),
      secure: (s["smtp.secure"] || process.env.SMTP_SECURE || "false") === "true",
      user,
      pass,
      from: s["smtp.from"] || process.env.SMTP_FROM || `Nodevo <${user}>`,
    };
  } catch {
    return null;
  }
}

export async function isEmailConfigured(): Promise<boolean> {
  return (await resolveSmtp()) !== null;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const cfg = await resolveSmtp();

  if (!cfg) {
    console.warn(`[email] SMTP not configured — skipping send to ${to} (subject: "${subject}")`);
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  await transporter.sendMail({ from: cfg.from, to, subject, html });
  return true;
}

export function notificationEmail(opts: {
  title: string;
  body: string;
  link?: string;
  siteName?: string;
}): string {
  const site = escapeHtml(opts.siteName ?? "Nodevo");
  // Allow only absolute http(s) URLs or same-site relative paths ("/..."), never
  // protocol-relative ("//evil") or javascript:/data: URIs.
  const linkOk = !!opts.link && (/^https?:\/\//i.test(opts.link) || /^\/(?!\/)/.test(opts.link));
  const safeLink = linkOk ? escapeHtml(opts.link!) : "";
  const linkBtn = safeLink
    ? `<a href="${safeLink}" style="display:inline-block;background:#7c6af7;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;font-size:14px;margin-top:8px">View →</a>`
    : "";
  return `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <div style="margin-bottom:24px">
        <span style="font-size:20px;font-weight:800;letter-spacing:-0.03em">${site}</span>
      </div>
      <h2 style="font-size:20px;font-weight:700;margin:0 0 10px;color:#0d0d22">${escapeHtml(opts.title)}</h2>
      <p style="color:#4a4a7a;margin:0 0 20px;line-height:1.6;font-size:15px">${escapeHtml(opts.body)}</p>
      ${linkBtn}
      <hr style="border:none;border-top:1px solid #e7e7f1;margin:28px 0 16px">
      <p style="color:#9ca3af;font-size:12px;margin:0">
        You're receiving this because you have notifications enabled. Manage your preferences in Account Settings.
      </p>
    </div>
  `;
}

export function passwordResetEmail(link: string): string {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <div style="margin-bottom:24px">
        <span style="font-size:20px;font-weight:800;letter-spacing:-0.03em">nodevo</span>
      </div>
      <h2 style="font-size:22px;font-weight:700;margin:0 0 8px">Reset your password</h2>
      <p style="color:#6b7280;margin:0 0 24px;line-height:1.6">
        We received a request to reset your password. Click the button below to choose a new one.
        This link expires in 15 minutes and can only be used once.
      </p>
      <a href="${link}" style="display:inline-block;background:#7c6af7;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:14px">Reset password →</a>
      <p style="color:#9ca3af;font-size:13px;margin:24px 0 0">
        If you didn't request this, you can safely ignore this email — your password will stay the same.
      </p>
    </div>
  `;
}

export function verificationCodeEmail(code: string): string {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <div style="margin-bottom:24px">
        <span style="font-size:20px;font-weight:800;letter-spacing:-0.03em">nodevo</span>
      </div>
      <h2 style="font-size:22px;font-weight:700;margin:0 0 8px">Verify your email</h2>
      <p style="color:#6b7280;margin:0 0 28px;line-height:1.6">
        Enter this code in the registration form to complete your account setup.
        It expires in 10 minutes.
      </p>
      <div style="background:#f5f5fb;border:1px solid #e7e7f1;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px">
        <span style="font-size:36px;font-weight:800;letter-spacing:0.18em;color:#1a1a2e">${code}</span>
      </div>
      <p style="color:#9ca3af;font-size:13px;margin:0">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;
}

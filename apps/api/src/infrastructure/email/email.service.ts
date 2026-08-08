import nodemailer from "nodemailer";
import { prisma } from "../db.js";
import { decryptSecret, isEncrypted } from "../../shared/utils/secretBox.js";

export const SMTP_SETTING_KEYS = [
  "smtp.host",
  "smtp.port",
  "smtp.user",
  "smtp.pass",
  "smtp.from",
  "smtp.from_name",
  "smtp.secure",
] as const;

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  /** Empty when relaying through an unauthenticated local MTA. */
  user: string;
  pass: string;
  from: string;
}

/**
 * Only the host is required. Credentials are optional because the common
 * self-hosted setup is a loopback-bound MTA (postfix on 127.0.0.1:25) that
 * accepts mail from localhost with no AUTH at all — demanding user+pass there
 * meant email silently never sent.
 */
async function resolveSmtp(): Promise<SmtpConfig | null> {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: [...SMTP_SETTING_KEYS] } },
    });
    const s: Record<string, string> = Object.fromEntries(
      rows.map((r) => [r.key, r.value == null ? "" : String(r.value)]),
    );

    const host = s["smtp.host"] || process.env.SMTP_HOST || "";
    if (!host) return null;

    const user = s["smtp.user"] || process.env.SMTP_USER || "";
    // Stored encrypted-at-rest; env stays plain for container-style deploys.
    const rawPass = s["smtp.pass"] || "";
    const pass = rawPass
      ? (isEncrypted(rawPass) ? decryptSecret(rawPass) : rawPass)
      : (process.env.SMTP_PASS || "");

    const fromAddress = s["smtp.from"] || process.env.SMTP_FROM || (user || `no-reply@${host}`);
    const fromName = s["smtp.from_name"] || process.env.SMTP_FROM_NAME || "";

    return {
      host,
      port: parseInt(s["smtp.port"] || process.env.SMTP_PORT || "587"),
      secure: (s["smtp.secure"] || process.env.SMTP_SECURE || "false") === "true",
      user,
      pass,
      // Only wrap in a display name when the stored value is a bare address —
      // an admin who typed `Nodelab <no-reply@…>` gets it through untouched.
      from: fromName && !fromAddress.includes("<") ? `${fromName} <${fromAddress}>` : fromAddress,
    };
  } catch {
    return null;
  }
}

function buildTransport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    // Omitting auth entirely is not the same as passing empty strings —
    // nodemailer would otherwise attempt AUTH against a relay that offers none.
    ...(cfg.user && cfg.pass ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
    // A local relay has no useful certificate; only enforce for remote hosts.
    ...(cfg.host === "localhost" || cfg.host === "127.0.0.1"
      ? { tls: { rejectUnauthorized: false } }
      : {}),
  });
}

/** Opens a connection and runs the SMTP handshake without sending anything. */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  const cfg = await resolveSmtp();
  if (!cfg) return { ok: false, error: "SMTP_NOT_CONFIGURED" };
  try {
    await buildTransport(cfg).verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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

  await buildTransport(cfg).sendMail({ from: cfg.from, to, subject, html });
  return true;
}

// Template bodies now live in email-templates.ts, where an admin override in
// ncf_email_templates can replace them. Keeping a second hardcoded copy here is
// exactly the two-sources-of-truth split that made the ACP mail settings dead.

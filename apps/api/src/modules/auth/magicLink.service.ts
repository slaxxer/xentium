import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { sendEmail } from "../../infrastructure/email/email.service.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { renderEmailTemplate, siteVars } from "../../infrastructure/email/email-templates.js";
import { finishSignIn, type SignInContext, type SignInResult } from "./auth.signin.js";
import { recipientLocale } from "../../shared/i18n/serverText.js";

/**
 * "Email me a sign-in link": a one-time link that signs the member in.
 *
 * The raw token exists only in the email; the server keeps a keyed hash (the
 * same HMAC the refresh and reset tokens use), so reading Redis does not hand
 * out working links. One use, fifteen minutes. Consuming it goes through
 * finishSignIn, so a banned account stays out and a login PIN still applies.
 */

export const MAGIC_LINK_TTL_SEC = 15 * 60;

const HMAC_KEY = process.env.REFRESH_TOKEN_HMAC_SECRET || process.env.JWT_SECRET || "";
const hashToken = (raw: string) => crypto.createHmac("sha256", HMAC_KEY).update(raw).digest("hex");
const linkKey = (raw: string) => rkey(`auth:magic:${hashToken(raw)}`);

interface Pending { userId: string; persistent: boolean }

/**
 * Always resolves the same way, whether or not the address has an account —
 * the answer must not tell anyone who is registered here.
 */
export async function requestMagicLink(email: string, persistent: boolean, localeHint?: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" } },
    select: { id: true, email: true, username: true, isActive: true },
  });
  if (!user || !user.isActive) return;

  const raw = crypto.randomBytes(32).toString("base64url");
  await redis.set(linkKey(raw), JSON.stringify({ userId: user.id, persistent } satisfies Pending), "EX", MAGIC_LINK_TTL_SEC);

  const appUrl = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
  const link = `${appUrl}/login/link?token=${raw}`;
  const mail = await renderEmailTemplate("magic_link", {
    ...(await siteVars()),
    login_url: link,
    username: user.username,
    expiry_minutes: String(MAGIC_LINK_TTL_SEC / 60),
  }, await recipientLocale({ userId: user.id, hint: localeHint }));
  // A failed send answers like an unknown address: a 500 here only for real accounts
  // would tell anyone which addresses have one. The admin finds it in the server log.
  const sent = await sendEmail(user.email, mail.subject, mail.html).catch((err: unknown) => {
    logger.error({ err, template: "magic_link" }, "email send failed");
    return null;
  });
  if (sent === false) {
    // Dev fallback, as for reset links: without SMTP the link goes to stderr.
    process.stderr.write(`\n\x1b[33m[DEV] Sign-in link for ${user.email}:\x1b[0m\n  ${link}\n\n`);
  }
}

/** Use a link. Null when it is unknown, used or expired — the three look the same. */
export async function consumeMagicLink(raw: string, ctx: SignInContext): Promise<SignInResult | null> {
  // GETDEL: of two requests racing with the same link, exactly one gets it.
  const value = await redis.getdel(linkKey(raw));
  if (!value) return null;
  const pending = JSON.parse(value) as Pending;
  return finishSignIn(pending.userId, ctx, { method: "magic_link", persistent: pending.persistent });
}

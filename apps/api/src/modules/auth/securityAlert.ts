import { prisma } from "../../infrastructure/db.js";
import { sendEmail } from "../../infrastructure/email/email.service.js";
import { renderEmailTemplate, requestVars, siteVars } from "../../infrastructure/email/email-templates.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { recipientLocale, serverText } from "../../shared/i18n/serverText.js";
import { CorePermissions } from "@xentium/contracts";
import { hasPermission } from "../../shared/middleware/requirePermission.js";

/**
 * "Something changed about how you sign in" — told to the person, and, when the
 * account is one that must use two-factor sign-in (staff), to every admin too.
 *
 * A stolen staff login that switches 2FA off is the one change worth shouting
 * about: the team should hear it from the site before anything else happens.
 * Fire-and-forget: the change already happened and is in the activity log; an
 * SMTP outage must not undo it or fail the request.
 */
export type SecurityEvent =
  | "twofactor_enabled"
  | "twofactor_disabled"
  | "recovery_used"
  | "recovery_regenerated"
  | "twofactor_reset";

/** Events the admins hear about too, for an account that must use 2FA. */
const TELL_ADMINS: ReadonlySet<SecurityEvent> = new Set(["twofactor_disabled", "recovery_used", "twofactor_reset"]);

export function sendSecurityAlert(
  userId: string,
  event: SecurityEvent,
  request: { ip?: string | null; userAgent?: string | null },
): void {
  void (async () => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, username: true } });
    if (!user) return;
    const recipients: Array<{ id: string; email: string; username: string; about: "self" | "admin" }> = [
      { ...user, about: "self" },
    ];
    if (TELL_ADMINS.has(event) && await hasPermission(userId, CorePermissions.ACCOUNT_TWO_FACTOR_REQUIRED)) {
      const admins = await prisma.user.findMany({
        where: {
          id: { not: userId }, isActive: true,
          groups: { some: { group: { permissions: { some: { permission: { key: CorePermissions.ADMIN_ACCESS } } } } } },
        },
        select: { id: true, email: true, username: true },
      });
      recipients.push(...admins.map((a) => ({ ...a, about: "admin" as const })));
    }

    const site = await siteVars();
    await Promise.all(recipients.map(async (r) => {
      const locale = await recipientLocale({ userId: r.id });
      const key = r.about === "self" ? `security.${event}` : `security.${event}_admin`;
      const mail = await renderEmailTemplate("security_alert", {
        ...site,
        ...(await requestVars(request, locale)),
        username: r.username,
        event: serverText(locale, "email", `${key}.title`, { username: user.username }),
        detail: serverText(locale, "email", `${key}.detail`, { username: user.username }),
      }, locale);
      await sendEmail(r.email, mail.subject, mail.html);
    }));
  })().catch((err: unknown) => logger.error({ err, event }, "security alert email failed"));
}

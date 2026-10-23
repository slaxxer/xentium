import { prisma } from "../../infrastructure/db.js";
import { env } from "../../config/env.js";
import { queues } from "../../infrastructure/queue.js";
import { renderEmailTemplate, siteVars } from "../../infrastructure/email/email-templates.js";
import { notificationRepository } from "./notification.repository.js";
import type { DispatchOptions, NotificationPreferenceResolved } from "./notification.types.js";
import { primaryGroupOrder } from "../../shared/utils/userRef.js";
import { hasServerText, recipientLocale, serverText, type ServerLocale } from "../../shared/i18n/serverText.js";
import { validate } from "../../core/events/events.js";

type StoredPreference = {
  typePattern:  string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
};

const DEFAULT_PREFERENCE: NotificationPreferenceResolved = {
  inAppEnabled: true,
  emailEnabled: false,
};

function patternMatches(pattern: string, type: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

function resolvePreference(prefs: StoredPreference[], type: string): NotificationPreferenceResolved {
  const matches = prefs
    .filter((p) => patternMatches(p.typePattern, type))
    .sort((a, b) => b.typePattern.length - a.typePattern.length);
  const best = matches[0];
  if (!best) return DEFAULT_PREFERENCE;
  return { inAppEnabled: best.inAppEnabled, emailEnabled: best.emailEnabled };
}

/**
 * A core notification's title/body in the recipient's language. Core keys
 * (`common:notify.*`) have a server copy; a plugin's key does not, and a part the
 * key leaves out (someone's own words) keeps the stored text.
 */
function emailText(opts: DispatchOptions, locale: ServerLocale): { title: string; body: string } {
  const key = opts.i18n?.key;
  if (!key?.startsWith("common:notify.")) return { title: opts.title, body: opts.body };
  const path = key.slice("common:notify.".length);
  const pick = (part: "title" | "body", stored: string) =>
    hasServerText("notifications", `${path}.${part}`)
      ? serverText(locale, "notifications", `${path}.${part}`, opts.i18n?.params)
      : stored;
  return { title: pick("title", opts.title), body: pick("body", opts.body) };
}

export const notificationService = {
  async dispatch(opts: DispatchOptions): Promise<void> {
    const prefs    = (await notificationRepository.findPreferencesForUser(opts.userId)) as StoredPreference[];
    const resolved = resolvePreference(prefs, opts.type);

    const wantsInApp = opts.channels.includes("in_app") && resolved.inAppEnabled;
    const wantsEmail = opts.channels.includes("email")  && resolved.emailEnabled;
    if (!wantsInApp && !wantsEmail) return;

    // An add-on may hold a notification back (a quiet mode, a digest it sends itself).
    // A refusal drops it silently: there is nobody to show an error to.
    if (await validate("notification.validate", { userId: opts.userId, type: opts.type, title: opts.title, body: opts.body ?? null })) return;

    // Enrich meta with sender avatar/username for display in the notification bell
    let meta: Record<string, unknown> = opts.i18n ? { ...opts.meta, i18n: opts.i18n } : (opts.meta ?? {});
    if (opts.senderUserId) {
      const sender = await prisma.user.findUnique({
        where:  { id: opts.senderUserId },
        select: {
          username: true, avatar: true,
          groups: {
            orderBy: primaryGroupOrder,
            include: {
              group: { select: { progression: { select: { badgeColor: true } } } },
            },
          },
        },
      });
      if (sender) {
        meta = {
          ...meta,
          senderUsername:   sender.username,
          senderAvatar:     sender.avatar ? `${env.APP_URL}/uploads/${sender.avatar}` : null,
          senderBadgeColor: sender.groups[0]?.group.progression?.badgeColor ?? null,
        };
      }
    }

    if (wantsInApp) {
      await notificationRepository.create({
        userId: opts.userId,
        type:   opts.type,
        title:  opts.title,
        body:   opts.body,
        link:   opts.link,
        meta,
      });
    }

    if (wantsEmail) {
      const user = await prisma.user.findUnique({
        where:  { id: opts.userId },
        select: { email: true },
      });
      if (user?.email) {
        const locale = await recipientLocale({ userId: opts.userId });
        const text = emailText(opts, locale);
        const { subject, html } = await renderEmailTemplate("notification", {
          ...(await siteVars()),
          title:       text.title,
          body:        text.body,
          link_url:    opts.link,
          link_label:  serverText(locale, "email", "buttons.view"),
        }, locale);

        await queues.emailNotification.add("email-notification", {
          to: user.email,
          subject,
          html,
        });
      }
    }
  },

  async listForUser(userId: string, opts: { page: number; limit: number }) {
    return notificationRepository.findForUser(userId, opts);
  },

  async getUnreadCount(userId: string): Promise<number> {
    return notificationRepository.countUnread(userId);
  },

  async markRead(notificationId: string, userId: string): Promise<void> {
    return notificationRepository.markRead(notificationId, userId);
  },

  async markAllRead(userId: string): Promise<void> {
    return notificationRepository.markAllRead(userId);
  },
};

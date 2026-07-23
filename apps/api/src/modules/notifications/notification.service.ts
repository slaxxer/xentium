import { prisma } from "../../infrastructure/db.js";
import { env } from "../../config/env.js";
import { queues } from "../../infrastructure/queue.js";
import { notificationEmail } from "../../infrastructure/email/email.service.js";
import { notificationRepository } from "./notification.repository.js";
import type { DispatchOptions, NotificationPreferenceResolved } from "./notification.types.js";
import { primaryGroupOrder } from "../../shared/utils/userRef.js";

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

export const notificationService = {
  async dispatch(opts: DispatchOptions): Promise<void> {
    const prefs    = (await notificationRepository.findPreferencesForUser(opts.userId)) as StoredPreference[];
    const resolved = resolvePreference(prefs, opts.type);

    const wantsInApp = opts.channels.includes("in_app") && resolved.inAppEnabled;
    const wantsEmail = opts.channels.includes("email")  && resolved.emailEnabled;

    // Enrich meta with sender avatar/username for display in the notification bell
    let meta = opts.meta ?? {};
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
        const siteName = await prisma.setting
          .findUnique({ where: { key: "site.name" } })
          .then((s) => (s?.value as string | null) ?? "Nodevo");

        await queues.emailNotification.add("email-notification", {
          to:      user.email,
          subject: opts.title,
          html:    notificationEmail({
            title:    opts.title,
            body:     opts.body,
            link:     opts.link,
            siteName,
          }),
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

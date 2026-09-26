import { prisma } from "../../infrastructure/db.js";
import { getSetting } from "../../shared/utils/settings.js";
import {
  dismissAnnouncement, readAnnouncementCache, type Announcement, type AnnouncementCopy,
} from "../../jobs/announcementCheck.js";

/**
 * Broadcasts from the Xentium team, as one administrator sees them.
 *
 * The announcements themselves are the marketplace's records — cached by the
 * daily check, already signature-verified, and never authored here. The
 * instance keeps no history of them: once an admin clicks OK the announcement
 * is deleted from the cache for everyone, and the ACP has no page to find it
 * on again.
 */

/** One announcement, resolved to this site's language and this admin's state. */
export interface AnnouncementView {
  id: string;
  severity: Announcement["severity"];
  publishedAt: string;
  link: string | null;
  title: string;
  body: string;
  /** The language the copy above is actually in. */
  locale: string;
  /** True when that is not the site's language — English standing in. */
  fallback: boolean;
}

/**
 * Pick the copy an admin should read.
 *
 * The site's configured language first, then English, which the check job
 * guarantees is present. A locale like `de-AT` falls back to `de` before it
 * falls back to English — the same "language only" rule the frontend's i18n
 * uses, so the two cannot disagree about what German means.
 */
function copyFor(announcement: Announcement, locale: string): {
  copy: AnnouncementCopy; locale: string; fallback: boolean;
} {
  const wanted = locale.toLowerCase();
  const base = wanted.split("-")[0] ?? wanted;

  for (const key of [wanted, base]) {
    const hit = announcement.locales[key];
    if (hit) return { copy: hit, locale: key, fallback: key !== base && key !== wanted };
  }
  return { copy: announcement.locales.en!, locale: "en", fallback: base !== "en" };
}

export const announcementService = {
  /**
   * Everything still waiting to be read, newest first.
   *
   * Expired ones are dropped here as well as at the endpoint: the cache is a
   * day old at worst, and a notice whose deadline has passed should stop being
   * shown without waiting for the next check.
   */
  async list(userId: string): Promise<{ checkedAt: string | null; announcements: AnnouncementView[] }> {
    const cache = await readAnnouncementCache();
    if (!cache) return { checkedAt: null, announcements: [] };

    const now = Date.now();
    const live = cache.announcements.filter(
      (a) => !a.expiresAt || Date.parse(a.expiresAt) > now,
    );

    // §60's resolution chain, as far as the server can see it: the ADMIN's own
    // preference first, then the site's default. An administrator reading an
    // English admin panel should not meet a German announcement because the
    // site is German — the notice is addressed to them, not to the site.
    const reader = await prisma.user.findUnique({
      where: { id: userId }, select: { preferredLocale: true },
    });
    const locale = reader?.preferredLocale || await getSetting<string>("site.locale", "en");

    return {
      checkedAt: cache.checkedAt,
      announcements: live.map((a) => {
        const { copy, locale: used, fallback } = copyFor(a, locale);
        return {
          id: a.id,
          severity: a.severity,
          publishedAt: a.publishedAt,
          link: a.link,
          title: copy.title,
          body: copy.body,
          locale: used,
          fallback,
        };
      }),
    };
  },

  /**
   * An admin has read it, so it leaves this site — for every admin, not just
   * this one. An id we no longer hold (pulled or expired while the dialog was
   * open) is already gone, and is not an error.
   */
  async dismiss(announcementId: string): Promise<{ ok: true }> {
    await dismissAnnouncement(announcementId);
    return { ok: true };
  },
};

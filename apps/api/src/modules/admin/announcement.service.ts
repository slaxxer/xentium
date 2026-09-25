import { prisma } from "../../infrastructure/db.js";
import { getSetting } from "../../shared/utils/settings.js";
import {
  readAnnouncementCache, type Announcement, type AnnouncementCopy,
} from "../../jobs/announcementCheck.js";

/**
 * Broadcasts from the Xentium team, as one administrator sees them.
 *
 * The announcements themselves are the marketplace's records — cached by the
 * daily check, already signature-verified, and never authored here. What this
 * instance owns is who has read what.
 */

/** One announcement, resolved to this site's language and this admin's state. */
export interface AnnouncementView {
  id: string;
  severity: Announcement["severity"];
  publishedAt: string;
  link: string | null;
  title: string;
  body: string;
  /** Has THIS admin clicked OK. */
  acknowledged: boolean;
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
   * Everything still live, newest first, with this admin's acknowledgement.
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

    const acks = await prisma.announcementAck.findMany({
      where: { userId, announcementId: { in: live.map((a) => a.id) } },
      select: { announcementId: true },
    });
    const acked = new Set(acks.map((a) => a.announcementId));

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
          acknowledged: acked.has(a.id),
          locale: used,
          fallback,
        };
      }),
    };
  },

  /**
   * This admin has read it.
   *
   * Idempotent, and it does NOT check that the id is one we know about: an
   * announcement pulled between the dialog opening and the click would
   * otherwise fail the acknowledgement, and the admin would meet it again the
   * moment it came back. An unknown id costs one small row.
   */
  async acknowledge(userId: string, announcementId: string): Promise<{ ok: true }> {
    await prisma.announcementAck.upsert({
      where:  { userId_announcementId: { userId, announcementId } },
      update: {},
      create: { userId, announcementId },
    });
    return { ok: true };
  },
};

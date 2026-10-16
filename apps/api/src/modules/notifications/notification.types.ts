export type NotificationChannel = "in_app" | "email";

export interface DispatchOptions {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  meta?: Record<string, unknown>;
  senderUserId?: string;  // enriches meta with senderUsername + senderAvatar at dispatch time
  channels: NotificationChannel[];
  /**
   * The same text as a translation: the bell shows `<key>.title` / `<key>.body` in the
   * reader's language, filled from `params`. `title`/`body` stay the stored fallback
   * (older clients, a missing key, emails). Leave `<key>.body` out of the locale file
   * when the body is someone's own words (a ban reason) — the stored body then shows.
   */
  i18n?: NotificationText;
}

export interface NotificationText {
  key: string;                                   // a full i18next key, e.g. "common:notify.newFollower"
  params?: Record<string, string | number>;
}

export interface NotificationPreferenceResolved {
  inAppEnabled: boolean;
  emailEnabled: boolean;
}

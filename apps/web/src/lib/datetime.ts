/**
 * Dates and times as the SITE writes them — posts, articles, messages.
 *
 * The admin chooses (ACP → System Settings → General): a time zone (or each
 * visitor's own), 12- or 24-hour time (or the language's habit), and a date style.
 * Everything that prints a moment the reader may act on goes through here, so a
 * forum post, an article and a private message all say "Today, 14:05" the same way.
 *
 * Exposed to plugins as the `webDateTime` host global.
 */
import { useTranslation } from "react-i18next";
import { useSiteConfig } from "../hooks/useSiteConfig";

export interface TimeConfig {
  /** IANA zone, or null = the visitor's own. */
  zone: string | null;
  timeFormat: "auto" | "24h" | "12h";
  dateFormat: "medium" | "long" | "numeric" | "iso";
}

export const DEFAULT_TIME_CONFIG: TimeConfig = { zone: null, timeFormat: "auto", dateFormat: "medium" };

const zoneOpt = (cfg: TimeConfig) => (cfg.zone ? { timeZone: cfg.zone } : {});
const toDate = (v: string | number | Date) => (v instanceof Date ? v : new Date(v));

/** "7 Oct 2026" / "7 October 2026" / "07/10/2026" / "2026-10-07", in the site's zone. */
export function formatDate(value: string | number | Date, cfg: TimeConfig, lang: string): string {
  const d = toDate(value);
  if (cfg.dateFormat === "iso") {
    // en-CA writes YYYY-MM-DD, in whichever zone it is given.
    return d.toLocaleDateString("en-CA", { ...zoneOpt(cfg), year: "numeric", month: "2-digit", day: "2-digit" });
  }
  const style: Intl.DateTimeFormatOptions =
    cfg.dateFormat === "long" ? { day: "numeric", month: "long", year: "numeric" }
    : cfg.dateFormat === "numeric" ? { day: "2-digit", month: "2-digit", year: "numeric" }
    : { day: "numeric", month: "short", year: "numeric" };
  return d.toLocaleDateString(lang, { ...zoneOpt(cfg), ...style });
}

/** "14:05" / "2:05 PM", in the site's zone and clock. */
export function formatTime(value: string | number | Date, cfg: TimeConfig, lang: string): string {
  const chosen = cfg.timeFormat === "12h" ? true : cfg.timeFormat === "24h" ? false : undefined;
  // What the language does when the admin left it to the language.
  const hour12 = chosen ?? new Intl.DateTimeFormat(lang, { hour: "numeric" }).resolvedOptions().hour12 ?? false;
  // A 12-hour clock reads "2:05 PM", not "02:05 PM"; a 24-hour one keeps "02:05".
  return toDate(value).toLocaleTimeString(lang, {
    ...zoneOpt(cfg), hour: hour12 ? "numeric" : "2-digit", minute: "2-digit", hour12,
  });
}

/** The calendar day a moment falls on, in the site's zone — for "today"/"yesterday". */
function dayKey(d: Date, cfg: TimeConfig): string {
  return d.toLocaleDateString("en-CA", { ...zoneOpt(cfg), year: "numeric", month: "2-digit", day: "2-digit" });
}

/** "Today" / "Yesterday" in the reader's language, or null for any other day. */
function nearDay(d: Date, cfg: TimeConfig, lang: string, now = new Date()): string | null {
  const key = dayKey(d, cfg);
  const offset = key === dayKey(now, cfg) ? 0 : key === dayKey(new Date(now.getTime() - 86400e3), cfg) ? -1 : null;
  if (offset === null) return null;
  try {
    const word = new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(offset, "day");
    return word.charAt(0).toLocaleUpperCase(lang) + word.slice(1);
  } catch {
    return null;
  }
}

/** "7 Oct 2026, 14:05". */
export function formatDateTime(value: string | number | Date, cfg: TimeConfig, lang: string): string {
  return `${formatDate(value, cfg, lang)}, ${formatTime(value, cfg, lang)}`;
}

/**
 * The stamp on a post or a message: "Today, 14:05", "Yesterday, 18:40", otherwise
 * "7 Oct 2026, 14:05" — the date AND the time, always in the site's zone.
 */
export function formatStamp(value: string | number | Date, cfg: TimeConfig, lang: string, now = new Date()): string {
  const d = toDate(value);
  const near = nearDay(d, cfg, lang, now);
  return `${near ?? formatDate(d, cfg, lang)}, ${formatTime(d, cfg, lang)}`;
}

/** The site's time settings and formatters bound to them and to the reader's language. */
export function useDateTime() {
  const { data } = useSiteConfig();
  const { i18n } = useTranslation();
  const cfg = data?.time ?? DEFAULT_TIME_CONFIG;
  const lang = i18n.resolvedLanguage ?? i18n.language ?? "en";
  return {
    config: cfg,
    date: (v: string | number | Date) => formatDate(v, cfg, lang),
    time: (v: string | number | Date) => formatTime(v, cfg, lang),
    dateTime: (v: string | number | Date) => formatDateTime(v, cfg, lang),
    stamp: (v: string | number | Date) => formatStamp(v, cfg, lang),
  };
}

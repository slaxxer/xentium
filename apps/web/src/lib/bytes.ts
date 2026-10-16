import { uiLocale } from "./i18n";

const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;

/**
 * A size in the reader's language: "1.5 MB", "1,5 Mo", "1,5 MB". `Intl` owns the
 * unit names, so French gets its octets without a translation of our own.
 */
export function formatBytes(bytes: number, locale: string = uiLocale()): string {
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < UNITS.length - 1) { n /= 1024; u++; }
  return new Intl.NumberFormat(locale, {
    style: "unit", unit: UNITS[u], unitDisplay: "short", maximumFractionDigits: u ? 1 : 0,
  }).format(n);
}

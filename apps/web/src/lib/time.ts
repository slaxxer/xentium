import i18n, { uiLocale } from "./i18n";

// The one relative-time formatter (previously ~10 per-page copies, several
// hardcoding English). Localized via the `time` block in the common namespace.

/**
 * Localized "time ago" string.
 * - default: "just now" / "5m ago" / "3h ago" / "12d ago", short date after 30 days
 * - compact:  "now" / "5m" / "3h" / "6d", short date after 7 days (feed style)
 * Returns an em dash for null/undefined.
 */
export function timeAgo(
  input: string | Date | null | undefined,
  opts?: { compact?: boolean },
): string {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  const tr = (key: string, n?: number) => i18n.t(`time.${key}`, { ns: "common", n });
  const shortDate = () =>
    date.toLocaleDateString(uiLocale(), { month: "short", day: "numeric" });

  const m = Math.floor((Date.now() - date.getTime()) / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);

  if (opts?.compact) {
    if (m < 1) return tr("now");
    if (m < 60) return tr("m", m);
    if (h < 24) return tr("h", h);
    if (d < 7) return tr("d", d);
    return shortDate();
  }
  if (m < 1) return tr("justNow");
  if (m < 60) return tr("agoM", m);
  if (h < 24) return tr("agoH", h);
  if (d < 30) return tr("agoD", d);
  return shortDate();
}

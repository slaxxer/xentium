/**
 * A browser and system name out of a user-agent: "Chrome 141 · macOS". DISPLAY ONLY,
 * nothing is gated on it. Shared by the account's session list and the emails that
 * say which device asked (a password reset). Null when there is no user-agent;
 * an agent it can't read comes back as its first 60 characters.
 */
export function describeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  /**
   * ⚠ Most specific FIRST, and one test each — not one alternation.
   *
   * A regex alternation matches at the earliest POSITION, not by priority, and
   * Edge's user-agent reads "… Chrome/140 … Edg/140": one pattern reported every
   * Edge and every Opera as Chrome. Safari's own version lives in `Version/`; its
   * `Safari/` number is the WebKit build.
   */
  const BROWSERS: [RegExp, string][] = [
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/Firefox\/(\d+)/, "Firefox"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Version\/(\d+).*Safari/, "Safari"],
    [/Safari\/(\d+)/, "Safari"],
  ];
  let browser: [string, string] | null = null;
  for (const [re, label] of BROWSERS) {
    const m = ua.match(re);
    if (m) { browser = [label, m[1]!]; break; }
  }
  /**
   * ⚠ iOS BEFORE macOS. An iPhone's user-agent says "like Mac OS X", so testing for
   * Mac first reports every iPhone and iPad as a Mac — which is the one thing a
   * member looks at this list to tell apart. Android before Linux, for the same
   * reason.
   */
  const os = /Windows/i.test(ua) ? "Windows"
    : /(iPhone|iPad|iPod|iOS)/i.test(ua) ? "iOS"
    : /Android/i.test(ua) ? "Android"
    : /Mac OS X/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux"
    : null;
  const name = browser ? `${browser[0]} ${browser[1]}` : null;
  if (!name && !os) return ua.slice(0, 60);
  return [name, os].filter(Boolean).join(" · ");
}

/** Only allow returning to in-app relative paths, to prevent open-redirect.
 *
 *  Three separate ways a string that looks relative can leave the origin:
 *    - `//evil.com`  — protocol-relative.
 *    - `/\evil.com`  — the same thing, but browsers (and react-router's own
 *      history) normalise `\` to `/` only AFTER a naive check has passed. That
 *      is the react-router GHSA (Dependabot #40) bypass; rejecting the
 *      character here keeps the guard independent of the router version.
 *    - control characters / spaces — stripped before the URL is parsed, so
 *      `/<TAB>/evil.com` and friends re-form into one of the above.
 *
 *  So the last check is an ALLOWLIST of the characters a URL path, query and
 *  fragment may legally contain, rather than a blocklist of the tricks: a
 *  legitimate returnTo is `location.pathname + location.search`, which is
 *  already percent-encoded and therefore always inside it.
 */
const URL_SAFE = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;

export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (!URL_SAFE.test(raw)) return "/";
  return raw;
}

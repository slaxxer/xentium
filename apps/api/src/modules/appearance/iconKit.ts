/**
 * The one place that decides what a FontAwesome kit URL is.
 *
 * ⚠ THIS IS A SCRIPT SOURCE, not a string. Whatever survives this function is
 * injected into a `<script src>` on every page of the site, so an unchecked value
 * here is arbitrary JavaScript execution for every visitor — a far bigger lever
 * than the custom-CSS console an appearance admin already holds. The host is
 * therefore an ALLOWLIST, and everything else about the URL is rebuilt rather than
 * echoed: no query string, no fragment, no credentials, no port.
 *
 * ⚠ Validated on the way OUT as well as on the way in. The write path is the only
 * supported way to set this, but a settings row is a row — a hand-edited database,
 * a restored backup or a future generic settings endpoint must not be able to turn
 * this into a script loader.
 *
 * Why a kit at all, rather than bundling Pro icons: a Pro licence covers the sites
 * its owner operates, and Xentium is installed by strangers on their own servers.
 * Bundling Pro artwork into the build would copy licensed assets into every install.
 * A kit is loaded at RUNTIME with the admin's own id, domain-locked by FontAwesome
 * to their site, so each instance brings its own licence. See `docs/icon-kits.md`.
 */

/** Hosts a kit script may be served from. Nothing else is a kit. */
const KIT_HOSTS = new Set(["kit.fontawesome.com"]);

/** `/abc123def.js` — a kit id is hex-ish and nothing else lives at that path. */
const KIT_PATH = /^\/[a-z0-9]{6,32}\.js$/;

/**
 * Normalise a kit URL, or return null if it is not one.
 *
 * Accepts either a full URL or a bare kit id, because an admin copying from
 * FontAwesome's dashboard may reasonably have either in the clipboard.
 */
export function parseKitUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A bare kit id — the commonest thing to have copied.
  if (/^[a-z0-9]{6,32}$/.test(trimmed)) return `https://kit.fontawesome.com/${trimmed}.js`;

  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }

  // ⚠ Protocol before host: `javascript:` and `data:` URLs parse fine and have no
  // host at all, so a host check alone would let them through on some inputs.
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port) return null;
  if (!KIT_HOSTS.has(url.hostname)) return null;
  if (!KIT_PATH.test(url.pathname)) return null;

  // Rebuilt, not echoed: drops any query string or fragment the admin pasted along.
  return `https://${url.hostname}${url.pathname}`;
}


/**
 * XenForo-flavored BBCode → safe HTML for forum_posts.body.
 *
 * XenForo stores post messages as BBCode (entity-escaped text, tags in any
 * case). Quote tags carry metadata: [QUOTE="name, post: 123, member: 4"].
 * Output safety: text content is kept entity-escaped as stored; attribute
 * values are escaped; only a fixed tag set is emitted. Unknown tags are
 * unwrapped so their text always survives.
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, "&quot;");

export function xfBbcodeToHtml(message: string): string {
  let out = message;

  // CODE first so its content is untouched by later rules.
  // [CODE=lang]…[/CODE] or [CODE]…[/CODE]
  out = out.replace(/\[code(?:=[^\]]*)?\]([\s\S]*?)\[\/code\]/gi, (_m, body: string) => `<pre>${body.trim()}</pre>`);

  out = out
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>")
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>")
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1</u>")
    .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, "<s>$1</s>");

  // Quotes. XenForo: [QUOTE="alice, post: 123, member: 4"] / [QUOTE=alice] / [QUOTE]
  out = out
    .replace(/\[quote=(?:&quot;|")?([^,\]"&]+)[^\]]*\]/gi, (_m, name: string) => `<blockquote><p><strong>${name.trim()} wrote:</strong></p>`)
    .replace(/\[quote\]/gi, "<blockquote>")
    .replace(/\[\/quote\]/gi, "</blockquote>");

  // Links + images. [URL='…'] / [URL="…"] / [URL=…] / [URL]…[/URL]
  out = out
    .replace(/\[url=(?:&#39;|'|&quot;|")?([^'"\]]+?)(?:&#39;|'|&quot;|")?\]([\s\S]*?)\[\/url\]/gi,
      (_m, href: string, label: string) => `<a href="${escapeAttr(href)}">${label}</a>`)
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_m, href: string) => `<a href="${escapeAttr(href)}">${href}</a>`)
    .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_m, src: string) => `<img src="${escapeAttr(src)}"/>`);

  // User mentions: [USER=4]@alice[/USER] → keep the visible text.
  out = out.replace(/\[user=\d+\]([\s\S]*?)\[\/user\]/gi, "$1");

  // Media embeds become plain links (we can't re-embed third-party players).
  out = out.replace(/\[media=([a-z0-9_-]+)\]([\s\S]*?)\[\/media\]/gi,
    (_m, site: string, id: string) => `<a href="${escapeAttr(`https://${site}.com/watch?v=${id}`)}">${escapeHtml(`${site}: ${id}`)}</a>`);

  // Attachments are not migrated in this version — leave a marker.
  out = out.replace(/\[attach[^\]]*\]([\s\S]*?)\[\/attach\]/gi, "[attachment]");

  // Lists: [LIST] / [LIST=1] with [*] items (no closing item tag in XF).
  out = out.replace(/\[list(=1)?\]([\s\S]*?)\[\/list\]/gi, (_m, ordered: string | undefined, body: string) => {
    const items = body
      .split(/\[\*\]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => `<li>${part}</li>`)
      .join("");
    return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
  });

  // Presentational / container tags we don't keep: unwrap.
  out = out.replace(/\[\/?(color|size|font|left|center|right|indent|spoiler|icode|heading)(?:=[^\]]*)?\]/gi, "");

  // XenForo stores literal newlines.
  return out.replace(/\r?\n/g, "<br/>").trim();
}

/**
 * Extract the bcrypt hash from xf_user_authenticate.data — a PHP-serialized
 * blob like `a:1:{s:4:"hash";s:60:"$2y$10$…";}`. Only XF:Core12 / bcrypt
 * scheme classes carry a directly usable hash; anything else (legacy import
 * schemes) returns null and the user resets their password once.
 */
export function extractBcryptHash(schemeClass: string, data: string | Buffer): string | null {
  if (!/bcrypt|core12/i.test(schemeClass)) return null;
  const text = typeof data === "string" ? data : data.toString("utf8");
  const match = /s:4:"hash";s:\d+:"(\$2[aby]\$[^"]+)"/.exec(text);
  return match?.[1] ?? null;
}

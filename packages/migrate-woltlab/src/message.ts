/**
 * WoltLab post text → safe HTML for forum_posts.body and articles.
 *
 * WoltLab Suite 3.0 and later store messages as HTML that WoltLab already cleaned,
 * plus a few custom elements of its own:
 *   <woltlab-quote data-author="alice" data-link="…">…</woltlab-quote>
 *   <woltlab-spoiler data-label="…">…</woltlab-spoiler>
 *   <woltlab-metacode data-name="attach|media|user|…" data-attributes="<base64 JSON>">…</woltlab-metacode>
 * Burning Board 4 (WCF 2.x) still stored BBCode, with quotes like [quote='alice','link'].
 *
 * We turn WoltLab's own elements into plain HTML and leave the rest; the loader then
 * runs every post through its allowlist (only safe tags, http/https/mailto links).
 */

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, "&quot;");

/** The value of `name="…"` in an element's attribute text, entity-decoded. */
function attrOf(attrs: string, name: string): string | null {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1]!.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : null;
}

/** data-attributes is base64 of a JSON array: ["https://youtu.be/…"] for media, [12] for attach. */
function metaAttributes(attrs: string): unknown[] {
  const raw = attrOf(attrs, "data-attributes");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const isHttp = (s: unknown): s is string => typeof s === "string" && /^https?:\/\//i.test(s);

/** Does this message look like WoltLab's stored HTML (rather than old BBCode)? */
export function isWoltlabHtml(message: string): boolean {
  return /<(p|br|woltlab-|strong|em|ul|ol|pre|a|img)[\s>/]/i.test(message);
}

export function woltlabHtmlToHtml(message: string): string {
  let out = message;

  // Smileys: keep what they mean, not a link to the old site's image.
  out = out.replace(/<img\b[^>]*class="[^"]*\bsmiley\b[^"]*"[^>]*>/gi, (tag) => escapeHtml(attrOf(tag, "alt") ?? ""));

  // Metacode elements carry their meaning in data-name / data-attributes.
  out = out.replace(/<woltlab-metacode\b([^>]*)>([\s\S]*?)<\/woltlab-metacode>/gi, (_m, attrs: string, inner: string) => {
    const name = (attrOf(attrs, "data-name") ?? "").toLowerCase();
    const args = metaAttributes(attrs);
    if (name === "attach" || name === "wsm") return "[attachment]";
    if (name === "media") {
      const url = args.find(isHttp) ?? (isHttp(inner.trim()) ? inner.trim() : null);
      return url ? `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>` : inner;
    }
    if (name === "url") {
      const url = args.find(isHttp);
      return url ? `<a href="${escapeAttr(url)}">${inner}</a>` : inner;
    }
    return inner; // user mentions, colours, fonts, spoilers…: the text stays
  });

  // Quotes become blockquotes, with the author when there is one.
  out = out
    .replace(/<woltlab-quote\b([^>]*)>/gi, (_m, attrs: string) => {
      const author = attrOf(attrs, "data-author");
      return author ? `<blockquote><p><strong>${escapeHtml(author)} wrote:</strong></p>` : "<blockquote>";
    })
    .replace(/<\/woltlab-quote>/gi, "</blockquote>");

  // Spoilers and any other WoltLab element: unwrap, the content stays.
  out = out.replace(/<\/?woltlab-[a-z-]+\b[^>]*>/gi, "");

  return out.trim();
}

// ── Burning Board 4 (WCF 2.x) BBCode ─────────────────────────────────────────

const safeHref = (url: string): string | null => {
  const u = url.trim().replace(/^['"]|['"]$/g, "");
  return /^(https?:|mailto:)/i.test(u) ? escapeAttr(u) : null;
};

export function wcfBbcodeToHtml(message: string): string {
  const kept: string[] = [];
  const keep = (html: string) => `${kept.push(html) - 1}`;

  let out = escapeHtml(message.replace(/\r\n?/g, "\n"));
  out = out.replace(/\[code(?:=[^\]]*)?\]([\s\S]*?)\[\/code\]/gi, (_m, body: string) => keep(`<pre>${body.replace(/^\n+|\n+$/g, "")}</pre>`));

  out = out
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>")
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>")
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1</u>")
    .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, "<s>$1</s>")
    // [quote='alice','https://…'] / [quote=alice] / [quote]
    .replace(/\[quote=(?:'|&quot;)?([^',\]]+?)(?:'|&quot;)?(?:,[^\]]*)?\]/gi, (_m, name: string) => `<blockquote><p><strong>${name.trim()} wrote:</strong></p>`)
    .replace(/\[quote\]/gi, "<blockquote>")
    .replace(/\[\/quote\]/gi, "</blockquote>")
    .replace(/\[url=([^\]]+?)\]([\s\S]*?)\[\/url\]/gi, (_m, href: string, label: string) => {
      const h = safeHref(href.replace(/&amp;/g, "&"));
      return h ? `<a href="${h}">${label}</a>` : label;
    })
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_m, href: string) => {
      const h = safeHref(href.replace(/&amp;/g, "&"));
      return h ? `<a href="${h}">${href}</a>` : href;
    })
    .replace(/\[img(?:=[^\]]*)?\]([\s\S]*?)\[\/img\]/gi, (_m, src: string) => {
      const h = safeHref(src.replace(/&amp;/g, "&"));
      return h && /^https?:/i.test(src.trim()) ? `<img src="${h}"/>` : "[image]";
    })
    .replace(/\[media\]([\s\S]*?)\[\/media\]/gi, (_m, url: string) => {
      const h = safeHref(url.replace(/&amp;/g, "&"));
      return h ? `<a href="${h}">${url.trim()}</a>` : url;
    })
    .replace(/\[user=[^\]]*\]([\s\S]*?)\[\/user\]/gi, "@$1")
    .replace(/\[attach[^\]]*\][\s\S]*?\[\/attach\]/gi, "[attachment]");

  out = out.replace(/\[list(=[^\]]*)?\]([\s\S]*?)\[\/list\]/gi, (_m, kind: string | undefined, body: string) => {
    const items = body.split(/\[\*\]/).map((x) => x.trim()).filter(Boolean).map((x) => `<li>${x}</li>`).join("");
    return kind ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
  });
  out = out.replace(/\[\/?(color|size|font|align|spoiler|tt|sub|sup|mark)(?:=[^\]]*)?\]/gi, "");

  out = out.replace(/\n/g, "<br/>").trim();
  return out.replace(/(\d+)/g, (_m, i: string) => kept[Number(i)] ?? "");
}

/** Either format, whichever this message is. */
export function woltlabMessageToHtml(message: string): string {
  return isWoltlabHtml(message) ? woltlabHtmlToHtml(message) : wcfBbcodeToHtml(message);
}

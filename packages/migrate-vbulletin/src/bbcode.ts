/**
 * vBulletin BBCode → safe HTML for forum_posts.body (vBulletin 3, 4, 5 and 6).
 *
 * vBulletin stores post text UNESCAPED and escapes it when it renders, keeping
 * numeric entities (`&#1234;`) that older boards used for characters outside their
 * charset. We do the same first (`escapeLikeVb`), so everything after this works on
 * escaped text and only emits a fixed set of tags. The loader sanitizes the result
 * once more before it is stored.
 *
 * Quote metadata differs by version: vB3/4 `[QUOTE=alice;123]`, vB5/6
 * `[QUOTE=alice;n123]`. Attachments are not migrated, so they leave a marker.
 */

/** PHP's htmlspecialchars_uni as vBulletin uses it: & < > " escaped, numeric entities kept. */
export function escapeLikeVb(text: string): string {
  return text
    .replace(/&(?!#[0-9]+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Text that is already escaped → safe inside a double-quoted attribute. */
const attr = (escaped: string) => escaped.trim().replace(/"/g, "&quot;");

/** Only links a browser can't turn into script: http(s), mailto, or a bare host. */
function safeHref(escaped: string): string | null {
  const raw = escaped.trim().replace(/&amp;/g, "&");
  if (/^(https?:|mailto:)/i.test(raw)) return attr(escaped);
  if (/^www\./i.test(raw)) return attr(`http://${escaped.trim()}`);
  return null;
}

/** vB5's [IMG2=JSON]{"src":"…",…}[/IMG2]: the image address, if it has one. */
function img2Src(escapedJson: string): string | null {
  try {
    const json = JSON.parse(escapedJson.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as { src?: unknown };
    return typeof json.src === "string" ? json.src : null;
  } catch {
    return null;
  }
}

const HEADING = (level: string) => (Number(level) <= 2 ? "h2" : Number(level) === 3 ? "h3" : "h4");

export function vbBbcodeToHtml(message: string): string {
  // Code-like blocks are set aside before anything else so no rule touches them
  // (as private-use placeholders, which no post contains).
  const kept: string[] = [];
  const keep = (html: string) => `\uE000${kept.push(html) - 1}\uE001`;

  let out = escapeLikeVb(message.replace(/\r\n?/g, "\n"));

  out = out.replace(/\[(code|php|html)(?:=[^\]]*)?\]([\s\S]*?)\[\/\1\]/gi, (_m, _t, body: string) =>
    keep(`<pre>${body.replace(/^\n+|\n+$/g, "")}</pre>`));
  out = out.replace(/\[noparse\]([\s\S]*?)\[\/noparse\]/gi, (_m, body: string) => keep(body));

  out = out
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>")
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>")
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1</u>")
    .replace(/\[(?:s|strike)\]([\s\S]*?)\[\/(?:s|strike)\]/gi, "<s>$1</s>")
    .replace(/\[highlight\]([\s\S]*?)\[\/highlight\]/gi, "<strong>$1</strong>")
    .replace(/\[h=(\d)\]([\s\S]*?)\[\/h\]/gi, (_m, lvl: string, body: string) => `<${HEADING(lvl)}>${body}</${HEADING(lvl)}>`)
    .replace(/\[hr\]\s*(?:\[\/hr\])?/gi, "<hr/>");

  // Quotes: [QUOTE=alice;123], [QUOTE=alice;n123], [QUOTE=&quot;alice&quot;], [QUOTE].
  out = out
    .replace(/\[quote=(?:&quot;)?([^\];]+?)(?:&quot;)?(?:;[^\]]*)?\]/gi,
      (_m, name: string) => `<blockquote><p><strong>${name.trim()} wrote:</strong></p>`)
    .replace(/\[quote\]/gi, "<blockquote>")
    .replace(/\[\/quote\]/gi, "</blockquote>");

  // Links. [URL=…]label[/URL], [URL]…[/URL], [EMAIL=…]label[/EMAIL], [EMAIL]…[/EMAIL].
  out = out
    .replace(/\[url=(?:&quot;|')?([^\]]+?)(?:&quot;|')?\]([\s\S]*?)\[\/url\]/gi, (_m, href: string, label: string) => {
      const h = safeHref(href);
      return h ? `<a href="${h}">${label}</a>` : label;
    })
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_m, href: string) => {
      const h = safeHref(href);
      return h ? `<a href="${h}">${href.trim()}</a>` : href;
    })
    .replace(/\[email=([^\]]+?)\]([\s\S]*?)\[\/email\]/gi, (_m, to: string, label: string) => `<a href="mailto:${attr(to)}">${label}</a>`)
    .replace(/\[email\]([\s\S]*?)\[\/email\]/gi, (_m, to: string) => `<a href="mailto:${attr(to)}">${to.trim()}</a>`);

  // Images. [IMG]…[/IMG] (with or without options), vB5 [IMG2=JSON]…[/IMG2].
  out = out
    .replace(/\[img(?:[^\]]*)\]([\s\S]*?)\[\/img\]/gi, (_m, src: string) =>
      /^https?:/i.test(src.trim()) ? `<img src="${attr(src)}"/>` : "[image]")
    .replace(/\[img2=json\]([\s\S]*?)\[\/img2\]/gi, (_m, json: string) => {
      const src = img2Src(json);
      return src && /^https?:/i.test(src) ? `<img src="${attr(escapeLikeVb(src))}"/>` : "[image]";
    });

  // Videos become links to what they showed; we can't re-embed third-party players.
  out = out.replace(/\[video=([a-z0-9_-]+);([^\]]*)\]([\s\S]*?)\[\/video\]/gi, (_m, site: string, id: string, url: string) => {
    const h = safeHref(url);
    return h ? `<a href="${h}">${url.trim()}</a>` : `${site}: ${id}`;
  });

  // Mentions keep the visible name.
  out = out.replace(/\[(?:mention|user)=[^\]]*\]([\s\S]*?)\[\/(?:mention|user)\]/gi, "@$1");

  // Attachments aren't migrated in this version: leave a marker.
  out = out
    .replace(/\[attach[^\]]*\][\s\S]*?\[\/attach\]/gi, "[attachment]")
    .replace(/\[sigpic\][\s\S]*?\[\/sigpic\]/gi, "");

  // Lists: [LIST], [LIST=1], [LIST=a] with [*] items (closing [/*] optional).
  out = out.replace(/\[list(=[^\]]*)?\]([\s\S]*?)\[\/list\]/gi, (_m, kind: string | undefined, body: string) => {
    const items = body
      .replace(/\[\/\*\]/g, "")
      .split(/\[\*\]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => `<li>${part}</li>`)
      .join("");
    return kind ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
  });

  // Presentational and layout tags we don't keep: unwrap, the text stays.
  out = out.replace(/\[\/?(color|size|font|left|center|right|indent|table|tr|td|th|spoiler|icode)(?:=[^\]]*)?\]/gi, "");

  out = out.replace(/\n/g, "<br/>").trim();
  // Restore the code blocks; their content is escaped and their newlines are real.
  return out.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => kept[Number(i)] ?? "");
}

/** vBulletin stores usernames and titles HTML-escaped. Xentium wants plain text. */
export function unescapeVb(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

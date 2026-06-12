import { parseDocument } from "htmlparser2";

/**
 * phpBB post text → safe HTML for forum_posts.body.
 *
 * phpBB stores posts in two formats depending on version:
 *  - 3.0/3.1 "legacy": HTML-escaped text with uid-mangled BBCode, e.g.
 *      `some [b:1a2b3c]bold[/b:1a2b3c]<!-- s:) --><img … /><!-- s:) -->`
 *  - 3.2+ "s9e text-formatter": XML, either `<t>escaped text<br/></t>` for
 *    plain posts or `<r><B><s>[b]</s>bold<e>[/e]</e></B>…</r>` for rich ones.
 *
 * Output safety: legacy text content is already entity-escaped by phpBB and
 * is never unescaped here; s9e text nodes are re-escaped after parsing. Only
 * a fixed tag set is ever emitted.
 */
export function convertPostText(postText: string, bbcodeUid: string | null | undefined): string {
  const trimmed = postText.trimStart();
  if (trimmed.startsWith("<r>") || trimmed.startsWith("<t>")) return convertS9e(postText);
  return convertLegacy(postText, bbcodeUid ?? "");
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, "&quot;");

// ── legacy (3.0/3.1, bbcode_uid) ─────────────────────────────────────────────

function convertLegacy(text: string, uid: string): string {
  let out = text;

  // Smilies: `<!-- s:) --><img … /><!-- s:) -->` → the smiley code itself.
  out = out.replace(/<!-- s(.+?) -->[\s\S]*?<!-- s.+? -->/g, (_m, code: string) => code);
  // Magic links keep their anchor, the comment markers go.
  out = out.replace(/<!-- [mwe] -->/g, "");
  out = out.replace(/<a class="postlink[^"]*"/g, "<a");
  // Any other generated comment.
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  // Strip the per-post uid exactly like phpBB does (str_replace ':uid').
  if (uid) out = out.split(`:${uid}`).join("");

  // Code first so its content is not touched by later rules.
  out = out.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_m, body: string) => `<pre>${body.trim()}</pre>`);

  out = out
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>")
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>")
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1</u>")
    .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, "<s>$1</s>");

  // Quotes: [quote="name"] / [quote=&quot;name&quot;] / [quote]
  out = out
    .replace(/\[quote=(?:&quot;|")(.*?)(?:&quot;|")\]/gi, (_m, name: string) => `<blockquote><p><strong>${name} wrote:</strong></p>`)
    .replace(/\[quote\]/gi, "<blockquote>")
    .replace(/\[\/quote\]/gi, "</blockquote>");

  // Links + images. Attribute values are escaped defensively.
  out = out
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_m, href: string, label: string) => `<a href="${escapeAttr(href)}">${label}</a>`)
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_m, href: string) => `<a href="${escapeAttr(href)}">${href}</a>`)
    .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_m, src: string) => `<img src="${escapeAttr(src)}"/>`);

  // Lists. After uid-stripping, closers look like [/list:u], [/list:o],
  // items like [*] with closers [/*:m].
  out = out
    .replace(/\[list=1\]/gi, "<ol>")
    .replace(/\[list(?:=[^\]]*)?\]/gi, "<ul>")
    .replace(/\[\/list(?::[ou])?\]/gi, "</ul>")
    .replace(/\[\/\*(?::m)?\]/gi, "</li>")
    .replace(/\[\*\]/g, "<li>");

  // Presentational tags we don't keep: unwrap.
  out = out.replace(/\[\/?(color|size|font|align)(?:=[^\]]*)?\]/gi, "");

  // Legacy posts store literal newlines.
  return out.replace(/\r?\n/g, "<br/>");
}

// ── s9e text-formatter XML (3.2+) ────────────────────────────────────────────

interface XmlNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: XmlNode[];
}

function convertS9e(xml: string): string {
  const dom = parseDocument(xml, { xmlMode: true }) as unknown as { children: XmlNode[] };
  return walk(dom.children ?? []).trim();
}

function walk(nodes: XmlNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += escapeHtml(node.data ?? "");
      continue;
    }
    if (node.type !== "tag" || !node.name) continue;
    const name = node.name;
    const kids = node.children ?? [];

    switch (name) {
      // Markup-source elements: the raw "[b]" / "[/b]" strings — drop them.
      case "s": case "e": break;
      // Containers.
      case "t": case "r": case "p": out += walk(kids); break;
      case "br": out += "<br/>"; break;
      case "B": out += `<strong>${walk(kids)}</strong>`; break;
      case "I": out += `<em>${walk(kids)}</em>`; break;
      case "U": out += `<u>${walk(kids)}</u>`; break;
      case "S": out += `<s>${walk(kids)}</s>`; break;
      case "CODE": out += `<pre>${walk(kids).trim()}</pre>`; break;
      case "QUOTE": {
        const author = node.attribs?.author;
        out += `<blockquote>${author ? `<p><strong>${escapeHtml(author)} wrote:</strong></p>` : ""}${walk(kids)}</blockquote>`;
        break;
      }
      case "URL": {
        const href = node.attribs?.url ?? "";
        out += `<a href="${escapeAttr(href)}">${walk(kids)}</a>`;
        break;
      }
      case "EMAIL": {
        const email = node.attribs?.email ?? "";
        out += `<a href="mailto:${escapeAttr(email)}">${walk(kids)}</a>`;
        break;
      }
      case "IMG": {
        const src = node.attribs?.src ?? "";
        out += `<img src="${escapeAttr(src)}"/>`;
        break;
      }
      case "LIST":
        out += node.attribs?.type ? `<ol>${walk(kids)}</ol>` : `<ul>${walk(kids)}</ul>`;
        break;
      case "LI": out += `<li>${walk(kids)}</li>`; break;
      // Emoticons render as their text code (inside <s>…</s>? No — E wraps the code).
      case "E": out += escapeHtml(textOf(kids)); break;
      // Unknown extension tags: unwrap, text survives.
      default: out += walk(kids);
    }
  }
  return out;
}

function textOf(nodes: XmlNode[]): string {
  return nodes.map((n) => (n.type === "text" ? n.data ?? "" : textOf(n.children ?? []))).join("");
}

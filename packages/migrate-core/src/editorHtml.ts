import { htmlToTipTap, type TipTapNode } from "./htmlToTipTap.js";
import { smileysToEmoji } from "./smileys.js";

/**
 * Imported post HTML → the HTML our editor itself would save.
 *
 * Posts are written in the editor and stored as its HTML, and the forum renders and
 * re-edits exactly that. An imported post in any other shape (line breaks instead of
 * paragraphs, a bare <pre> with no <code>, an outside image) would look different
 * from a native one and change the first time someone edited it. So we parse it into
 * the editor's document model (the same converter articles use) and print it back the
 * way the editor prints it.
 *
 * The editor doesn't keep images from other sites in posts, so an image becomes a
 * link to it; nothing is lost and editing the post changes nothing.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

const MARK_ORDER = ["link", "bold", "italic", "underline", "strike", "code"];
const OPEN: Record<string, (attrs?: Record<string, unknown>) => string> = {
  bold: () => "<strong>", italic: () => "<em>", underline: () => "<u>", strike: () => "<s>", code: () => "<code>",
  link: (a) => `<a target="_blank" rel="noopener noreferrer nofollow" href="${escAttr(String(a?.href ?? ""))}">`,
};
const CLOSE: Record<string, string> = { bold: "</strong>", italic: "</em>", underline: "</u>", strike: "</s>", code: "</code>", link: "</a>" };

function inline(nodes: TipTapNode[] = []): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "hardBreak") { out += "<br>"; continue; }
    if (n.type === "image") {
      const src = String(n.attrs?.src ?? "");
      if (/^https?:\/\//i.test(src)) out += OPEN.link!({ href: src }) + esc(String(n.attrs?.alt || src)) + "</a>";
      continue;
    }
    if (n.type !== "text") continue;
    const marks = [...(n.marks ?? [])].sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    // Smiley codes become emoji, except in code and in link text (a URL is a URL).
    const plain = marks.some((m) => m.type === "code" || m.type === "link") ? (n.text ?? "") : smileysToEmoji(n.text ?? "");
    out += marks.map((m) => OPEN[m.type]?.(m.attrs) ?? "").join("") + esc(plain) +
      [...marks].reverse().map((m) => CLOSE[m.type] ?? "").join("");
  }
  return out;
}

function block(n: TipTapNode): string {
  switch (n.type) {
    case "paragraph": {
      // The editor never starts or ends a paragraph with an empty line.
      const content = [...(n.content ?? [])];
      while (content[0]?.type === "hardBreak") content.shift();
      while (content.at(-1)?.type === "hardBreak") content.pop();
      return `<p>${inline(content)}</p>`;
    }
    case "heading": {
      const lvl = Math.min(Math.max(Number(n.attrs?.level ?? 2), 1), 6);
      return `<h${lvl}>${inline(n.content)}</h${lvl}>`;
    }
    case "bulletList": return `<ul>${(n.content ?? []).map(block).join("")}</ul>`;
    case "orderedList": {
      const start = Number(n.attrs?.start ?? 1);
      return `<ol${start !== 1 ? ` start="${start}"` : ""}>${(n.content ?? []).map(block).join("")}</ol>`;
    }
    case "listItem": return `<li>${(n.content ?? []).map(block).join("")}</li>`;
    case "blockquote": return `<blockquote>${(n.content ?? []).map(block).join("")}</blockquote>`;
    case "codeBlock": return `<pre><code>${esc((n.content ?? []).map((c) => c.text ?? "").join(""))}</code></pre>`;
    case "horizontalRule": return "<hr>";
    case "image": return `<p>${inline([n])}</p>`;
    default: return n.content ? (n.content).map(block).join("") : "";
  }
}

/** Turns runs of line breaks into paragraphs when a post has no block structure at all. */
function paragraphsFromBreaks(html: string): string {
  if (/<\s*(p|h[1-6]|ul|ol|blockquote|pre|div|table)\b/i.test(html)) return html;
  return html
    .split(/(?:<br\s*\/?>\s*){2,}/i)
    .map((chunk) => chunk.replace(/^(?:\s|<br\s*\/?>)+|(?:\s|<br\s*\/?>)+$/gi, ""))
    .filter(Boolean)
    .map((chunk) => `<p>${chunk}</p>`)
    .join("");
}

export function toEditorHtml(html: string): string {
  const doc = htmlToTipTap(paragraphsFromBreaks(html));
  const out = (doc.content ?? []).map(block).join("");
  return out || "<p></p>";
}

import { parseDocument } from "htmlparser2";

/**
 * Source-HTML → TipTap (ProseMirror) JSON for the migration loader.
 * Articles are stored as TipTap JSON, never raw HTML (§17b) — so every
 * adapter's HTML goes through this converter. Coverage targets the tags the
 * source platforms actually emit (paragraphs, headings, lists, quotes, code,
 * images, links, basic marks); unknown blocks degrade to paragraphs and
 * unknown inline tags to plain text, so content is never lost.
 */

export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

// Minimal structural view of htmlparser2's DOM (avoids depending on domhandler).
interface DomNode {
  type: string; // "text" | "tag" | "script" | "style" | "comment" | ...
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: DomNode[];
}

type Mark = { type: string; attrs?: Record<string, unknown> };

const BLOCK_TAG_RE = /<\s*(p|h[1-6]|ul|ol|blockquote|pre|div|table|figure)\b/i;

const MARK_TAGS: Record<string, string> = {
  strong: "bold", b: "bold",
  em: "italic", i: "italic",
  u: "underline",
  s: "strike", del: "strike", strike: "strike",
  code: "code",
};

/**
 * WordPress stores post content with blank lines instead of <p> tags
 * (paragraphs are added at render time by wpautop). When the HTML has no
 * block-level tags at all, reproduce that: blank lines split paragraphs,
 * single newlines become <br>.
 */
function wpautop(html: string): string {
  if (BLOCK_TAG_RE.test(html)) return html;
  return html
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => `<p>${chunk.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function textNode(text: string, marks: Mark[]): TipTapNode {
  const node: TipTapNode = { type: "text", text };
  if (marks.length) node.marks = marks;
  return node;
}

/** Inline content of an element, with accumulated marks. */
function inlineContent(nodes: DomNode[], marks: Mark[]): TipTapNode[] {
  const out: TipTapNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const text = (node.data ?? "").replace(/\s+/g, " ");
      if (text.trim() === "" && out.length === 0) continue; // leading whitespace
      if (text !== "") out.push(textNode(text, marks));
      continue;
    }
    if (node.type !== "tag" || !node.name) continue;
    const tag = node.name.toLowerCase();

    if (tag === "br") {
      out.push({ type: "hardBreak" });
    } else if (tag === "img" && node.attribs?.src) {
      out.push({ type: "image", attrs: { src: node.attribs.src, alt: node.attribs.alt ?? null, title: node.attribs.title ?? null } });
    } else if (tag === "a" && node.attribs?.href) {
      out.push(...inlineContent(node.children ?? [], [...marks, { type: "link", attrs: { href: node.attribs.href } }]));
    } else if (MARK_TAGS[tag]) {
      out.push(...inlineContent(node.children ?? [], [...marks, { type: MARK_TAGS[tag]! }]));
    } else {
      // Unknown inline tag (span, font, …): keep its text.
      out.push(...inlineContent(node.children ?? [], marks));
    }
  }
  // Trim a trailing whitespace-only text node.
  const last = out[out.length - 1];
  if (last?.type === "text" && last.text?.trim() === "") out.pop();
  return mergeAdjacentText(out);
}

/** Adjacent text nodes with identical marks collapse into one. */
function mergeAdjacentText(nodes: TipTapNode[]): TipTapNode[] {
  const out: TipTapNode[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (
      node.type === "text" && prev?.type === "text" &&
      JSON.stringify(prev.marks ?? []) === JSON.stringify(node.marks ?? [])
    ) {
      prev.text = (prev.text ?? "") + (node.text ?? "");
    } else {
      out.push(node);
    }
  }
  return out;
}

function paragraph(content: TipTapNode[]): TipTapNode {
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function listItems(nodes: DomNode[]): TipTapNode[] {
  const items: TipTapNode[] = [];
  for (const node of nodes) {
    if (node.type !== "tag" || node.name?.toLowerCase() !== "li") continue;
    const blocks = blockContent(node.children ?? []);
    items.push({ type: "listItem", content: blocks.length ? blocks : [paragraph([])] });
  }
  return items;
}

function elementText(node: DomNode): string {
  if (node.type === "text") return node.data ?? "";
  return (node.children ?? []).map(elementText).join("");
}

/** Block-level content of a node list. Stray inline content is wrapped. */
function blockContent(nodes: DomNode[]): TipTapNode[] {
  const blocks: TipTapNode[] = [];
  let pendingInline: DomNode[] = [];

  const flushInline = () => {
    if (!pendingInline.length) return;
    const content = inlineContent(pendingInline, []);
    if (content.length) blocks.push(paragraph(content));
    pendingInline = [];
  };

  for (const node of nodes) {
    const tag = node.type === "tag" ? node.name?.toLowerCase() : undefined;

    if (node.type === "text" || (node.type === "tag" && !isBlockTag(tag!))) {
      if (node.type === "text" && (node.data ?? "").trim() === "") continue;
      pendingInline.push(node);
      continue;
    }
    if (node.type !== "tag" || !tag) continue;

    flushInline();
    switch (tag) {
      case "p": {
        const content = inlineContent(node.children ?? [], []);
        blocks.push(paragraph(content));
        break;
      }
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
        blocks.push({ type: "heading", attrs: { level: Number(tag[1]) }, content: inlineContent(node.children ?? [], []) });
        break;
      case "ul":
        blocks.push({ type: "bulletList", content: listItems(node.children ?? []) });
        break;
      case "ol":
        blocks.push({ type: "orderedList", attrs: { start: Number(node.attribs?.start ?? 1) }, content: listItems(node.children ?? []) });
        break;
      case "blockquote":
        blocks.push({ type: "blockquote", content: blockContent(node.children ?? []) });
        break;
      case "pre": {
        const code = elementText(node).replace(/\n$/, "");
        blocks.push({ type: "codeBlock", content: code ? [{ type: "text", text: code }] : [] });
        break;
      }
      case "hr":
        blocks.push({ type: "horizontalRule" });
        break;
      case "figure": case "div": case "table": case "section": case "article":
        // Containers we don't model: recurse so their content survives.
        blocks.push(...blockContent(node.children ?? []));
        break;
      default:
        blocks.push(...blockContent(node.children ?? []));
    }
  }
  flushInline();
  return blocks;
}

function isBlockTag(tag: string): boolean {
  return /^(p|h[1-6]|ul|ol|blockquote|pre|hr|figure|div|table|section|article)$/.test(tag);
}

/** Convert source HTML to a TipTap document. Never throws; never empty. */
export function htmlToTipTap(html: string): TipTapNode {
  const dom = parseDocument(wpautop(html)) as unknown as { children: DomNode[] };
  const content = blockContent(dom.children ?? []);
  return { type: "doc", content: content.length ? content : [paragraph([])] };
}

/** Plain-text extraction (search vectors, excerpts, plain-text comments). */
export function htmlToText(html: string): string {
  const dom = parseDocument(html) as unknown as { children: DomNode[] };
  const walk = (nodes: DomNode[]): string =>
    nodes
      .map((n) => {
        if (n.type === "text") return n.data ?? "";
        if (n.type !== "tag") return "";
        const tag = n.name?.toLowerCase() ?? "";
        const inner = walk(n.children ?? []);
        return isBlockTag(tag) || tag === "br" ? `${inner}\n` : inner;
      })
      .join("");
  return walk(dom.children ?? []).replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
}

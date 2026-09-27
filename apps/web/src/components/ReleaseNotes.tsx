import { Fragment, type ReactNode } from "react";
import "./ReleaseNotes.scss";

/**
 * Release notes, as the Xentium team writes them: the CHANGELOG's Markdown.
 *
 * Deliberately a small reader for the subset a changelog uses (headings, lists,
 * paragraphs, code blocks, `code`, **bold**, *emphasis*, links), not a
 * Markdown library. It builds React elements and never HTML, so nothing in a
 * note can inject markup into the ACP; a link is kept only when it is http(s).
 */

export type NoteBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*```/;

export function parseNotes(source: string): NoteBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ...list });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (FENCE.test(line)) {
      flushParagraph(); flushList();
      const code: string[] = [];
      while (++i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i]!);
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph(); flushList();
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]!.trim() });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!.trim());
      continue;
    }

    // An indented line under a list item is that item wrapping onto a new line.
    if (list && /^\s+/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph(); flushList();
  return blocks;
}

// `code` first so nothing inside it is read as emphasis; then links, bold, emphasis.
// Underscores only count at word edges, or `xcf_oauth_accounts` turns italic.
const INLINE = /(`[^`]+`)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(?<!\w)__([^_]+)__(?!\w)|\*([^*\s][^*]*)\*|(?<!\w)_([^_]+)_(?!\w)/g;

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const [whole, code, linkText, href, bold1, bold2, em1, em2] = m;
    if (code) out.push(<code key={key++}>{code.slice(1, -1)}</code>);
    else if (linkText) {
      out.push(/^https?:\/\//i.test(href!)
        ? <a key={key++} href={href} target="_blank" rel="noopener noreferrer">{renderInline(linkText)}</a>
        : <Fragment key={key++}>{renderInline(linkText)}</Fragment>);
    } else if (bold1 ?? bold2) out.push(<strong key={key++}>{renderInline((bold1 ?? bold2)!)}</strong>);
    else if (em1 ?? em2) out.push(<em key={key++}>{em1 ?? em2}</em>);
    else out.push(whole);
    last = m.index! + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function ReleaseNotes({ source }: { source: string }) {
  return (
    <div className="release-notes">
      {parseNotes(source).map((block, i) => {
        switch (block.kind) {
          case "heading": {
            // A changelog's "#" is the release title the dialog already shows;
            // everything steps down so the notes never out-shout their frame.
            const Tag = (block.level <= 2 ? "h4" : "h5") as "h4" | "h5";
            return <Tag key={i} className="release-notes__h">{renderInline(block.text)}</Tag>;
          }
          case "paragraph":
            return <p key={i}>{renderInline(block.text)}</p>;
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return <Tag key={i}>{block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}</Tag>;
          }
          case "code":
            return <pre key={i}><code>{block.text}</code></pre>;
        }
      })}
    </div>
  );
}

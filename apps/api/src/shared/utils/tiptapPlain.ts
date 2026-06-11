// Extracts plain text from a TipTap / ProseMirror JSON document.
//
// Stored body is canonical ProseMirror JSON (§17b). The articles.body_plain
// column is used only by the search vector trigger (§5/§54) — never rendered
// as HTML. Block boundaries become single newlines so phrase search inside
// a paragraph still works but cross-block matches don't.

export interface TiptapNode {
  type?: string;
  text?: string;
  content?: TiptapNode[];
}

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
]);

export function tiptapToPlain(doc: unknown): string {
  if (doc == null || typeof doc !== "object") return "";
  const out: string[] = [];
  walk(doc as TiptapNode, out);
  return out.join("").trim();
}

function walk(node: TiptapNode, out: string[]): void {
  if (typeof node.text === "string") {
    out.push(node.text);
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) walk(child, out);
  }
  if (node.type && BLOCK_TYPES.has(node.type)) {
    out.push("\n");
  }
}

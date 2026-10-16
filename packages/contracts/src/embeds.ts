/**
 * Embeds: plugin content shown inside written content (a poll in a forum post or
 * an article).
 *
 * The content stores only a placeholder, never the plugin's data:
 *
 *   <div class="xt-embed" data-xt-embed="poll" data-id="3f2c…"></div>
 *
 * and, in a ProseMirror document, an `xtEmbed` node with `{ type, id }`. Wherever
 * the content is drawn, the page swaps the placeholder for the plugin's renderer.
 * When the content is saved or deleted, core tells the plugin which of its items
 * the content now holds, so the plugin can attach them or clean them up.
 *
 * One definition, used by the server sanitizer, the server's extractor and the
 * editor node, so the three can never disagree about what a placeholder is.
 */

/** Lowercase letters, digits and dashes. */
export const EMBED_TYPE_RE = /^[a-z][a-z0-9-]{0,39}$/;
/** A plugin's own id for the item: letters, digits, `_` and `-` (UUIDs fit). */
export const EMBED_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** The ProseMirror node name. */
export const EMBED_NODE = "xtEmbed";

export interface EmbedRef { type: string; id: string }

export const isEmbedRef = (v: { type?: unknown; id?: unknown }): v is EmbedRef =>
  typeof v.type === "string" && EMBED_TYPE_RE.test(v.type) &&
  typeof v.id === "string" && EMBED_ID_RE.test(v.id);

/**
 * Every embed in a piece of content — HTML (forum posts, comments) or a
 * ProseMirror document (articles). Duplicates are kept once, in document order.
 * Anything malformed is ignored, never thrown on: content is user input.
 */
export function extractEmbeds(content: unknown): EmbedRef[] {
  const out: EmbedRef[] = [];
  const seen = new Set<string>();
  const add = (ref: { type?: unknown; id?: unknown }) => {
    if (!isEmbedRef(ref)) return;
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type: ref.type, id: ref.id });
  };

  if (typeof content === "string") {
    // Attribute order is not guaranteed, so each placeholder tag is read on its own.
    for (const tag of content.match(/<div\b[^>]*\bdata-xt-embed\s*=[^>]*>/gi) ?? []) {
      const attr = (name: string) =>
        new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
      const t = attr("data-xt-embed");
      const i = attr("data-id");
      add({ type: t?.[2] ?? t?.[3], id: i?.[2] ?? i?.[3] });
    }
    return out;
  }

  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 200) return;
    const n = node as { type?: unknown; attrs?: { type?: unknown; id?: unknown }; content?: unknown };
    if (n.type === EMBED_NODE && n.attrs) add(n.attrs);
    if (Array.isArray(n.content)) for (const c of n.content) walk(c, depth + 1);
  };
  walk(content, 0);
  return out;
}

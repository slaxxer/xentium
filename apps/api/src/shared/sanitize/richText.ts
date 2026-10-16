import sanitizeHtml from "sanitize-html";
import { EMBED_ID_RE, EMBED_TYPE_RE } from "@xentium/contracts";

// Server-side HTML sanitizer for all user-authored rich text written through a
// TipTap / MiniEditor / ForumEditor surface (article comments §33, profile-wall
// comments §40, forum threads/posts §21, private messages). The clients submit
// `editor.getHTML()`, so the API receives HTML — it MUST be sanitized on write
// before storage, because the frontend renders these bodies via
// `dangerouslySetInnerHTML`. The strict CSP (script-src 'self') already blocks
// inline JS, but sanitization is the actual control: it strips <script>, event
// handlers, javascript: URLs, <iframe>/<object>, and any tag/attribute outside the
// allowlist below.
//
// The allowlist is EXACTLY what the editor (components/composer) produces — no more,
// because a tag here is a decision, and no less, because anything the toolbar
// offers but this strips is formatting a member sees in the editor and loses on
// posting (alignment, sub/superscript, task lists and mentions all were). If the
// editor gains a tool, its output goes here in the same change.

const TEXT_ALIGN = [/^(left|right|center|justify)$/];
const ALIGNABLE = ["p", "h1", "h2", "h3", "h4", "h5", "h6"] as const;

const ALLOWED_TAGS = [
  "p", "br", "hr", "div",
  "strong", "b", "em", "i", "u", "s", "strike", "del", "mark", "sub", "sup",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  // A task item is `<li><label><input type="checkbox"><span></span></label><div>…</div></li>`.
  "label", "input",
  "blockquote", "pre", "code",
  "a", "span",
  // A custom emoji (ACP → Content → Emojis) — and ONLY that: see `exclusiveFilter`.
  "img",
];

/** An emoji image's `src`: our own emoji directory, a plain file name, nothing else. */
const EMOJI_SRC = /^\/uploads\/emojis\/[\w.-]+$/;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    // Mentions are links: `<a class="nvc-mention" data-type="mention" data-id=…>`.
    a: ["href", "title", "target", "rel", "class", "data-type", "data-id", "data-label"],
    span: ["class", "data-type", "data-id", "data-label"],
    code: ["class"],
    pre: ["class"],
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
    input: ["type", "checked", "disabled"],
    img: ["src", "alt", "title", "class", "data-code"],
    // A plugin embed's placeholder (a poll): `<div class="xt-embed" data-xt-embed=… data-id=…>`.
    // It carries only a reference; the plugin's own endpoint decides who sees what.
    div: ["class", "data-xt-embed", "data-id"],
    // Alignment is an inline style — the only style allowed, and only these values.
    ...Object.fromEntries(ALIGNABLE.map((tag) => [tag, ["style"]])),
  },
  allowedStyles: Object.fromEntries(ALIGNABLE.map((tag) => [tag, { "text-align": TEXT_ALIGN }])),
  allowedClasses: {
    a: ["nvc-mention"],
    span: ["nvc-mention", "mention"],
    code: [/^language-[\w-]+$/],
    pre: [/^language-[\w-]+$/],
    img: ["xt-emoji"],
    div: ["xt-embed"],
  },
  // Only safe link protocols — blocks javascript:, data:, vbscript:, etc.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  transformTags: {
    // Force external links to be safe (no reverse-tabnabbing, no referrer leak).
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow" }),
    // A stored task box is a picture of the state, never a form control.
    // An embed placeholder keeps its attributes only when BOTH are well-formed (the
    // shared contract's rules); anything else becomes a plain div.
    div: (tagName, attribs): sanitizeHtml.Tag => {
      const type = attribs["data-xt-embed"];
      const id = attribs["data-id"];
      return type !== undefined && EMBED_TYPE_RE.test(type) && id !== undefined && EMBED_ID_RE.test(id)
        ? { tagName, attribs: { class: "xt-embed", "data-xt-embed": type, "data-id": id } }
        : { tagName, attribs: {} as sanitizeHtml.Attributes };
    },
    input: (tagName, attribs) => ({
      tagName,
      attribs: { type: "checkbox", disabled: "disabled", ...(attribs.checked !== undefined ? { checked: "checked" } : {}) },
    }),
  },
  // Only a checkbox may be an input (the transform above has already made every
  // input one; this keeps that true if the transform ever changes). And the only image
  // is a custom emoji from our own emoji directory: a post cannot carry a tracker
  // pixel or someone else's picture by dressing it up as one.
  exclusiveFilter: (frame) =>
    (frame.tag === "input" && frame.attribs.type !== "checkbox")
    || (frame.tag === "img" && (frame.attribs.class !== "xt-emoji" || !EMOJI_SRC.test(frame.attribs.src ?? ""))),
  // Drop the contents of disallowed tags entirely (e.g. <script>…</script>),
  // rather than keeping the inner text.
  disallowedTagsMode: "discard",
};

/**
 * Sanitize user-authored rich-text HTML for safe storage + render.
 * Returns a clean HTML string containing only allowlisted tags/attributes.
 */
export function sanitizeRichText(html: string): string {
  if (!html) return html;
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

import sanitizeHtml from "sanitize-html";

// Server-side HTML sanitizer for all user-authored rich text written through a
// TipTap / MiniEditor / ForumEditor surface (article comments §33, profile-wall
// comments §40, forum threads/posts §21). The clients submit `editor.getHTML()`,
// so the API receives HTML — it MUST be sanitized on write before storage,
// because the frontend renders these bodies via `dangerouslySetInnerHTML`. The
// strict CSP (script-src 'self') already blocks inline JS, but sanitization is
// the actual control: it strips <script>, event handlers, javascript: URLs,
// <iframe>/<object>, and any tag/attribute outside the allowlist below.
//
// The allowlist is intentionally the small set our editors can produce — adding
// a tag here is a deliberate decision, not a default. Anything richer (images,
// custom embeds) must be added explicitly and reviewed.

const ALLOWED_TAGS = [
  "p", "br", "hr",
  "strong", "b", "em", "i", "u", "s", "strike", "del", "mark",
  "h1", "h2", "h3", "h4",
  "ul", "ol", "li",
  "blockquote", "pre", "code",
  "a", "span",
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    span: ["class"],
    code: ["class"],
    pre: ["class"],
  },
  // Only safe link protocols — blocks javascript:, data:, vbscript:, etc.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  // Force external links to be safe (no reverse-tabnabbing, no referrer leak).
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow" }),
  },
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

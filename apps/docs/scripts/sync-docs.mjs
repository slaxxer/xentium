/**
 * Pull the repo's developer docs into the wiki's content tree.
 *
 * The sources stay where they are — `docs/*.md`, `README.md`, `CONTRIBUTING.md` —
 * because code comments all over the repo point at `docs/<name>.md`, and a doc edited
 * in the same PR as the code it describes is the only kind that stays true. This
 * script turns them into Starlight pages at build time; its output is gitignored.
 *
 * ⚠ An ALLOWLIST, never a glob. `docs/` also holds internal notes (detection logic,
 * rename bookkeeping, an architecture review) and `d0cs/` is private design. A new
 * file must be added here on purpose to become public — a glob would publish
 * whatever landed in the folder next.
 *
 *   node scripts/sync-docs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const OUT  = path.resolve(HERE, "../src/content/docs");
const GITHUB = "https://github.com/slaxxer/xentium";
const BRANCH = "main";

/** Whole files: source (repo-relative) → page slug. */
const FILES = {
  "docs/plugin-blocks.md":        "plugins/blocks",
  "docs/plugin-registries.md":    "plugins/extension-points",
  "docs/plugin-acp-autosave.md":  "plugins/acp-surfaces",
  "docs/plugin-i18n.md":          "plugins/i18n",
  "docs/icon-kits.md":            "plugins/icons",
  "docs/style-system.md":         "themes/style-system",
  "docs/theme-packages.md":       "themes/packages",
  "docs/API.md":                  "reference/api",
  "docs/marketplace-protocol.md": "reference/marketplace-protocol",
  "CONTRIBUTING.md":              "contributing",
};

/**
 * README sections: each page is a list of the README's `## ` headings, in order.
 * The README is the repo's front door and stays whole; the wiki splits it by topic.
 */
const README_PAGES = [
  { slug: "start/introduction",    title: "What is Xentium",          order: 1,
    sections: ["What is Xentium", "Tech stack"] },
  { slug: "start/install",         title: "Installing from source",   order: 2,
    sections: ["Prerequisites", "Quick start", "First run — the installer"] },
  { slug: "start/configuration",   title: "Configuration",            order: 3,
    sections: ["Environment configuration"] },
  { slug: "start/workspace",       title: "The workspace",            order: 4,
    sections: ["Everyday commands", "Project structure"] },
  { slug: "concepts/architecture", title: "Architecture",             order: 1,
    sections: ["Architecture in a nutshell"] },
  { slug: "concepts/layouts",      title: "The layout system",        order: 2,
    sections: ["Layout system"] },
  { slug: "core/working-on-core",  title: "Working on core",          order: 1,
    sections: ["Working on core"] },
  { slug: "plugins/guide",         title: "Writing a plugin",         order: 1,
    sections: ["Plugin development guide"] },
  { slug: "reference/packages",    title: "Framework packages (npm)", order: 3,
    sections: ["Framework packages (npm)"] },
  { slug: "guides/migrating",      title: "Migrating from another platform", order: 1,
    sections: ["Migrating from another platform"] },
];

/** Sidebar order inside a group for whole files (lower first). */
const ORDER = {
  "plugins/blocks": 2, "plugins/extension-points": 3, "plugins/acp-surfaces": 4,
  "plugins/i18n": 5, "plugins/icons": 6,
  "themes/style-system": 1, "themes/packages": 2,
  "reference/api": 1, "reference/marketplace-protocol": 2,
};

// ── helpers ──────────────────────────────────────────────────────────────────

/** GitHub's heading → anchor rule, which Starlight also follows. */
function anchor(heading) {
  return heading.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function yamlString(s) {
  return JSON.stringify(s); // a JSON string is a valid YAML scalar
}

/** Split markdown into `## ` sections, fence-aware (a `## ` inside ``` is code). */
function splitH2(md) {
  const out = []; let cur = null; let fenced = false;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = !fenced && line.match(/^## (.+)$/);
    if (m) { cur = { heading: m[1].trim(), lines: [line] }; out.push(cur); }
    else if (cur) cur.lines.push(line);
  }
  return out;
}

/** Every heading in a chunk of markdown, for the README anchor map. */
function headings(md) {
  const hs = []; let fenced = false;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = !fenced && line.match(/^#{2,6} (.+)$/);
    if (m) hs.push(m[1].trim());
  }
  return hs;
}

// Where every source file and every README anchor now lives.
const fileToSlug = new Map(Object.entries(FILES));
const readmeAnchorToSlug = new Map();

const readme = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
const readmeSections = new Map(splitH2(readme).map((s) => [s.heading, s.lines.join("\n")]));
// Anchors that became a page's TITLE: a one-section page drops its `## ` heading (the
// title says it), so a link to that anchor must point at the page, not a missing id.
const titleAnchors = new Set();
for (const page of README_PAGES) {
  for (const sec of page.sections) {
    const body = readmeSections.get(sec);
    if (!body) throw new Error(`README has no "## ${sec}" section — update README_PAGES`);
    for (const h of headings(body)) readmeAnchorToSlug.set(anchor(h), page.slug);
  }
  if (page.sections.length === 1) titleAnchors.add(anchor(page.sections[0]));
}
const withFrag = (slug, frag) =>
  `/${slug}/${frag && !titleAnchors.has(frag) ? `#${frag}` : ""}`;

/**
 * Rewrite one link target found in `sourceFile`.
 * - another synced doc  → its page;
 * - a README anchor     → the page that section landed on;
 * - a doc NOT synced    → null (the caller keeps the text, drops the link);
 * - any other repo path → GitHub, so it still resolves;
 * - absolute URLs and in-page anchors → unchanged.
 */
function rewrite(target, sourceFile) {
  if (/^(https?:|mailto:)/.test(target)) return target;
  if (target.startsWith("#")) {
    if (sourceFile === "README.md") {
      const slug = readmeAnchorToSlug.get(target.slice(1));
      return slug ? withFrag(slug, target.slice(1)) : target;
    }
    return target;
  }
  const [p, frag] = target.split("#");
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), p));
  if (resolved === "README.md") {
    const slug = frag && readmeAnchorToSlug.get(frag);
    return slug ? withFrag(slug, frag) : `${GITHUB}#readme`;
  }
  if (fileToSlug.has(resolved)) return `/${fileToSlug.get(resolved)}/${frag ? `#${frag}` : ""}`;
  if (resolved.endsWith(".md") && (resolved.startsWith("docs/") || resolved.startsWith("d0cs/"))) {
    return null; // not public
  }
  if (resolved.startsWith("..")) return null;
  return `${GITHUB}/blob/${BRANCH}/${resolved}${frag ? `#${frag}` : ""}`;
}

/** Apply `rewrite` to every inline markdown link outside code fences and code spans. */
function rewriteLinks(md, sourceFile) {
  let fenced = false;
  return md.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    // Leave code spans alone: split on backtick runs, touch only the even parts.
    return line.split(/(`+[^`]*`+)/).map((part, i) => i % 2 ? part : part.replace(
      /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g,
      (all, bang, text, target) => {
        if (bang) return all; // images: none in the synced docs; leave as authored
        const to = rewrite(target, sourceFile);
        return to === null ? text : `[${text}](${to})`;
      },
    )).join("");
  }).join("\n");
}

function page({ title, order, editPath, body }) {
  const fm = [
    "---",
    `title: ${yamlString(title)}`,
    ...(order ? ["sidebar:", `  order: ${order}`] : []),
    `editUrl: ${yamlString(`${GITHUB}/edit/${BRANCH}/${editPath}`)}`,
    "---",
    "",
  ].join("\n");
  // Generated — say so where an editor would look first.
  const note = `<!-- GENERATED by apps/docs/scripts/sync-docs.mjs from ${editPath} — edit that file. -->\n\n`;
  return fm + note + body.trim() + "\n";
}

function write(slug, content) {
  const file = path.join(OUT, `${slug}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// ── generate ─────────────────────────────────────────────────────────────────

// Wipe only what this script owns (listed in apps/docs/.gitignore).
for (const dir of ["start", "concepts", "core", "plugins", "themes", "reference", "guides"]) {
  fs.rmSync(path.join(OUT, dir), { recursive: true, force: true });
}
fs.rmSync(path.join(OUT, "contributing.md"), { force: true });

let count = 0;
for (const [src, slug] of Object.entries(FILES)) {
  const md = fs.readFileSync(path.join(REPO, src), "utf8");
  const lines = md.split("\n");
  const h1 = lines.findIndex((l) => /^# /.test(l));
  const title = h1 >= 0 ? lines[h1].replace(/^# /, "").replace(/`/g, "").trim() : slug;
  const body = h1 >= 0 ? lines.slice(h1 + 1).join("\n") : md;
  write(slug, page({
    title, order: ORDER[slug], editPath: src,
    body: rewriteLinks(body, src),
  }));
  count++;
}

for (const p of README_PAGES) {
  const body = p.sections.map((s) => readmeSections.get(s)).join("\n\n");
  // A one-section page repeats its title as the first `## `; drop that one line.
  const trimmed = p.sections.length === 1 ? body.replace(/^## .+\n/, "") : body;
  write(p.slug, page({
    title: p.title, order: p.order, editPath: "README.md",
    body: rewriteLinks(trimmed, "README.md"),
  }));
  count++;
}

console.log(`sync-docs: ${count} pages from docs/, README.md and CONTRIBUTING.md`);

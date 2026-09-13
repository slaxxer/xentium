/**
 * Block layout composition (ADR-0005).
 *
 * A page's structure is a DOCUMENT, not code: an ordered list of blocks per
 * named region, per template. Themes ship these documents; they never ship
 * executable code. Code extension goes through plugins, which register blocks.
 *
 * This module is the single source of truth for the template set, the document
 * shape and every core block's prop contract. The API validates against it, the
 * renderer reads it, and the (future) ACP editor generates its forms from it via
 * `z.toJSONSchema` — the same mechanism the scheduled-task params form uses, so
 * a block that gains a prop needs no editor changes.
 */
import { z } from 'zod';

// ── Templates ───────────────────────────────────────────────────────────────
// The CORE set is a fixed enum, deliberately. Themes re-lay-out pages that already
// exist; they never own routes. That removes template-hierarchy resolution
// entirely, and it means a theme can never become a backdoor plugin.
//
// Auth screens and the ACP are permanently excluded: an admin must never be able
// to lay out the screen they would need in order to repair a broken layout.
//
// PLUGINS may add templates for the routes they own, through the runtime registry
// below. That is not a loosening of the rule above — the enum stays closed to
// THEMES, which are data. A plugin is code: it already owns a route and renders
// something there, so letting it declare that page's regions adds no capability it
// did not have. See `registerTemplate`.

export const CORE_TEMPLATE_KEYS = [
  'home',           // /
  'article.index',  // /articles
  'article.detail', // /articles/:slug
  'page.detail',    // /p/:slug
  'profile',        // /u/:username
  'members',        // /members
  // Site chrome (Amendment 1). Not pages — rendered once by AppLayout on every
  // route. The ACP's own topbar is deliberately NOT here: an admin must never be
  // able to rearrange the screen they would need to repair a broken arrangement.
  'chrome.header',
  'chrome.footer',
] as const;

/** One of the eight templates core itself ships. */
export type CoreTemplateKey = (typeof CORE_TEMPLATE_KEYS)[number];

/**
 * Any template key — core's own, or one a plugin registered at runtime.
 *
 * The union with `string & {}` is the idiom that widens the type while keeping the
 * core keys as editor completions: `templateKey="home"` still autocompletes, and
 * `templateKey="forum.index"` still compiles. Keys are validated by
 * `templateKeySchema` and, where it matters, by `isKnownTemplate` — never by the
 * type, which cannot know what a plugin registered.
 */
export type TemplateKey = CoreTemplateKey | (string & {});

/** True for the site-wide chrome templates, which no route owns. */
export const isChromeTemplate = (key: TemplateKey): boolean => key.startsWith('chrome.');

/** Regions the CORE templates expose. Plugin templates declare their own. */
export const TEMPLATE_REGIONS = {
  /*
   * TWO REGIONS on a page: the body, and the rail beside it.
   *
   * A page also had its own `header` and `footer` regions — bands above and below
   * the body, inside `<main>`. They were the accretion this set was supposed to end:
   * the page's header is not the page's header, it is a band under the SITE's header
   * (`chrome.header`), and every code default shipped both of them EMPTY. What they
   * offered over "a `section` at the top of the body" was a name, and the name was
   * the wrong one — an admin reading "Header" in a page's structure reasonably
   * concluded the site header had gone missing.
   *
   * ⚠ `main` is the KEY and `<main>` is the element; the editor LABELS it "Body".
   * Naming the key `body` would fight the element it emits — `<body>` is the whole
   * document, and the landmark for page content is `<main>`.
   */
  'home':           ['main', 'aside'],
  'article.index':  ['main', 'aside'],
  'article.detail': ['main', 'aside'],
  'page.detail':    ['main', 'aside'],
  'profile':        ['main', 'aside'],
  'members':        ['main', 'aside'],
  /*
   * The site's own header and footer: ONE region each, because the navbar is not a
   * peer of the header — it is IN the header, which is what a header is. It is a
   * `navbar` BLOCK here, so ordering a masthead above or below it is moving blocks
   * in a list rather than choosing between two purpose-built regions.
   */
  'chrome.header':  ['header'],
  'chrome.footer':  ['footer'],
} as const satisfies Record<CoreTemplateKey, readonly string[]>;

/**
 * Blocks a CORE template refuses to be saved without.
 *
 * Page templates tolerate an empty region; chrome does not. A header with no way to
 * sign in is a locked door, so this can be moved between regions but never deleted.
 *
 * ⚠ The LOGO is not one of them, and used to be. A logo is a way home, not the only
 * one — the navigation links are, the `header` band carries its own logo, and a site
 * whose navbar is deliberately without one (the mark already fills the band above it)
 * was being told it could not save that. "Reachable" is what matters and no single
 * block owns it; being unable to SIGN IN is the thing an admin cannot undo from the
 * front end, which is why `userMenu` stays.
 *
 * ⚠ Read it through `requiredBlocksFor()`, which also answers for plugin templates.
 */
export const REQUIRED_BLOCKS: Partial<Record<CoreTemplateKey, readonly string[]>> = {
  'chrome.header': ['userMenu'],
};

/**
 * Every block type present in a document, at any depth.
 *
 * Recursive because a required block is still present when it sits inside a
 * container: an admin who drops the header's `logo` into a `section` has moved it,
 * not deleted it, and a shallow scan would refuse the save as "missing logo".
 */
export function blockTypesIn(doc: {
  regions: Record<string, { type: string; children?: { type: string }[] }[]>;
}): Set<string> {
  const out = new Set<string>();
  const visit = (nodes: { type: string; children?: { type: string }[] }[]) => {
    for (const n of nodes) {
      out.add(n.type);
      if (n.children?.length) visit(n.children);
    }
  };
  for (const nodes of Object.values(doc.regions)) visit(nodes);
  return out;
}

/** Required block types the document is missing. Empty means it is valid. */
export function missingRequiredBlocks(
  templateKey: TemplateKey,
  doc: { regions: Record<string, { type: string }[]> },
): string[] {
  const required = requiredBlocksFor(templateKey);
  if (!required) return [];
  const present = blockTypesIn(doc);
  return required.filter((t) => !present.has(t));
}

// ── Variants ────────────────────────────────────────────────────────────────
// A template describes a KIND of page. Some kinds have many instances — every
// custom page renders through `page.detail` — and until variants they all shared
// one arrangement. A variant is one instance's own document, resolved ahead of the
// template default.
//
// This is the one axis deliberately added: an admin can give the About page its own
// layout without inventing a template, so themes still never own routes. What it is
// NOT is a template hierarchy — resolution is exactly two steps deep, variant then
// default, with no cascade to reason about.

/**
 * Templates that accept variants, and what a variant key means for each.
 *
 * `page.detail`'s key is a page slug. Article detail could take a category or an
 * article slug later; profile could take a group. Anything absent here rejects a
 * variant outright rather than silently storing a row nothing will ever read.
 */
export const VARIANT_TEMPLATES = {
  'page.detail': { keyKind: 'pageSlug' },
} as const satisfies Partial<Record<TemplateKey, { keyKind: string }>>;

export type VariantTemplateKey = keyof typeof VARIANT_TEMPLATES;

export const templateAcceptsVariants = (key: TemplateKey): key is VariantTemplateKey =>
  key in VARIANT_TEMPLATES;

/** The stored value meaning "this template's default", for every template. */
export const DEFAULT_VARIANT = '';

/**
 * A variant key: slug-shaped, because that is what it identifies.
 *
 * Bounded and character-restricted because it reaches a unique index and a URL, and
 * because `''` is reserved for the default — an empty variant must arrive as the
 * default, never as a key that happens to be blank.
 */
export const variantKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,190}$/, 'variant must be a lowercase slug');

/** Parse a possibly-absent variant into either a key or the default. */
export function normalizeVariant(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_VARIANT;
  const trimmed = raw.trim();
  return trimmed === '' ? DEFAULT_VARIANT : trimmed;
}

/** Identifies one stored document: a template plus which instance it is for. */
export interface LayoutSelector {
  templateKey: TemplateKey;
  /** `''` for the template default. */
  variant: string;
}

export const sameSelector = (a: LayoutSelector, b: LayoutSelector): boolean =>
  a.templateKey === b.templateKey && a.variant === b.variant;

export type RegionName = (typeof TEMPLATE_REGIONS)[CoreTemplateKey][number];

// ── Template registry ───────────────────────────────────────────────────────
// The one runtime seam in an otherwise static design, and the reason it is safe:
// a template is a page's REGIONS plus what it ships in them, and a plugin already
// owns the route it would be describing. It gains nothing it did not have — it
// gains an ADMIN the ability to arrange a plugin's page the way they arrange
// core's, instead of that page being the one part of the site the layout editor
// cannot touch.
//
// Themes stay locked out. A `.xttheme` is data: it may carry a document FOR a
// registered template, and a document for one nobody registered is skipped, never
// stored as a new template. So the enum is still closed to the untrusted half.
//
// Two runtimes, two registries. The API's copy of this module decides what may be
// saved; the browser's decides what renders. A plugin declares its template once
// and registers it in both — from its server entry via `ctx.registerLayoutTemplate`,
// and from its web entry via the host's `@web/layout/templateRegistry`.
// ⚠ A plugin bundle must go through the HOST global for the web half. Importing
// `@xentium/contracts` directly bundles a SECOND copy of this module, whose registry
// the renderer never reads.

/** A template: its regions, what it ships in them, and who owns it. */
export interface TemplateDefinition {
  key: string;
  /** Ordered. Region ORDER is the template's, never the document's — see `LayoutRenderer`. */
  regions: readonly string[];
  /** Rendered until an admin arranges something. Parsed and tree-checked at registration. */
  defaultDocument: LayoutDocument;
  /** Block types the template refuses to be saved without. */
  requiredBlocks?: readonly string[];
  /**
   * Admin-facing name. Core templates leave it unset — the ACP localizes those by
   * key — and a plugin supplies the literal, in the plugin's own English.
   */
  label?: string;
  /** Same-origin path the ACP editor previews at, e.g. `/forum`. */
  previewRoute?: string;
  /** Owning plugin. Absent for core; disabling the plugin deregisters the template. */
  pluginId?: string;
}

/**
 * A template on the way IN.
 *
 * `defaultDocument` is `unknown` because it is about to be parsed: a declaration
 * states what it means (`{ id, type }`) and the schema fills in `schemaVersion` and
 * empty `props`. Typing it as the parsed `LayoutDocument` would force every author
 * to write out fields the parser exists to supply — and would type-check a plugin's
 * declaration against a shape it cannot import anyway, since a plugin's SDK carries
 * its own structural copy.
 */
export interface TemplateRegistration extends Omit<TemplateDefinition, 'defaultDocument'> {
  defaultDocument: unknown;
}

/** Registration order: core first (seeded below), then plugins as they enable. */
const templates = new Map<string, TemplateDefinition>();

/**
 * A plugin template key: `namespace.name`.
 *
 * The dot is required so a plugin cannot claim a bare word core might later want,
 * and the whole key is bounded and lowercase-ish because it reaches a URL path, a
 * unique index and a file name inside a `.xttheme`.
 */
export const PLUGIN_TEMPLATE_KEY_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-zA-Z0-9]*$/;

/** A region name — an identifier, because it is a document key and a CSS class suffix. */
const REGION_NAME_RE = /^[a-z][a-zA-Z0-9]*$/;

/** Shape only: whether a string could name a template. Not whether one exists. */
export const templateKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-zA-Z0-9-]+)?$/, 'invalid template key');

/**
 * Add a template. Core seeds its own at the bottom of this module; a plugin's
 * arrives through `ctx.registerLayoutTemplate`.
 *
 * THROWS on a declaration that is not safe to accept, rather than logging and
 * carrying on. On the server that surfaces as a plugin load error and the plugin
 * does not enable — which is what should happen, because the alternative is a
 * plugin whose pages are half-registered. The web half is then never reached: a
 * plugin that cannot enable never has its bundle served.
 */
export function registerTemplate(def: TemplateRegistration): TemplateDefinition {
  const { key, pluginId } = def;

  if (pluginId) {
    // Core's keys are not up for grabs. Without this a plugin could register `home`
    // and take over the site's front page — the one thing a "plugin adds templates"
    // feature must not enable.
    if ((CORE_TEMPLATE_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Template "${key}" is a core template and cannot be replaced.`);
    }
    if (!PLUGIN_TEMPLATE_KEY_RE.test(key)) {
      throw new Error(`Template key "${key}" must be namespaced, e.g. "forum.index".`);
    }
    const existing = templates.get(key);
    // Re-registering its OWN template is normal: a plugin does it on every enable.
    if (existing && existing.pluginId !== pluginId) {
      throw new Error(
        `Template "${key}" is already registered by ${existing.pluginId ?? 'core'}.`,
      );
    }
    // The preview loads in an ACP iframe. A plugin is trusted code, but a template
    // is a DECLARATION, and there is no reason for one to point off-origin.
    if (def.previewRoute !== undefined) {
      if (!def.previewRoute.startsWith('/') || def.previewRoute.startsWith('//')) {
        throw new Error(`Template "${key}" previewRoute must be a same-origin path.`);
      }
    }
  }

  if (def.regions.length === 0) {
    throw new Error(`Template "${key}" declares no regions.`);
  }
  if (new Set(def.regions).size !== def.regions.length) {
    throw new Error(`Template "${key}" declares a region twice.`);
  }
  const badRegion = def.regions.find((r) => !REGION_NAME_RE.test(r));
  if (badRegion) {
    throw new Error(`Template "${key}" region "${badRegion}" is not a valid region name.`);
  }

  // The default document is held to exactly what a save is held to. A plugin
  // shipping a malformed one would otherwise put a document into the render path
  // that the API would refuse if an admin tried to save it.
  const parsed = layoutDocumentSchema.safeParse(def.defaultDocument);
  if (!parsed.success) {
    throw new Error(
      `Template "${key}" default document is invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  if (parsed.data.templateKey !== key) {
    throw new Error(
      `Template "${key}" default document declares template "${parsed.data.templateKey}".`,
    );
  }
  const declared = new Set(def.regions);
  const unknownRegions = Object.keys(parsed.data.regions).filter((r) => !declared.has(r));
  if (unknownRegions.length) {
    throw new Error(
      `Template "${key}" default document uses undeclared region(s): ${unknownRegions.join(', ')}`,
    );
  }
  const problems = validateBlockTree(parsed.data.regions, { requiredTypes: def.requiredBlocks });
  if (problems.length) {
    throw new Error(`Template "${key}" default document is invalid: ${problems.join(' ')}`);
  }
  // A default that omits a block the same template declares REQUIRED is a default the
  // editor could never save back — the admin's first edit would be refused with a
  // message about a block they never removed. Computed here rather than through
  // `missingRequiredBlocks`, which reads the registry this template is not in yet.
  const present = blockTypesIn(parsed.data);
  const missing = (def.requiredBlocks ?? []).filter((t) => !present.has(t));
  if (missing.length) {
    throw new Error(
      `Template "${key}" default document is missing required block(s): ${missing.join(', ')}`,
    );
  }

  // Stored PARSED, so the default a page renders is byte-identical to the same
  // document read back out of the database. Zod emits keys in schema order and an
  // object literal does not, and every draft-vs-live comparison in this system is a
  // `JSON.stringify` — an unparsed default reads as "customised" forever.
  const stored: TemplateDefinition = { ...def, defaultDocument: parsed.data };
  templates.set(key, stored);
  return stored;
}

/**
 * Drop every template a plugin registered. Returns the keys removed.
 *
 * Stored documents are NOT touched — same rule as an unknown block. A disabled
 * plugin's page stops rendering because its route is gone; its layout waits for the
 * plugin to come back. Deleting the rows would make disabling a plugin an
 * irreversible edit to somebody's site.
 */
export function deregisterTemplatesFor(pluginId: string): string[] {
  const removed: string[] = [];
  for (const [key, def] of templates) {
    if (def.pluginId === pluginId) {
      templates.delete(key);
      removed.push(key);
    }
  }
  return removed;
}

export function getTemplate(key: TemplateKey): TemplateDefinition | undefined {
  return templates.get(key);
}

/** Every registered template, core first. */
export function listTemplates(): TemplateDefinition[] {
  return [...templates.values()];
}

export function templateKeys(): string[] {
  return [...templates.keys()];
}

/** Whether anything currently renders this key. False for a disabled plugin's. */
export function isKnownTemplate(key: TemplateKey): boolean {
  return templates.has(key);
}

export function requiredBlocksFor(key: TemplateKey): readonly string[] | undefined {
  return templates.get(key)?.requiredBlocks;
}

/**
 * Regions to render, in the template's own order.
 *
 * Empty for a template nothing has registered — a page whose plugin is disabled
 * renders nothing rather than throwing, which is the same forward-compatibility
 * rule the renderer applies to an unknown block.
 */
export function regionsFor(key: TemplateKey): readonly string[] {
  return templates.get(key)?.regions ?? [];
}

/** Cached so an unknown template's fallback keeps a stable identity across renders. */
const emptyDocuments = new Map<string, LayoutDocument>();

/** What a template renders before anybody arranges it. */
export function defaultLayoutFor(key: TemplateKey): LayoutDocument {
  const def = templates.get(key);
  if (def) return def.defaultDocument;
  let empty = emptyDocuments.get(key);
  if (!empty) {
    empty = { templateKey: key, schemaVersion: LAYOUT_SCHEMA_VERSION, regions: {} };
    emptyDocuments.set(key, empty);
  }
  return empty;
}

// ── Localized text ──────────────────────────────────────────────────────────
// Default documents ship in code and must stay translatable, so any admin-facing
// string in a block prop is either a literal (admin typed it, one language) or an
// i18n reference (core defaults). Without this, converting a page to a document
// would silently hardcode English.

export const localizedTextSchema = z.union([
  z.string(),
  z.object({ key: z.string().min(1), ns: z.string().min(1).optional() }),
]);
export type LocalizedText = z.infer<typeof localizedTextSchema>;

// ── Document ────────────────────────────────────────────────────────────────

/** Bumped only on a BREAKING block-prop change; stored documents migrate on read. */
export const LAYOUT_SCHEMA_VERSION = 1;

export interface BlockNode {
  /**
   * Stable across reordering, and UNIQUE across the whole document — the editor
   * selects by it and the preview addresses DOM nodes by it, so a duplicate makes
   * both operate on the wrong block. Enforced by `validateBlockTree`.
   */
  id: string;
  /** Registry key. Plugin blocks are namespaced: `forum.recentThreads`. */
  type: string;
  props: Record<string, unknown>;
  /** Container blocks only (`section`, `columns`, `column`). */
  children?: BlockNode[];
  /**
   * Who sees this block. Absent = everyone, which is why an unrestricted block
   * stores no visibility field at all: two equal layouts must compare equal, and
   * draft-vs-live "pending" status is a `JSON.stringify` comparison.
   */
  visibility?: BlockVisibility;
  /**
   * Which named look this block sits on. Absent = the page's own tokens, and — same
   * rule as `visibility` — the default is never stored.
   *
   * ⚠ Not to be confused with a LAYOUT variant (`LayoutSelector.variant`), which names
   * one instance of a template — the layout for one page. Same word, different axis:
   * that one selects a document, this one styles a block inside it.
   */
  variant?: BlockVariant;
  /**
   * A designer's own CSS handle for this one block. Absent = none, and — same rule as
   * `visibility` and `variant` — the default is never stored.
   *
   * Stamped on the SAME `display: contents` wrapper the variant uses, which is what
   * makes it safe on any block, including a plugin's: the block's own element stays the
   * one its flex or grid parent sizes. The consequence is that the handle is something
   * you style THROUGH, not on — `.nav-tile > *` or `.nav-tile .xt-image` paint, while
   * `.nav-tile { background: … }` cannot, because the wrapper generates no box.
   * Descendant and `:hover` selectors work normally.
   *
   * This exists because `data-xt-block` is not a contract: ids are opaque and a
   * rebuilt block gets a new one, so custom CSS had no stable target.
   */
  className?: string;
  /**
   * Which end of a ROW this block sits at. Absent = the start.
   *
   * Read by `navbar`, which is the only block that is a row. It carries what the
   * navbar's old `left`/`center`/`right` regions carried, and is what allowed the
   * navbar to become a block inside the header instead of a template beside it.
   *
   * Node-level rather than a prop for the same reason `variant` and `className` are:
   * a navbar is exactly where a PLUGIN's block wants to be placeable, and a prop
   * would be honoured by core blocks and ignored by everything else.
   */
  align?: 'left' | 'center' | 'right';
  /**
   * Per-occurrence icon replacements, keyed `"<icon-name>#<n>"` (the nth icon of
   * that name in this block, in render order) → an icon token.
   */
  iconOverrides?: Record<string, string>;
}

/**
 * How deep nesting may go, counting a region's own blocks as depth 1.
 *
 * Bounded because an imported `.xttheme` is a second way into storage, and an
 * arbitrarily deep document is a render bomb rather than a layout.
 *
 * Raised from 5 to 8 when the profile card was decomposed: a real card is
 * `card > columns > column > columns > column > leaf`, which is six, and the point
 * of the limit is to stop pathological documents rather than to constrain designs
 * people actually build. Eight leaves headroom without going anywhere near a depth
 * that could hurt a render.
 */
export const MAX_BLOCK_DEPTH = 8;

/**
 * Core block types that accept children.
 *
 * The web `blockRegistry` is the real authority (it carries `container` per
 * definition, including for plugin blocks), but the API has no registry and still
 * has to reject a malformed import. So this lists only the CORE containers, and
 * the server rule is "a core block that is not in here may not carry children" —
 * a type core does not know is left alone, which is what keeps plugin containers
 * working without the API needing to know they exist.
 *
 * ⚠ This duplicates `container: true` in the web registry, deliberately (the API has
 * no registry) — so the two can drift. Adding a core container here without setting
 * `container: true` lets a document store children the renderer will not render;
 * the reverse makes the API refuse a layout the editor happily built. A test pins
 * the two lists together: see `layout.test.ts`.
 */
export const CORE_CONTAINER_TYPES = [
  'section', 'columns', 'column', 'profileCard',
  // The nav strip. A container because its children ARE the navbar's contents —
  // it replaced three regions, so what used to be region membership is now
  // parentage.
  'navbar',
  // The footer band. A container for the same reason `navbar` is one: its children
  // ARE the footer's contents, and they have to sit ON the band that paints them.
  'footer',
  // The guest landing's surface and its two styled grids — see `guestBlocks.tsx`.
  'guestSurface', 'guestHero', 'guestBody',
] as const;

// ── Audience ────────────────────────────────────────────────────────────────
// WoltLab's box ACL, with one rule that is not negotiable: a document may only
// NARROW who sees a block, never widen it.
//
// Every block already decides its own visibility in code — `userMenu` shows an
// avatar or a sign-in button, `notifications` renders nothing for guests. An
// audience sits ON TOP of that: when it admits the viewer, the block's own gate
// still runs. So nothing an admin writes into a layout can reveal what the code
// would have withheld, which is what stops theme-authored DATA from becoming a way
// to widen access.
//
// And it is PRESENTATION, not access control. Hiding `whosOnline` from guests does
// not stop the endpoint answering a guest — if data must be secret, the endpoint
// enforces it. The editor says so out loud, because an admin will otherwise
// reasonably assume the opposite.

export const BLOCK_AUDIENCES = ['everyone', 'guests', 'members', 'groups'] as const;
export type BlockAudience = (typeof BLOCK_AUDIENCES)[number];

export const blockVisibilitySchema = z.object({
  audience: z.enum(BLOCK_AUDIENCES).default('everyone'),
  /** Group ids. Meaningful only when `audience` is `groups`. */
  groups:   z.array(z.string().min(1).max(64)).default([]),
});
export type BlockVisibility = z.infer<typeof blockVisibilitySchema>;

/** What the renderer knows about who is looking. */
export interface BlockViewer {
  signedIn: boolean;
  /** Every group the viewer belongs to — membership is many-to-many. */
  groupIds: readonly string[];
  /**
   * Whether auth has actually been determined yet.
   *
   * The access token lives in memory only (15 min, §43), so on the first paint of a
   * page load it is absent while the refresh is in flight — a signed-in member is
   * indistinguishable from a guest. Without this flag `signedIn: false` was taken at
   * face value and a member briefly got the whole guest landing, sign-up calls to
   * action included, before it swapped.
   *
   * Optional so a caller that genuinely knows (a test, the server) need not say so.
   */
  resolved?: boolean;
}

/**
 * Whether a block's audience admits this viewer.
 *
 * Absent visibility means `everyone`, so a document written before audiences
 * existed behaves exactly as it did.
 *
 * `groups` with an empty list resolves to nobody. That is a foot-gun rather than
 * an error — an admin may be mid-edit — so the editor warns instead of refusing.
 */
export function isBlockVisibleTo(
  visibility: BlockVisibility | undefined,
  viewer: BlockViewer,
): boolean {
  if (!visibility || visibility.audience === 'everyone') return true;

  // Auth not settled yet: withhold every audience-restricted block rather than guess.
  // Guessing means showing the WRONG one — a signed-in member seeing the guest
  // landing, or a guest seeing member-only content — and both are worse than a beat
  // of nothing before the page settles. Unrestricted blocks render throughout, so the
  // page is never blank.
  if (viewer.resolved === false) return false;

  switch (visibility.audience) {
    case 'guests':  return !viewer.signedIn;
    case 'members': return viewer.signedIn;
    // Signed out means no groups, so this is also the answer for a guest.
    case 'groups':  return visibility.groups.some((id) => viewer.groupIds.includes(id));
  }
}

/** True when a rule actually restricts someone. The default stores nothing. */
export function isRestricted(visibility: BlockVisibility | undefined): boolean {
  return !!visibility && visibility.audience !== 'everyone';
}

/**
 * Which audience an admin is EDITING for.
 *
 * Two, because a site has two kinds of visitor. There is deliberately no "everyone"
 * view: an unrestricted block belongs to BOTH arrangements and shows in both, so every
 * block is reachable from one of these two and nothing can hide from the editor.
 *
 * Distinct from a viewer: the question is "which arrangement does this block belong
 * to", which is about audiences overlapping, not about one person's group membership.
 */
export type AudienceView = 'guests' | 'members';

/**
 * Whether a block belongs to the arrangement an admin is editing.
 *
 * Deliberately NOT `isBlockVisibleTo` with a synthetic viewer. A viewer has concrete
 * group membership, so a `groups`-restricted block would vanish from the "members"
 * view for want of the right groups — when a group is a SUBSET of members and plainly
 * belongs to their arrangement. This asks whether the audiences overlap instead.
 */
export function audienceInView(
  visibility: BlockVisibility | undefined,
  view: AudienceView,
): boolean {
  const audience = visibility?.audience ?? 'everyone';
  if (audience === 'everyone') return true;
  return view === 'guests'
    ? audience === 'guests'
    // Anything narrower than "signed in" is still part of what members see.
    : audience === 'members' || audience === 'groups';
}

// ── Style variants ──────────────────────────────────────────────────────────
// The layout chooses AMONG looks; the theme defines what those looks ARE.
//
// This is the deliberate answer to "let the admin pick colours per block", which is
// how theme ecosystems become incoherent: colours scattered across a document with
// no relationship to each other, dark mode broken by construction, and the Style
// Editor reduced to decoration. It also breaks the codebase's own hard rule — no
// hardcoded visual values, always a token.
//
// So a variant is a NAMED TOKEN BUCKET, nothing more. `accent` is a scope
// (`variant.accent`, emitted under `.xt-v--accent` — see `tokens.ts`) whose overrides
// re-scope ordinary semantic tokens for the block and everything inside it. A document
// says "this panel is accent"; the theme says what accent means. Someone who prefers
// different colours edits four tokens instead of forty blocks.
//
// Two consequences worth knowing:
//
//  - **Variants cascade.** Custom properties inherit, so a block inside an `accent`
//    section is also accented. `plain` is the explicit reset.
//  - **`section` is the block that PAINTS.** It is the generic surface, and it reads
//    `--surface-*` (globally undefined, so an unstyled section paints nothing).
//    Everything else follows through the re-scoped semantics — `--c-card`, `--c-fg`.

export const BLOCK_VARIANTS = ['surface', 'muted', 'accent', 'plain'] as const;
export type BlockVariant = (typeof BLOCK_VARIANTS)[number];
export const blockVariantSchema = z.enum(BLOCK_VARIANTS);

/**
 * The class the renderer stamps for a variant.
 *
 * Applied to a `display: contents` wrapper, which is what makes this safe to put on
 * ANY block: custom properties still inherit through such an element, but it generates
 * no box — so the block's own element remains the one its flex or grid parent sizes.
 * A real wrapper box would silently break the navbar and every column track.
 */
export const variantClass = (variant: BlockVariant): string => `xt-v--${variant}`;

/**
 * A block's custom class handle.
 *
 * Space-separated CSS identifiers, because a designer reasonably wants
 * `nav-tile is-primary`. Character-restricted rather than merely escaped: this string
 * is written into a class attribute AND is the thing a theme's stylesheet selects on,
 * so anything that could terminate a selector or an attribute is refused outright.
 *
 * `xt-` is RESERVED. Core's own classes live under that prefix and step into the
 * documented class contract themes style against; letting a document mint one would
 * let a stored layout impersonate a core class — or a variant (`xt-v--accent`) it was
 * never given.
 */
const CLASS_TOKEN = /^[A-Za-z][A-Za-z0-9_-]*$/;

export const blockClassNameSchema = z
  .string()
  .max(120)
  .refine(
    (v) => {
      const tokens = v.trim().split(/\s+/).filter(Boolean);
      return (
        tokens.length > 0 &&
        tokens.length <= 4 &&
        tokens.every((t) => CLASS_TOKEN.test(t) && !t.toLowerCase().startsWith('xt-'))
      );
    },
    {
      message:
        'className must be 1-4 CSS identifiers, letters/digits/-/_ only, and may not start with the reserved `xt-` prefix',
    },
  );

/**
 * The class that identifies a block by TYPE, on every instance of it.
 *
 * This is the block-level half of the class contract themes style against. It exists
 * because the other half could not carry the weight on its own: `className` is per
 * instance and only an admin can set it, so a downloaded theme — which does not control
 * the layouts on the site it lands on — had no way to say "every board-stats block".
 * Most blocks also render into their parent's markup and emit no root class of their
 * own, so for roughly fifty of them there was nothing to select at all.
 *
 * Stamped by the renderer on the same `display: contents` wrapper as the variant and
 * the handle, which is what makes it free, uniform, and available to a plugin's blocks
 * without the plugin doing anything.
 *
 * ⚠ **This is a compatibility contract.** The class is derived from the registry key, so
 * renaming a block type renames its class and breaks any theme that targeted it — the
 * same commitment as renaming a prop, and the reason `xt-` is reserved against
 * `className`.
 *
 * A plugin type is namespaced with a dot (`forum.recentThreads`), which is not usable in
 * a selector unescaped, so separators are flattened to `-`.
 */
export const blockTypeClass = (type: string): string =>
  `xt-b--${type.replace(/[^A-Za-z0-9_-]+/g, '-')}`;

export const blockNodeSchema: z.ZodType<BlockNode> = z.lazy(() =>
  z.object({
    id:         z.string().min(1).max(64),
    type:       z.string().min(1).max(120),
    props:      z.record(z.string(), z.unknown()).default({}),
    children:   z.array(blockNodeSchema).optional(),
    visibility: blockVisibilitySchema.optional(),
    variant:    blockVariantSchema.optional(),
    className:  blockClassNameSchema.optional(),

    /**
     * Which end of a row this block sits at.
     *
     * NODE-LEVEL, like `variant` and `className`, for the same reason: threading it
     * through 52 prop schemas would be honoured by core blocks and silently ignored
     * by every plugin block, and a navbar is exactly where a plugin's block wants to
     * be placeable.
     *
     * Read by `navbar`, which is a row and the only place "which end" means
     * anything. Absent = start of the row. It replaces the navbar's old
     * `left`/`center`/`right` REGIONS: the trade is one optional field against three
     * regions that existed on one template and nowhere else, and it is what lets the
     * navbar be a block instead of a template.
     */
    align:      z.enum(['left', 'center', 'right']).optional(),

    /**
     * Per-occurrence icon replacements inside this block.
     *
     * Keyed `"<icon-name>#<n>"` — the nth icon of that name in this block, in render
     * order. The value is an icon token (`"star"`, `"jelly-regular:star"`).
     *
     * ⚠ NODE-LEVEL, so an override travels with the block when it is moved or
     * duplicated, and is published with the layout draft like everything else here.
     *
     * ⚠ The key is POSITIONAL, which is the trade this design makes. Replacing the
     * third `chevron-down` in a block addresses it by being third; if a block is
     * later rewritten to render a different number of them, the override can land on
     * a neighbour. That is why `n` is scoped per NAME rather than per block — adding
     * an unrelated icon does not shift the others — and why an override that cannot
     * draw falls back to the icon the code asked for rather than to a hole.
     */
    iconOverrides: z.record(z.string().max(80), z.string().max(80)).optional(),
  }),
);

/**
 * One colour a document may carry.
 *
 * ⚠ STRICT on purpose. These values are handed to the renderer and composed into a
 * `linear-gradient(...)`, and a document is untrusted input twice over — an admin
 * types one, and a purchased `.xttheme` ships others. An unbounded string would let
 * a package smuggle `url(https://tracker/…)` or a second declaration into whatever
 * it is interpolated into. Hex, `rgb()/rgba()`, `hsl()/hsla()` and `var(--token)`
 * cover every colour anyone needs and nothing else parses.
 *
 * `var(--token)` is deliberately allowed and is the form a THEME should use: a stop
 * written as `var(--c-accent)` follows the site's palette and both light and dark for
 * free, which a picked hex cannot. The colour picker writes hex; an author may write
 * either.
 */
export const cssColorSchema = z
  .string()
  .trim()
  .max(64)
  .regex(
    /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/a-z]+\)|var\(--[a-zA-Z0-9_-]+\))$/,
    'must be a hex, rgb(), hsl() or var(--token) colour',
  );

export const layoutDocumentSchema = z.object({
  // Shape, not membership: a plugin's template key is not knowable at compile time,
  // and a document for a template whose plugin is currently disabled must still
  // PARSE — it is kept and skipped, exactly like an unknown block. Whether a key is
  // registered is a write-time rule (`isKnownTemplate`), enforced where a clear
  // refusal can be returned rather than silently degrading a stored row.
  templateKey:   templateKeySchema,
  schemaVersion: z.number().int().min(1).default(LAYOUT_SCHEMA_VERSION),
  regions:       z.record(z.string(), z.array(blockNodeSchema)).default({}),
});

export type LayoutDocument = z.infer<typeof layoutDocumentSchema>;

/**
 * A draft plus the token that says which revision of it was read.
 *
 * The editor autosaves, so two admins — or one admin in two tabs — on the same
 * selector silently overwrote each other: last write won and neither was told. The
 * token is this selector's OWN row revision, and `null` when it has no row yet, which
 * is a meaningful value rather than a missing one: "there was nothing here when I
 * started" is exactly the state that a second tab creating the row must invalidate.
 *
 * Sent back on save; a mismatch is a 409 carrying the current token, so the client can
 * offer to reload or to overwrite deliberately rather than doing either by accident.
 */
export interface LayoutDraftResponse {
  document: LayoutDocument;
  version: string | null;
}

// ── Core block prop contracts ───────────────────────────────────────────────
// Props stay COARSE on purpose. Fine visual control belongs to the Style Editor
// tokens (ADR-0003). Every prop added here is permanent: stored documents —
// including ones inside purchased themes — must migrate forever.

/**
 * A link target an admin or a theme may supply.
 *
 * Relative paths and http/https/mailto only. The scheme check is a DENY of the
 * script-bearing ones rather than an allow-list of shapes, because the useful values
 * here are mostly relative (`/forum`, `../page`) and an allow-list of URL shapes would
 * reject them. A `.xttheme` from a stranger is a way into this field, so `javascript:`
 * must never survive validation and be handed to an `href`.
 */
/**
 * The href with everything a browser IGNORES while resolving a scheme removed:
 * whitespace, C0 controls and DEL. `java\tscript:` and `java script:` navigate exactly
 * like `javascript:`, so the scheme check has to run on this, not on the raw string.
 */
const schemeProbe = (v: string): string =>
  Array.from(v)
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code > 0x20 && code !== 0x7f;
    })
    .join('');

export const linkHrefSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((v) => !/^(?:[a-z0-9+.-]*script|data):/i.test(schemeProbe(v)), {
    message: 'href scheme is not allowed',
  });

export const blockPropSchemas = {
  /** Layout container. `width` maps to a token-driven max-width, not a pixel value. */
  /**
   * A band of the page, and the block that PAINTS — every other block draws into
   * whatever surface a section provides. That is why the background lives here
   * rather than on a header-specific block: a masthead, a hero and a call-to-action
   * strip are the same thing wearing different content.
   *
   * Image and gradient COMPOSE rather than exclude each other: CSS layers the image
   * over the gradient, so either alone works and both together gives the gradient as
   * the ground an image with transparency sits on. Neither set = no background, and
   * the section is invisible exactly as it was before.
   */
  section: z.object({
    width:   z.enum(['full', 'wide', 'normal', 'narrow']).default('normal'),
    padding: z.enum(['none', 'sm', 'md', 'lg']).default('md'),

    /**
     * An upload path (`layouts/masthead.jpg`) or an absolute URL. Empty = none.
     *
     * `asset: true` is what makes it TRAVEL: the exporter copies the file into the
     * package and rewrites this to `assets/<file>`, and the importer unpacks it and
     * rewrites it again. Without the flag a theme's masthead would arrive as a path
     * into the exporting machine's uploads directory — a broken image everywhere.
     *
     * ⚠ It must stay a TOP-LEVEL string prop. `assetPropsOf` reads the schema's own
     * properties for the flag, so folding this into a nested `background` object
     * would silently stop it being collected.
     */
    backgroundImage: z.string().max(500).default('').meta({
      title:       'Background image',
      description: 'Upload path or URL. Leave empty for none.',
      asset:       true,
    }),

    /**
     * Gradient stops, in order. Empty = no gradient; ONE colour paints a flat fill.
     *
     * Capped at three because a gradient is a background, not an illustration — and
     * the cap is the schema's, so a hand-written document or a `.xttheme` cannot
     * exceed what the editor offers.
     */
    backgroundGradient: z.array(cssColorSchema).max(3).default([]),

    /** Gradient direction in degrees; 180 = top to bottom, the CSS default. */
    backgroundAngle: z.number().int().min(0).max(360).default(180),

    /**
     * A floor for the section's height, in pixels. 0 = as tall as its content.
     *
     * MINIMUM rather than fixed: a masthead is given a height so the band has
     * presence, but a fixed height clips — a longer nav on a narrow viewport, a
     * bigger font from an accessibility setting, a logo that turned out taller than
     * the number someone typed. A floor gives the same look and cannot hide content.
     *
     * A section with a floor CENTRES its content vertically, because that is the only
     * arrangement anyone wants from a band taller than what is in it.
     */
    minHeight: z.number().int().min(0).max(2000).default(0).meta({
      title:       'Minimum height (px)',
      description: '0 = as tall as its content. A taller band centres its content.',
    }),
  }),

  /**
   * A row of columns. The track count is NOT a prop — it is however many `column`
   * children the block has, so there is no second number to keep in sync with the
   * tree (a `count` of 3 with two columns is a silent empty track, and every edit
   * would have to reconcile the two). Responsive collapse stays intrinsic, never
   * an admin knob: that is what stops a non-developer shipping a layout that is
   * broken on a phone.
   */
  columns: z.object({
    gap: z.enum(['sm', 'md', 'lg']).default('md'),
  }),

  /**
   * One track of a `columns` row, and a container in its own right.
   *
   * It exists as a block rather than `columns` holding N child LISTS because one
   * uniform tree keeps a single addressing model — every node is reachable by id,
   * and moving into a column is the same operation as moving into a section.
   * Named child slots would be a second nesting concept beside regions.
   */
  column: z.object({
    /**
     * How much of the row this track takes.
     *
     * `auto` sizes to its content, which is what an avatar or a button group wants;
     * the numbers are relative weights, so `2` beside `1` is a two-thirds split.
     * A weight rather than a percentage because percentages plus a gap overflow,
     * and because an admin should not be able to produce a row that adds up to 140%.
     */
    width: z.enum(['auto', 'sidebar', 'rail', '1', '2', '3']).default('1')
      .meta({
        title: 'Track width',
        description: '“auto” fits the content, “sidebar”/“rail” are the site’s two rail widths, numbers are relative shares.',
      }),
    /**
     * Whether the track sticks while the rest of the page scrolls.
     *
     * Presentational, and the reason the home page's two rails could stop being
     * bespoke wrappers: stickiness was the only thing `.hf-left`/`.hf-right` did
     * that a generic track could not.
     */
    sticky: z.boolean().default(false).meta({ title: 'Stick while the page scrolls' }),
  }),

  spacer: z.object({
    size: z.enum(['sm', 'md', 'lg', 'xl']).default('md'),
  }),

  /**
   * The small label above a page title.
   *
   * Separate from `heading` on purpose: a page head is two things an admin wants to
   * edit and move independently — which is what `membersHeading` (fixed text, one
   * on/off toggle) could not do. `heading` keeps its own optional `eyebrow` for the
   * cases where one block is genuinely wanted.
   */
  eyebrow: z.object({
    text:  localizedTextSchema.meta({ title: 'Label' }),
    align: z.enum(['start', 'center']).default('start'),
  }),

  heading: z.object({
    text:    localizedTextSchema,
    eyebrow: localizedTextSchema.optional(),
    level:   z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    align:   z.enum(['start', 'center']).default('start'),
    /**
     * An optional glyph before the title.
     *
     * ⚠ `format: "icon"` is a HINT to the editor, not a new prop type — SchemaFields
     * renders the icon picker for it, and any other block (core or plugin) gets the
     * same control by declaring the same hint. Nothing needs registering.
     *
     * ⚠ Optional and never defaulted: absent means no icon, and storing a default
     * would make every heading ever created carry one.
     */
    icon: z.string().optional().meta({ title: 'Icon', format: 'icon' }),
  }),

  richText: z.object({
    /** ProseMirror JSON, same shape as `articles.body`. */
    content: z.unknown(),
  }),

  image: z.object({
    /** Upload path (`articles/<id>/x.png`) or a context reference (`article.featuredImage`). */
    source: z.string().min(1).meta({ title: 'Image', asset: true }),
    alt:    localizedTextSchema.optional(),
    ratio:  z.enum(['auto', '16:9', '4:3', '1:1']).default('auto'),
    /**
     * Makes the image a link. Without it an image could only ever decorate, which is
     * what stopped a theme from building an image navbar: `navLinks` renders text, so
     * there was no way to express "this artwork is the link to /forum".
     *
     * No `hoverSource` companion on purpose — a hover swap is CSS the `className`
     * handle can already express, and every prop here is permanent.
     */
    href: linkHrefSchema.optional()
      .meta({ title: 'Links to', description: 'A path like /forum, or a full URL. Leave empty for a plain image.' }),
  }),

  /**
   * The article index: filters, view toggle, grid/list, pagination. One block
   * because those parts share interaction state; splitting them would put a
   * control in one region driving a list in another.
   */
  articleIndex: z.object({
    defaultView: z.enum(['grid', 'list']).default('grid'),
    showFilters: z.boolean().default(true),
  }),

  /**
   * Plugin surfaces the admin POSITIONS rather than a layout destroys. Without
   * this, activating a custom layout silently removes the forum, shoutbox or
   * messaging UI, since those render through `slotRegistry`.
   */
  pluginSlot: z.object({
    slotId: z.string().min(1).max(120),
  }),

  // ── page.detail ─────────────────────────────────────────────────────────
  // A custom page's own parts. Three blocks rather than one, because unlike the
  // article index's filters/list/pagination they share no interaction state — and
  // splitting them is what lets an admin put the title in the header region and
  // the body beside a plugin block.

  // ── Whole-page blocks ───────────────────────────────────────────────────
  // One block per template for the pages adopted in bulk (2026-08-09). Each wraps
  // that page's existing component tree unchanged, so adopting the template is
  // visually a no-op and an admin can place blocks AROUND it.
  //
  // They carry no props on purpose. A prop here would be theme-authored
  // configuration selecting data — the exact thing `blockRegistry`'s "blocks
  // render, the host fetches" rule exists to prevent. With no data props, the
  // document decides only WHETHER and WHERE the page renders; every endpoint
  // behind it still applies its own permissions.
  //
  // Splitting any of these into finer blocks later is ADDITIVE: new types plus a
  // changed default, and an unknown type is kept rather than dropped.

  // ── members ─────────────────────────────────────────────────────────────
  // Decomposed like the profile: the head row and the rail/list row were flex and
  // grid wrappers, and both are now arrangements in the layout document instead.
  // The view blocks gate on the host's `show`, which it derives from the layout plus
  // the current tab.

  membersTabs: z.object({}),
  membersFilters: z.object({
    showSearch: z.boolean().default(true).meta({ title: 'Show the search field' }),
    showSort:   z.boolean().default(true).meta({ title: 'Show the sort choices' }),
  }),
  membersList: z.object({
    showCount: z.boolean().default(true).meta({ title: 'Show the count and online line' }),
  }),
  membersTeam: z.object({
    showNote: z.boolean().default(true).meta({ title: 'Show the explanatory note' }),
  }),
  membersHofStats: z.object({}),
  membersPodium:   z.object({}),
  membersHowTo:    z.object({}),

  // ── home ────────────────────────────────────────────────────────────────
  // Decomposed like the profile and members. Unlike those two the pieces share NO
  // interaction state — each card is independent — so there is nothing for the host
  // to hoist and each block keeps its own query. They carry no data-selecting props,
  // which is the line that matters.
  //
  // The guest/member split is expressed as an AUDIENCE rather than a code branch:
  // the landing block ships `guests` and the three-column arrangement ships
  // `members`. That is what makes it personalizable — an admin can show the hero to
  // everyone, or replace it outright.

  // ── The guest landing ───────────────────────────────────────────────────
  // These props REPLACE the `Appearance → Guest Home` page. Its hero strings and
  // section toggles were settings (`guesthome.*`) edited by a second appearance
  // editor; they belong to the arrangement, so they live on the blocks and the
  // editor generates the form from these schemas.
  //
  // `LocalizedText` throughout, so the shipped copy stays translatable while an
  // admin's own wording is a plain string in whatever language they typed.
  //
  // Feed SOURCES stay a setting: they name plugin feed sources that may not exist on
  // another install, and a prop would let a theme carry them somewhere they mean
  // nothing.

  guestSurface: z.object({}),

  guestBody: z.object({}),

  guestHero: z.object({
    /**
     * An upload path (`themes/assets/hero.jpg`) or an absolute URL. Empty keeps the
     * token-driven gradient the panel ships with.
     *
     * ⚠ A path into `/uploads` is SITE content, not theme content — a `.xttheme`
     * carries no assets yet, so exporting a layout that references one produces a
     * broken link on the importing site. See `docs/plugin-blocks.md`.
     */
    backgroundImage: z.string().max(500).default('')
      .meta({
        title: 'Background image',
        description: 'Upload path or URL. Leave empty for the default gradient.',
        // Collected into the package on export and rewritten on import, so the
        // image travels with the theme instead of dangling.
        asset: true,
      }),
    /**
     * Contrast scrim. A photograph behind body text is unreadable often enough that
     * shipping the knob is cheaper than shipping the complaint — and it is a token,
     * so it follows the theme rather than being a hardcoded rgba.
     */
    overlay: z.enum(['none', 'light', 'dark']).default('none')
      .meta({ title: 'Overlay', description: 'Darkens or lightens the image so text stays readable.' }),
  }),

  guestHeroText: z.object({
    badge:        localizedTextSchema.meta({ title: 'Badge text', description: 'Follows the live online count.' }),
    title:        localizedTextSchema.meta({ title: 'Headline' }),
    subtitle:     localizedTextSchema.meta({ title: 'Sub-headline', description: '“{members}” is replaced with the member count.' }),
    ctaPrimary:   localizedTextSchema.meta({ title: 'Primary button' }),
    ctaSecondary: localizedTextSchema.meta({ title: 'Secondary button' }),
    showStats:    z.boolean().default(true).meta({ title: 'Show the member / post counters' }),
  }),

  guestPresence: z.object({
    rows: z.number().int().min(1).max(6).default(3).meta({ title: 'Activity rows' }),
  }),

  guestFeed: z.object({
    showCategories: z.boolean().default(true).meta({ title: 'Show the category filter' }),
  }),

  guestRail: z.object({
    showCategories: z.boolean().default(true).meta({ title: 'Show categories' }),
    showOnline:     z.boolean().default(true).meta({ title: 'Show who is online' }),
    showTags:       z.boolean().default(true).meta({ title: 'Show popular tags' }),
  }),

  homeMeCard:          z.object({}),
  homeSectionNav:      z.object({}),
  homeSpaces:          z.object({}),
  homeFeed:            z.object({}),
  homeProgression:     z.object({}),
  homeHotThreads:      z.object({}),
  homePopularTags:     z.object({}),
  homeSuggestedPeople: z.object({}),

  articleDetail: z.object({}),

  // ── profile ─────────────────────────────────────────────────────────────
  // Decomposed rather than kept whole (2026-08-09), so an admin can rearrange the
  // card itself: move the avatar, drop the bio, put the stats above the identity.
  // The host resolves the profile once and every piece reads it from context.
  //
  // `profileCard` is only the panel — background, radius, padding. The arrangement
  // inside it is `columns`/`column`, the same generic containers any other template
  // uses, which is why the pieces need no layout props of their own.

  profileCard: z.object({
    padding: z.enum(['none', 'sm', 'md', 'lg']).default('md'),
  }),

  profileAvatar: z.object({
    size: z.enum(['sm', 'md', 'lg']).default('lg')
      .meta({ title: 'Avatar size' }),
    /**
     * Pull the avatar up over the band above it.
     *
     * Only means anything directly under a `profileCover`; anywhere else it is a
     * negative margin against whatever happens to be above, which is why it is off
     * by default rather than assumed.
     */
    overlap: z.boolean().default(false).meta({
      title:       'Overlap the cover',
      description: 'Lifts the avatar over the band above it. For use under a cover.',
    }),
  }),

  /** The band behind the top of the profile. */
  profileCover: z.object({
    height: z.number().int().min(80).max(600).default(220).meta({
      title:       'Height (px)',
      description: 'The band behind the profile header.',
    }),
    /** Image and gradient, exactly as `section` and `header` carry them. */
    backgroundImage: z.string().max(500).default('').meta({
      title: 'Background image', description: 'Upload path or URL. Drawn over the gradient.', asset: true,
    }),
    backgroundGradient: z.array(z.string().max(60)).max(3).default([]).meta({ title: 'Gradient' }),
    backgroundAngle: z.number().int().min(0).max(360).default(180).meta({ title: 'Direction' }),
  }),

  /** Where this member stands on the ladder, and what the next rung grants. */
  profileRank: z.object({
    showUnlocks: z.boolean().default(true).meta({
      title:       'Show what the next rank unlocks',
      description: 'The limits the next rung raises. Hidden when there is no next rung.',
    }),
  }),

  /** The awards this member holds (ADR-0009). */
  profileBadges: z.object({
    max: z.number().int().min(1).max(50).default(12).meta({
      title:       'Badges to show',
      description: 'Beyond this many, the rest collapse into a count.',
    }),
    size: z.enum(['sm', 'md']).default('md').meta({ title: 'Badge size' }),
  }),

  /** Who has looked at this profile lately. */
  profileVisitors: z.object({
    max: z.number().int().min(3).max(12).default(5).meta({ title: 'Avatars to show' }),
  }),

  /** A strip of followers beside the page. */
  profileFollowers: z.object({
    max: z.number().int().min(3).max(12).default(5).meta({ title: 'Avatars to show' }),
  }),

  profileIdentity: z.object({
    showHandle:  z.boolean().default(true).meta({ title: 'Show @handle' }),
    showJoined:  z.boolean().default(true).meta({ title: 'Show “member since”' }),
    showBadges:  z.boolean().default(true).meta({ title: 'Show group badges' }),
    // A former-usernames line is a moderation affordance as much as a courtesy, so
    // it is a deliberate choice rather than always-on.
    showFormerly: z.boolean().default(true).meta({ title: 'Show previous usernames' }),
  }),

  profileActions: z.object({}),
  profileBio:     z.object({}),
  profileStats:   z.object({}),
  profileTabs:    z.object({}),
  profileContent: z.object({}),

  pageImage: z.object({}),

  pageTitle: z.object({
    // The level is an admin choice, since a title moved below other headings
    // should not stay an h1. The TEXT never is: it is the page's own title, and a
    // layout must not be able to rename a page.
    level: z.union([z.literal(1), z.literal(2)]).default(1)
      .meta({ title: 'Heading level' }),
  }),

  pageBody: z.object({}),

  // ── Site chrome (Amendment 1) ───────────────────────────────────────────
  // Every chrome block decides its OWN visibility: `userMenu` shows an avatar
  // when signed in and sign-in buttons when not; `notifications` renders nothing
  // for guests. The admin arranges WHERE a block sits; the block owns WHETHER it
  // appears. Making that an admin setting would mean one document per auth state,
  // and would let an admin build a header that is empty for the visitors who most
  // need it.

  /**
   * The nav strip, as a BLOCK inside the header.
   *
   * It has no props of its own — it is a row, and everything about what is in it is
   * expressed by its children and their `align`. Making it a block is what lets a
   * masthead sit above or below it: both are blocks in the header region, so the
   * order is the order they are in, not a choice between two named slots.
   */
  /**
   * THE HEADER — the band at the top of every page.
   *
   * Not a `section` with a gradient on it: that is what it used to be, and it made
   * the site's most recognisable element an arrangement an admin had to know how to
   * assemble (a full-width section, a height, two colour stops, a logo dropped
   * inside). It is one block now, with the four things anyone actually sets.
   *
   * It sits in `chrome.header` beside the `navbar`, and their ORDER is the
   * arrangement: navbar under the band or over it, by moving one row. Deleting the
   * block is how a site chooses to have no band at all and run on the navbar alone —
   * the picker puts it back.
   *
   * ⚠ Deliberately NOT a container. Everything a masthead holds in practice is the
   * logo, and a band that accepts arbitrary blocks is a `section` — which still
   * exists for exactly that.
   */
  header: z.object({
    /**
     * A FLOOR, not a fixed height, for the same reason `section.minHeight` is one:
     * a longer wordmark, a bigger font from an accessibility setting or a translated
     * site name must push the band rather than be clipped by it.
     */
    height: z.number().int().min(0).max(2000).default(250).meta({
      title:       'Height (px)',
      description: 'The band grows if its content needs more. 0 = only as tall as the logo.',
    }),

    /** Upload path or absolute URL, drawn OVER the gradient. `asset: true` is what
     *  makes it travel in a `.xttheme` — see `section.backgroundImage`. */
    backgroundImage: z.string().max(500).default('').meta({
      title:       'Background image',
      description: 'Upload path or URL. Drawn over the gradient. Leave empty for none.',
      asset:       true,
    }),

    /** Gradient stops, in order. Empty = no gradient; ONE colour paints a flat fill. */
    backgroundGradient: z.array(cssColorSchema).max(3).default(['#2b1055', '#7597de']),

    /** Gradient direction in degrees; 90 = left to right, which is how a wide band
     *  reads. Same units as `section` so the two panels behave identically. */
    backgroundAngle: z.number().int().min(0).max(360).default(90),

    /** The logo, at the left of the band, aligned with the navbar's own. */
    showLogo: z.boolean().default(true).meta({
      title:       'Show the logo',
      description: 'At the left of the band, in line with the navbar below it.',
    }),

    /** The site name beside the logomark — the same choice the `logo` block offers,
     *  because a masthead often wants the mark alone at a larger size. */
    showWordmark: z.boolean().default(true).meta({ title: 'Show the site name too' }),
  }),

  navbar: z.object({}),

  logo: z.object({
    showWordmark: z.boolean().default(true)
      .meta({ title: 'Show site name next to the logo' }),
  }),

  navLinks: z.object({}),

  search: z.object({
    expanded: z.boolean().default(false)
      .meta({ title: 'Always expanded', description: 'Otherwise the field opens when clicked.' }),
  }),

  themeToggle: z.object({}),
  notifications: z.object({}),
  adminLink: z.object({}),

  /** Renders every `slotRegistry.registerHeaderWidget` in one place — the
   *  compatibility path, so existing plugins need no change. */
  headerWidgets: z.object({}),

  userMenu: z.object({}),

  /**
   * THE FOOTER — the band, and everything in it.
   *
   * The peer of `navbar`, NOT of `header`: the masthead band sits ABOVE the navbar
   * and is therefore its own block, while the footer's band IS its container — its
   * pieces are painted ON it, so a band beside them would leave the contents outside
   * the thing that draws them.
   *
   * Before this the footer's own appearance — background, the hairline above it, the
   * content column — was hardcoded in `SiteFooter.tsx`, so `chrome.footer` was a
   * region holding four leaves and an admin who clicked "the footer" found nothing
   * there. The header had been a block for a release; this is the other half.
   *
   * ⚠ It renders `.xt-foot`, which is `SCOPE_SELECTOR.footer` — the Style Editor's
   * whole Footer section is emitted under that class. Renaming it here silently
   * empties that panel.
   */
  footer: z.object({
    /** A FLOOR, like `header.height` and `section.minHeight`: footer content is
     *  translated, and a taller stack must push the band rather than be clipped. */
    minHeight: z.number().int().min(0).max(2000).default(0).meta({
      title:       'Minimum height (px)',
      description: 'The band grows with its contents. 0 = only as tall as they need.',
    }),

    /** Upload path or absolute URL, drawn OVER the gradient — see `header`. */
    backgroundImage: z.string().max(500).default('').meta({
      title:       'Background image',
      description: 'Upload path or URL. Drawn over the gradient. Leave empty for none.',
      asset:       true,
    }),

    /** Empty = the footer keeps `--footer-bg` from the Style Editor, which is what
     *  a site that has never opened this panel is already wearing. A gradient here
     *  is an override, never the default look. */
    backgroundGradient: z.array(cssColorSchema).max(3).default([]),

    backgroundAngle: z.number().int().min(0).max(360).default(90),

    /** The hairline that separates the footer from the page. Off for a footer whose
     *  own background already does the separating. */
    showTopBorder: z.boolean().default(true).meta({ title: 'Line above the footer' }),
  }),

  whosOnline: z.object({
    maxNames: z.number().int().min(0).max(100).default(20)
      .meta({ title: 'Names to list', description: '0 shows the count only.' }),
  }),

  groupLegend: z.object({}),
  boardStats: z.object({}),

  branding: z.object({
    showUptime: z.boolean().default(true).meta({ title: 'Show uptime and latency' }),
    /**
     * The reader's theme picker, at the right of the brand row.
     *
     * ⚠ A prop on BRANDING rather than a block of its own. It belongs beside the
     * site's mark and its links, and a second placeable control doing the same thing
     * would be two ways to reach one setting — with nothing saying which the admin
     * meant when both were on the page.
     *
     * It draws nothing when fewer than two themes are installed, so leaving it on is
     * free for a site that has never installed one.
     */
    showThemeChooser: z.boolean().default(true).meta({
      title:       'Show the theme picker',
      description: 'Lets a reader choose between installed themes, for themselves only.',
    }),
  }),
} as const;

export type CoreBlockType = keyof typeof blockPropSchemas;

// ── Default documents ───────────────────────────────────────────────────────
// Every template ships a code default. It is the fallback when nothing is
// stored, when a stored document fails validation, and the target of
// "Reset to default". A template is never without a renderable document.

const node = (id: string, type: string, props: Record<string, unknown> = {}): BlockNode =>
  ({ id, type, props });

export const DEFAULT_LAYOUTS: Record<CoreTemplateKey, LayoutDocument> = {
  // Guests get the landing, members get the three-column home — expressed as
  // audiences, so an admin can change who sees which instead of it being a branch in
  // code. The rails are `sidebar`/`rail` tracks, sticky, reproducing the old grid.
  'home': {
    templateKey: 'home', schemaVersion: LAYOUT_SCHEMA_VERSION,
    regions: {
      main: [
        // The guest landing, composed. One `guests` audience on the surface hides the
        // whole subtree from members. The hero copy here is the SHIPPED wording, held
        // as i18n references so it stays translatable; an admin's own text replaces a
        // reference with a plain string.
        {
          ...node('h-guest', 'guestSurface'),
          visibility: { audience: 'guests', groups: [] },
          children: [
            { ...node('h-ghero', 'guestHero'), children: [
              node('h-ghtext', 'guestHeroText', {
                badge:        { key: 'guestHome.hero.badge',        ns: 'common' },
                title:        { key: 'guestHome.hero.title',        ns: 'common' },
                subtitle:    { key: 'guestHome.hero.subtitle',      ns: 'common' },
                ctaPrimary:   { key: 'guestHome.hero.ctaPrimary',   ns: 'common' },
                ctaSecondary: { key: 'guestHome.hero.ctaSecondary', ns: 'common' },
                showStats: true,
              }),
              node('h-gpres', 'guestPresence', { rows: 3 }),
            ] },
            { ...node('h-gbody', 'guestBody'), children: [
              node('h-gfeed', 'guestFeed', { showCategories: true }),
              node('h-grail', 'guestRail', {
                showCategories: true, showOnline: true, showTags: true,
              }),
            ] },
          ],
        },
        {
          ...node('h-cols', 'columns', { gap: 'md' }),
          visibility: { audience: 'members', groups: [] },
          children: [
            { ...node('h-leftcol', 'column', { width: 'sidebar', sticky: true }), children: [
              node('h-me',   'homeMeCard'),
              node('h-nav',  'homeSectionNav'),
              node('h-spaces', 'homeSpaces'),
            ] },
            { ...node('h-feedcol', 'column', { width: '1', sticky: false }), children: [
              node('h-feed', 'homeFeed'),
            ] },
            { ...node('h-rightcol', 'column', { width: 'rail', sticky: true }), children: [
              // Keeps existing `registerLayoutWidget` plugins exactly where they were
              // (shoutbox's home rail). Each widget is ALSO its own block now, so an
              // admin can position one individually instead — see layout/slotBlocks.
              node('h-plugins', 'pluginSlot', { slotId: 'aside' }),
              node('h-prog',    'homeProgression'),
              node('h-hot',     'homeHotThreads'),
              node('h-tags',    'homePopularTags'),
              node('h-people',  'homeSuggestedPeople'),
            ] },
          ],
        },
      ],
      aside: [],
    },
  },
  'article.index': {
    templateKey: 'article.index', schemaVersion: LAYOUT_SCHEMA_VERSION,
    regions: {
      main:   [node('default-index', 'articleIndex', { defaultView: 'grid', showFilters: true })],
      aside:  [],
    },
  },
  'article.detail': {
    templateKey: 'article.detail', schemaVersion: LAYOUT_SCHEMA_VERSION,
    regions: {
      // `beforeBody`/`afterBody` are gone: they were two empty regions that existed
      // on this one template so something could be placed around the article, which
      // is what ordering blocks inside `main` already does.
      main: [node('a-detail', 'articleDetail')],
      aside: [],
    },
  },
  // Reproduces PageReaderPage's previous hardcoded markup exactly — image, then
  // title, then body — so adopting the template moves nothing until an admin moves
  // it, and "Reset to default" restores precisely what shipped.
  'page.detail': {
    templateKey: 'page.detail', schemaVersion: LAYOUT_SCHEMA_VERSION,
    regions: {
      main:   [
        node('p-image', 'pageImage'),
        node('p-title', 'pageTitle', { level: 1 }),
        node('p-body',  'pageBody'),
      ],
      aside:  [],
    },
  },
  // The profile card, composed the way an admin could have composed it — the
  // avatar in an `auto` track beside a flexible one holding identity, actions, bio
  // and stats. Reproduces the previous arrangement, and every piece is now movable.
  'profile': {
    templateKey: 'profile', schemaVersion: LAYOUT_SCHEMA_VERSION,
    regions: {
      main: [
        // The band, then the card that overlaps it. Two blocks rather than one so an
        // admin can drop the cover entirely and get the old flat header back.
        node('pr-cover', 'profileCover', {
          height: 220, backgroundImage: '', backgroundGradient: [], backgroundAngle: 180,
        }),
        { ...node('pr-card', 'profileCard', { padding: 'md' }), children: [
          // The head row: avatar, then who this is, then what a viewer can do.
          { ...node('pr-row', 'columns', { gap: 'md' }), children: [
            { ...node('pr-avcol', 'column', { width: 'auto' }), children: [
              node('pr-av', 'profileAvatar', { size: 'lg', overlap: true }),
            ] },
            { ...node('pr-idcol', 'column', { width: '1' }), children: [
              node('pr-id', 'profileIdentity', {
                showHandle: true, showJoined: true, showBadges: true, showFormerly: true,
              }),
            ] },
            { ...node('pr-actcol', 'column', { width: 'auto' }), children: [
              node('pr-act', 'profileActions'),
            ] },
          ] },
          // ⚠ Bio and stats are siblings of that row, NOT children of the identity
          // column. Nested there they started where the avatar ends, so the tiles
          // were indented by 120px and never reached the card's left edge.
          node('pr-bio',   'profileBio'),
          node('pr-stats', 'profileStats'),
        ] },
        node('pr-tabs',    'profileTabs'),
        node('pr-content', 'profileContent'),
      ],
      /**
       * The rank rail.
       *
       * Every block here draws NOTHING on a site with progression switched off or no
       * ladder configured, and the rail collapses to give the body its width back —
       * so shipping them by default costs a site that does not rank people nothing.
       */
      aside: [
        node('pr-rank',   'profileRank',   { showUnlocks: true }),
        node('pr-badges', 'profileBadges', { max: 8, size: 'md' }),
        node('pr-follow', 'profileFollowers', { max: 5 }),
        node('pr-visitors', 'profileVisitors', { max: 5 }),
      ],
    },
  },
  // The head row and the rail/list row, rebuilt as weighted columns — the same
  // picture the flex and grid wrappers produced, now movable.
  'members': {
    templateKey: 'members', schemaVersion: LAYOUT_SCHEMA_VERSION,
    regions: {
      // The head row opens the BODY. It used to sit in the page's own `header`
      // region — a band above the body, inside `<main>` — and that region is gone:
      // it was never the page's header (the site's is), and "first block in the
      // body" is the same position without the misleading name.
      main: [
        { ...node('m-headrow', 'columns', { gap: 'md' }), children: [
          { ...node('m-titlecol', 'column', { width: '1' }), children: [
            // Two elements, not one: the label and the title are separately movable
            // and their text is editable, which a fixed `membersHeading` was not.
            node('m-eyebrow', 'eyebrow', { text: { key: 'eyebrow', ns: 'members' }, align: 'start' }),
            node('m-title', 'heading', { text: { key: 'title', ns: 'members' }, level: 1, align: 'start' }),
          ] },
          { ...node('m-tabcol', 'column', { width: 'auto' }), children: [
            node('m-tabs', 'membersTabs'),
          ] },
        ] },
        { ...node('m-dirrow', 'columns', { gap: 'md' }), children: [
          { ...node('m-railcol', 'column', { width: 'auto' }), children: [
            node('m-filters', 'membersFilters', { showSearch: true, showSort: true }),
          ] },
          { ...node('m-listcol', 'column', { width: '1' }), children: [
            node('m-list', 'membersList', { showCount: true }),
          ] },
        ] },
        node('m-team',  'membersTeam', { showNote: true }),
        node('m-hofst', 'membersHofStats'),
        node('m-podium', 'membersPodium'),
        node('m-howto', 'membersHowTo'),
      ],
      aside: [],
    },
  },
  /*
   * The site header: a `navbar` block, and room above and below it for anything
   * else. Reproduces the hardcoded PubNav arrangement exactly — the same blocks in
   * the same order — so adopting this moves nothing until an admin moves it.
   *
   * `align` carries what the old `left`/`center`/`right` regions carried. Absent is
   * the start of the row, so the logo and the links need none.
   */
  'chrome.header': {
    templateKey: 'chrome.header', schemaVersion: LAYOUT_SCHEMA_VERSION,
    regions: {
      header: [
        // The band first, the navbar under it — the arrangement most sites start
        // from, and one drag from the other one.
        node('h-band', 'header', {
          height: 250, showLogo: true, showWordmark: true,
          backgroundGradient: ['#2b1055', '#7597de'], backgroundAngle: 90,
        }),
        { ...node('h-navbar', 'navbar'), children: [
          node('h-logo', 'logo', { showWordmark: true }),
          node('h-nav', 'navLinks'),
          { ...node('h-search', 'search', { expanded: false }), align: 'right' as const },
          { ...node('h-theme',   'themeToggle'),   align: 'right' as const },
          { ...node('h-widgets', 'headerWidgets'), align: 'right' as const },
          { ...node('h-notif',   'notifications'), align: 'right' as const },
          { ...node('h-admin',   'adminLink'),     align: 'right' as const },
          { ...node('h-user',    'userMenu'),      align: 'right' as const },
        ] },
      ],
    },
  },
  // The site footer: ONE band block holding the four pieces, mirroring the header's
  // `[band, navbar]`. Deleting the band means "no footer chrome" and the pieces can
  // be dragged out of it to say exactly that; the shipped arrangement is what the
  // hardcoded `.xt-foot` wrapper rendered before it was a block.
  'chrome.footer': {
    templateKey: 'chrome.footer', schemaVersion: LAYOUT_SCHEMA_VERSION,
    regions: {
      footer: [
        { ...node('f-band', 'footer', { showTopBorder: true }), children: [
          node('f-online', 'whosOnline', { maxNames: 20 }),
          node('f-legend', 'groupLegend'),
          node('f-stats',  'boardStats'),
          node('f-brand',  'branding', { showUptime: true }),
        ] },
      ],
    },
  },
};

/**
 * Parse a stored document, falling back to the code default.
 *
 * Never throws: a template must always render. A document that fails validation
 * is a bug or a downgrade, and the right response is the default page plus an
 * ACP warning — not a broken site.
 */
export function parseLayoutDocument(
  templateKey: TemplateKey,
  raw: unknown,
): { document: LayoutDocument; usedDefault: boolean } {
  const parsed = layoutDocumentSchema.safeParse(raw);
  if (!parsed.success || parsed.data.templateKey !== templateKey) {
    return { document: defaultLayoutFor(templateKey), usedDefault: true };
  }
  return { document: parsed.data, usedDefault: false };
}

// ── Tree rules ──────────────────────────────────────────────────────────────
// `layoutDocumentSchema` proves the SHAPE of a document. These are the rules that
// shape cannot express, and they are checked on write rather than on read: a
// document that breaks them is not a page to degrade gracefully, it is a document
// that should never have been stored. The editor cannot produce one — the point of
// checking is that a hand-written or third-party `.xttheme` can.

const CORE_CONTAINERS = new Set<string>(CORE_CONTAINER_TYPES);

/**
 * Structural problems in a document's block tree. Empty means valid.
 *
 * Returns every problem rather than throwing on the first, so an admin importing
 * a broken package sees what is wrong with it instead of fixing one line at a
 * time. Messages are developer/admin-facing English by design: they name block
 * types and ids, which are not translatable, and §60 keeps the API locale-agnostic.
 */
export function validateBlockTree(
  regions: Record<string, BlockNode[]>,
  opts: { maxDepth?: number; requiredTypes?: readonly string[] } = {},
): string[] {
  const maxDepth = opts.maxDepth ?? MAX_BLOCK_DEPTH;
  const required = new Set(opts.requiredTypes ?? []);
  const problems: string[] = [];
  const seen = new Set<string>();

  const walk = (nodes: BlockNode[], depth: number, parent: BlockNode | null) => {
    for (const node of nodes) {
      // Duplicate ids break selection and moves silently: both the tree and the
      // preview address a block by id, so two nodes sharing one means edits land
      // on whichever comes first.
      if (seen.has(node.id)) problems.push(`Duplicate block id "${node.id}".`);
      else seen.add(node.id);

      if (depth > maxDepth) {
        problems.push(`Block "${node.type}" nests deeper than ${maxDepth} levels.`);
        continue; // one report per branch, not one per node all the way down
      }

      // A `column` outside a `columns` row has no track to occupy, and a
      // `columns` row holding anything else would put a bare block where a track
      // belongs — both render as a broken grid rather than an error.
      // A required block may be MOVED anywhere — including into a container — but
      // an audience would let an admin do by restriction exactly what deletion is
      // forbidden to do. A header nobody can see a sign-in link in is the locked
      // door that `REQUIRED_BLOCKS` exists to prevent.
      if (required.has(node.type) && isRestricted(node.visibility)) {
        problems.push(`Block "${node.type}" is required and cannot be limited to an audience.`);
      }

      if (node.type === 'column' && parent?.type !== 'columns') {
        problems.push('A "column" may only sit inside a "columns" block.');
      }
      if (parent?.type === 'columns' && node.type !== 'column') {
        problems.push(`A "columns" block may only contain "column" blocks, found "${node.type}".`);
      }

      if (node.children?.length) {
        // Unknown (plugin) types are permitted children-carriers: core cannot know
        // whether a plugin block is a container, and guessing would break one.
        const known = node.type in blockPropSchemas;
        if (known && !CORE_CONTAINERS.has(node.type)) {
          problems.push(`Block "${node.type}" cannot contain other blocks.`);
        }
        walk(node.children, depth + 1, node);
      }
    }
  };

  for (const nodes of Object.values(regions)) walk(nodes, 1, null);
  return problems;
}

// ── Assets ──────────────────────────────────────────────────────────────────

/**
 * Which of a block's props hold an asset reference.
 *
 * DERIVED from the schemas rather than listed by hand: a prop opts in with
 * `.meta({ asset: true })`, and a new block that takes an image is picked up without
 * anyone remembering to update a second list. A hardcoded list is exactly the kind
 * that drifts, and the failure is silent — a theme exports without its images.
 *
 * Custom `meta` keys survive `z.toJSONSchema`, which is the same mechanism the editor
 * already relies on for `title` and `description`.
 */
const assetPropCache = new Map<string, readonly string[]>();

export function assetPropsOf(blockType: string): readonly string[] {
  const cached = assetPropCache.get(blockType);
  if (cached) return cached;

  const schema = (blockPropSchemas as Record<string, z.ZodTypeAny | undefined>)[blockType];
  let props: string[] = [];
  if (schema) {
    try {
      const json = z.toJSONSchema(schema, { io: 'input' }) as {
        properties?: Record<string, { asset?: boolean }>;
      };
      props = Object.entries(json.properties ?? {})
        .filter(([, def]) => def?.asset === true)
        .map(([key]) => key);
    } catch {
      // A schema that cannot be converted simply carries no assets.
      props = [];
    }
  }
  assetPropCache.set(blockType, props);
  return props;
}

/**
 * True for a reference that names a file in THIS site's uploads.
 *
 * An absolute URL belongs to someone else's server and works anywhere, so it is left
 * alone; a rooted path is site-absolute and ambiguous, so it is left alone too. What
 * remains is a relative upload path, which is the only kind that has to travel inside
 * the package or break on the way.
 */
export function isPortableAssetRef(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim() !== ''
    && !/^https?:\/\//i.test(value)
    && !value.startsWith('/')
    && !value.includes('..');
}

/** Every distinct upload path a document references. */
export function collectAssetRefs(doc: { regions: Record<string, BlockNode[]> }): string[] {
  const out = new Set<string>();
  const visit = (nodes: BlockNode[]) => {
    for (const node of nodes) {
      for (const prop of assetPropsOf(node.type)) {
        const value = node.props[prop];
        if (isPortableAssetRef(value)) out.add(value);
      }
      if (node.children?.length) visit(node.children);
    }
  };
  for (const nodes of Object.values(doc.regions)) visit(nodes);
  return [...out];
}

/** Rewrite every asset reference through `map`, in place on a cloned document. */
export function rewriteAssetRefs(
  doc: { regions: Record<string, BlockNode[]> },
  map: (ref: string) => string | undefined,
): void {
  const visit = (nodes: BlockNode[]) => {
    for (const node of nodes) {
      for (const prop of assetPropsOf(node.type)) {
        const value = node.props[prop];
        if (!isPortableAssetRef(value)) continue;
        const next = map(value);
        if (next !== undefined) node.props[prop] = next;
      }
      if (node.children?.length) visit(node.children);
    }
  };
  for (const nodes of Object.values(doc.regions)) visit(nodes);
}

// ── Core seed ───────────────────────────────────────────────────────────────
// Runs at module load, so the registry is populated before anything reads it and
// core templates never depend on registration order. It sits at the BOTTOM because
// it consumes `DEFAULT_LAYOUTS` and `validateBlockTree`, which are declared above.
//
// Core goes through the same `registerTemplate` a plugin does — one code path, so a
// rule that would refuse a plugin's declaration refuses core's too rather than
// being quietly untested.

for (const key of CORE_TEMPLATE_KEYS) {
  registerTemplate({
    key,
    regions:         TEMPLATE_REGIONS[key],
    defaultDocument: DEFAULT_LAYOUTS[key],
    requiredBlocks:  REQUIRED_BLOCKS[key],
  });
}

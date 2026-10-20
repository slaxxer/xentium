/**
 * Layout documents (ADR-0005), per theme.
 *
 * Structure per template, stored as data. Two scopes: `draft` (what the ACP
 * editor writes) and `published` (what the site serves). Deliberately mirrors
 * the appearance draft→publish model — one staging concept for the whole
 * Appearance area, not two.
 *
 * ## Per theme
 *
 * Every row belongs to a THEME KEY (`''` = the built-in Core theme, otherwise an
 * installed theme's id). Each theme carries its own arrangement and is edited on its
 * own; switching the site's theme changes which key is served, and nothing is copied.
 *
 * ## Resolution
 *
 * For one theme: the variant's row, then the template default's row, then what the
 * THEME SHIPS for that template, then the code default. The theme's package is the
 * baseline under the admin's edits — so a template nobody touched follows a theme
 * update on its own, and "Revert to theme" is simply the package's document. Core
 * ships nothing, so for Core this is exactly the old variant → default → code chain.
 *
 * Absence is a valid, expected state: a fresh install, a failed validation and a
 * reset all converge on the same renderable page.
 *
 * ## Variants
 *
 * `variant` is `''` for the template default and a key for one instance's own
 * arrangement. No template accepts one today (`VARIANT_TEMPLATES` is empty since
 * custom pages were removed). Themes ship template defaults only.
 */
import {
  DEFAULT_SITE_FRAME,
  DEFAULT_VARIANT,
  LAYOUT_SCHEMA_VERSION,
  SITE_FRAME_ROW_KEY,
  parseSiteFrame,
  siteFrameSchema,
  type SiteFrame,
  defaultLayoutFor,
  isKnownTemplate,
  layoutDocumentSchema,
  missingRequiredBlocks,
  parseLayoutDocument,
  foldHomeAside,
  regionsFor,
  requiredBlocksFor,
  templateAcceptsVariants,
  templateKeys,
  validateBlockTree,
  type LayoutDocument,
  type LayoutDraftResponse,
  type LayoutSelector,
  type TemplateKey,
} from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { appearanceService } from "../appearance/appearance.service.js";
import { activeThemeKey, themeBaseline, type ThemeKey } from "../themes/themeKey.js";

type Scope = "draft" | "published";

/** Separator for the composite map key: a NUL can never appear in either half. */
const SEP = "\u0000";

/** Every stored document for a scope, keyed `templateKey` + NUL + `variant`. */
type ScopeMap = Map<string, LayoutDocument>;

const cacheKey = (templateKey: string, variant: string) => `${templateKey}${SEP}${variant}`;

/** The unique-index address of one row. */
const rowKey = (themeKey: ThemeKey, templateKey: string, variant: string, scope: Scope) => ({
  themeKey_templateKey_variant_scope: { themeKey, templateKey, variant, scope },
});

// ── Caches ───────────────────────────────────────────────────────────────────

/**
 * Published documents per theme, read on nearly every page render. Expire after 30s
 * as a backstop; every writer busts them.
 */
const publishedMemo = new Map<ThemeKey, { at: number; map: ScopeMap; frame: SiteFrame | null }>();
const PUBLISHED_TTL = 30_000;

/** A theme's shipped documents, parsed. Busted with the theme's baseline. */
const baselineDocsMemo = new Map<ThemeKey, Record<string, LayoutDocument>>();

/** Forget a theme's parsed documents — call when its package changes or goes away. */
export function bustThemeLayouts(themeId?: string): void {
  if (themeId !== undefined) {
    baselineDocsMemo.delete(themeId);
    publishedMemo.delete(themeId);
  } else {
    baselineDocsMemo.clear();
    publishedMemo.clear();
  }
}

async function loadScope(scope: Scope, themeKey: ThemeKey): Promise<ScopeMap> {
  const rows = await prisma.layout.findMany({ where: { scope, themeKey } });
  const out: ScopeMap = new Map();
  for (const row of rows) {
    const key = row.templateKey as TemplateKey;
    // A retired core key, or a template whose plugin is currently disabled. Ignored
    // rather than crashed on — and, crucially, the ROW is left alone: turning a
    // plugin off must never be what deletes an admin's arrangement of its pages.
    // (The site frame's row fails this too, and is read by `loadFrame`.)
    if (!isKnownTemplate(key)) continue;
    const { document, usedDefault } = parseLayoutDocument(key, row.document);
    // A stored document that no longer validates is a bug or a downgrade. Serving
    // the fallback is the right answer; silently persisting the broken one is not.
    if (!usedDefault) out.set(cacheKey(key, row.variant), document);
  }
  return out;
}

async function published(themeKey: ThemeKey): Promise<{ map: ScopeMap; frame: SiteFrame | null }> {
  const hit = publishedMemo.get(themeKey);
  if (hit && Date.now() - hit.at < PUBLISHED_TTL) return hit;
  const [map, frame] = await Promise.all([loadScope("published", themeKey), loadFrame("published", themeKey)]);
  const entry = { at: Date.now(), map, frame };
  publishedMemo.set(themeKey, entry);
  return entry;
}

/**
 * The code default, run through the SAME parse a stored row gets.
 *
 * ⚠ Not `DEFAULT_LAYOUTS[key]` directly. Zod emits object keys in schema order, so a
 * parsed document and the literal default compare unequal under `JSON.stringify` —
 * and every comparison in this file is a stringify (pending status, ownership).
 * ⚠ Invalidated by `bustCache`, because a plugin template's default arrives with the
 * plugin and can change with an update.
 */
let defaultCache = new Map<TemplateKey, LayoutDocument>();
function codeDefault(templateKey: TemplateKey): LayoutDocument {
  let doc = defaultCache.get(templateKey);
  if (!doc) {
    doc = parseLayoutDocument(templateKey, defaultLayoutFor(templateKey)).document;
    defaultCache.set(templateKey, doc);
  }
  return doc;
}

/**
 * What a theme ships, parsed through the same function every document goes through.
 * A document that does not parse is treated as absent — the CODE default is not what
 * the theme ships, but it is a page, which a broken file is not.
 */
async function shippedDocs(themeKey: ThemeKey): Promise<Record<string, LayoutDocument>> {
  const hit = baselineDocsMemo.get(themeKey);
  if (hit) return hit;
  const out: Record<string, LayoutDocument> = {};
  for (const [key, raw] of Object.entries((await themeBaseline(themeKey)).documents)) {
    const { document, usedDefault } = parseLayoutDocument(key as TemplateKey, raw);
    if (!usedDefault) out[key] = document;
  }
  baselineDocsMemo.set(themeKey, out);
  return out;
}

/** What a template is when nobody has edited it: the theme's version, else the code's. */
async function baselineFor(themeKey: ThemeKey, templateKey: TemplateKey): Promise<LayoutDocument> {
  return (await shippedDocs(themeKey))[templateKey] ?? codeDefault(templateKey);
}

/** Variant → template default → (caller supplies) the baseline. */
function resolveIn(map: ScopeMap, { templateKey, variant }: LayoutSelector): LayoutDocument | undefined {
  if (variant !== DEFAULT_VARIANT) {
    const own = map.get(cacheKey(templateKey, variant));
    if (own) return own;
  }
  return map.get(cacheKey(templateKey, DEFAULT_VARIANT));
}

async function resolve(map: ScopeMap, selector: LayoutSelector, themeKey: ThemeKey): Promise<LayoutDocument> {
  return resolveIn(map, selector) ?? baselineFor(themeKey, selector.templateKey);
}

// ── Site frame rows ─────────────────────────────────────────────────────────
// The frame is one document per theme, stored in this table under a key no template
// can have (`SITE_FRAME_ROW_KEY`). Its baseline is the theme's packaged frame, and
// Core's is full width.

const FRAME_SELECTOR: LayoutSelector = { templateKey: SITE_FRAME_ROW_KEY, variant: DEFAULT_VARIANT };

/** The frame stored in one scope, parsed, or `null` when there is no row. */
async function loadFrame(scope: Scope, themeKey: ThemeKey): Promise<SiteFrame | null> {
  const row = await prisma.layout.findUnique({
    where: rowKey(themeKey, SITE_FRAME_ROW_KEY, DEFAULT_VARIANT, scope),
    select: { document: true },
  });
  return row ? parseSiteFrame(row.document) : null;
}

/** What the theme ships as its frame, or null. */
async function shippedFrame(themeKey: ThemeKey): Promise<SiteFrame | null> {
  const raw = (await themeBaseline(themeKey)).frame;
  if (!raw) return null;
  const parsed = siteFrameSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Content equality, whatever the key order.
 *
 * ⚠ A stored document comes back from `jsonb` with ITS key order (Postgres normalises
 * it), while a code default or a theme package keeps the order it was written in, and
 * a parse through Zod only fixes the order of the keys its schema names — not a
 * block's `props`. So a draft identical to the default it falls back to compared
 * unequal under `JSON.stringify`, and "pending publish" never cleared.
 */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v
  ));
}
const same = (a: unknown, b: unknown) => stable(a) === stable(b);

const sameFrame = (a: SiteFrame, b: SiteFrame) => same(a, b);

async function liveFrame(themeKey: ThemeKey): Promise<SiteFrame> {
  return (await published(themeKey)).frame ?? (await shippedFrame(themeKey)) ?? DEFAULT_SITE_FRAME;
}

async function writeFrameRows(frame: SiteFrame, scopes: Scope[], userId: string, themeKey: ThemeKey): Promise<void> {
  const row = { document: frame as object, schemaVersion: LAYOUT_SCHEMA_VERSION, updatedById: userId };
  await prisma.$transaction(scopes.map((scope) => prisma.layout.upsert({
    where:  rowKey(themeKey, SITE_FRAME_ROW_KEY, DEFAULT_VARIANT, scope),
    update: row,
    create: { themeKey, templateKey: SITE_FRAME_ROW_KEY, variant: DEFAULT_VARIANT, scope, ...row },
  })));
}

/** What the Layout Editor's Site layout popover loads. */
export interface FrameDraftResponse {
  frame: SiteFrame;
  version: string | null;
  /** What the theme being edited ships, or `null` when it ships no frame (or is Core). */
  theme: SiteFrame | null;
  /** The theme being edited, for "Ships with the theme · Nebula 1.0.0". Null for Core. */
  themeName: { name: string; version: string } | null;
}

async function themeNameOf(themeKey: ThemeKey): Promise<FrameDraftResponse["themeName"]> {
  if (!themeKey) return null;
  const row = await prisma.theme.findUnique({ where: { id: themeKey }, select: { name: true, version: true } });
  return row ? { name: row.name, version: row.version } : null;
}

// ── Concurrency ──────────────────────────────────────────────────────────────

/**
 * This selector's OWN draft revision, or `null` when it has no row.
 *
 * Deliberately not read out of the cached scope map: that holds documents, and a
 * concurrency token has to come from the row itself.
 */
async function draftVersion(selector: LayoutSelector, themeKey: ThemeKey): Promise<string | null> {
  const row = await prisma.layout.findUnique({
    where: rowKey(themeKey, selector.templateKey, selector.variant, "draft"),
    select: { updatedAt: true },
  });
  return row ? row.updatedAt.toISOString() : null;
}

/**
 * Write a selector's draft row, optionally conditional on the revision the caller read.
 *
 * @param baseVersion `undefined` skips the check (internal callers, not racing anyone);
 *   `null` asserts there was no row; a string must equal the row's current revision.
 */
async function writeDraftRow(
  selector: LayoutSelector,
  document: object,
  schemaVersion: number,
  userId: string,
  baseVersion: string | null | undefined,
  themeKey: ThemeKey,
): Promise<void> {
  const key = {
    themeKey, templateKey: selector.templateKey, variant: selector.variant, scope: "draft",
  };
  const where = rowKey(themeKey, selector.templateKey, selector.variant, "draft");
  const data = { document, schemaVersion, updatedById: userId };

  if (baseVersion === undefined) {
    // Unconditional: the caller is not competing with anyone.
    await prisma.layout.upsert({ where, update: data, create: { ...key, ...data } });
  } else if (baseVersion === null) {
    // "There was no row when I read." The unique index is what decides — checking
    // for absence first and then creating is the race this exists to close.
    try {
      await prisma.layout.create({ data: { ...key, ...data } });
    } catch (e) {
      if (isUniqueViolation(e)) throw await staleWrite(selector, themeKey);
      throw e;
    }
  } else {
    // Conditional on the revision, so the read and the write cannot be split.
    const { count } = await prisma.layout.updateMany({
      where: { ...key, updatedAt: new Date(baseVersion) },
      data,
    });
    if (count === 0) throw await staleWrite(selector, themeKey);
  }
}

/** Prisma's unique-constraint violation, without importing the whole error namespace. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * Somebody else wrote this selector first. Carries the CURRENT revision so the client
 * can offer "keep mine" without a second round trip; `persist: false` because two
 * admins on one page is an expected outcome of a shared editor, not a fault.
 */
async function staleWrite(selector: LayoutSelector, themeKey: ThemeKey): Promise<XentiumError> {
  return new XentiumError({
    code: XEC.API_CONFLICT,
    httpStatus: 409,
    message: "This layout changed since you opened it.",
    details: { version: await draftVersion(selector, themeKey) },
    persist: false,
  });
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Reject a template nothing has registered. Reading tolerates an unknown key;
 * WRITING must not, or a typo stores a row no page will ever read.
 */
function assertTemplateKnown(templateKey: TemplateKey) {
  if (!isKnownTemplate(templateKey)) {
    throw new XentiumError({
      code: XEC.API_VALIDATION, httpStatus: 422,
      message: `Unknown template "${templateKey}". A plugin template needs its plugin enabled.`,
    });
  }
}

/** Reject a variant on a template that has no instances to vary. */
function assertVariantAllowed({ templateKey, variant }: LayoutSelector) {
  if (variant === DEFAULT_VARIANT) return;
  if (!templateAcceptsVariants(templateKey)) {
    throw new XentiumError({
      code: XEC.API_VALIDATION, httpStatus: 422,
      message: `"${templateKey}" does not support per-instance layouts.`,
    });
  }
}

/** Reject regions the template does not declare — an editor bug must not persist. */
function assertRegionsValid(doc: LayoutDocument) {
  const declared = new Set(regionsFor(doc.templateKey));
  const unknown = Object.keys(doc.regions).filter((r) => !declared.has(r));
  if (unknown.length > 0) {
    throw new XentiumError({
      code: XEC.API_VALIDATION, httpStatus: 422,
      message: `Unknown region(s) for "${doc.templateKey}": ${unknown.join(", ")}`,
    });
  }
  // Structural rules the SHAPE cannot express. The editor cannot produce these — the
  // check exists because a `.xttheme` import is a second way into this table.
  const treeProblems = validateBlockTree(doc.regions, {
    requiredTypes: requiredBlocksFor(doc.templateKey),
  });
  if (treeProblems.length > 0) {
    throw new XentiumError({
      code: XEC.API_VALIDATION, httpStatus: 422,
      message: `Invalid block tree in "${doc.templateKey}": ${treeProblems.join(" ")}`,
    });
  }
  // Chrome renders on every page: a header with no way to sign in is a locked door.
  const missing = missingRequiredBlocks(doc.templateKey, doc);
  if (missing.length > 0) {
    throw new XentiumError({
      code: XEC.API_VALIDATION, httpStatus: 422,
      message: `"${doc.templateKey}" cannot be saved without: ${missing.join(", ")}`,
    });
  }
}

// ── Shapes served ────────────────────────────────────────────────────────────

/** What the public endpoint serves: template defaults plus the variants that exist. */
export interface PublishedLayouts {
  /** Keyed by template — core's eight plus whatever enabled plugins registered. */
  templates: Record<string, LayoutDocument>;
  /**
   * Only variants that are actually stored, so a site with no per-page layouts pays
   * nothing. ⚠ This grows with the number of overridden pages.
   */
  variants: Partial<Record<string, Record<string, LayoutDocument>>>;
  /** How the page sits in the window. Always present — full width when nothing is set. */
  frame: SiteFrame;
}

async function toPublished(map: ScopeMap, frame: SiteFrame, themeKey: ThemeKey): Promise<PublishedLayouts> {
  const templates: Record<string, LayoutDocument> = {};
  // Registered templates only. A document stored for a disabled plugin's template is
  // not served — the page it belongs to does not exist right now — but it stays.
  for (const key of templateKeys()) {
    templates[key] = map.get(cacheKey(key, DEFAULT_VARIANT)) ?? await baselineFor(themeKey, key);
  }

  const variants: PublishedLayouts["variants"] = {};
  for (const [key, doc] of map) {
    const sep = key.indexOf(SEP);
    const templateKey = key.slice(0, sep) as TemplateKey;
    const variant = key.slice(sep + 1);
    if (variant === DEFAULT_VARIANT) continue;
    (variants[templateKey] ??= {})[variant] = doc;
  }
  return { templates, variants, frame };
}

/** One `xcf_layouts` row, captured verbatim. */
/** A published row as a Studio revision stores it. */
export interface PublishedRowSnapshot {
  templateKey: string;
  variant: string;
  document: unknown;
  schemaVersion: number;
}

export interface LayoutRowSnapshot {
  templateKey: string;
  variant:     string;
  scope:       string;
  document:    unknown;
}

export const layoutService = {
  /** What visitors get: the ACTIVE theme's published documents. */
  async getPublishedAll(): Promise<PublishedLayouts> {
    return this.getPublishedFor(await activeThemeKey());
  },

  /** One theme's published documents — what a visitor wearing it gets. */
  async getPublishedFor(themeKey: ThemeKey): Promise<PublishedLayouts> {
    const { map, frame } = await published(themeKey);
    return toPublished(map, frame ?? (await shippedFrame(themeKey)) ?? DEFAULT_SITE_FRAME, themeKey);
  },

  /**
   * As a VISITOR wearing one of the installed themes would see the site: that theme
   * as the admin has made it. An id naming nothing installed gets the active theme —
   * a cookie outlives an uninstall.
   */
  async getPublishedAllForTheme(themeId: string): Promise<PublishedLayouts> {
    const row = await prisma.theme.findUnique({ where: { id: themeId }, select: { id: true } });
    return row ? this.getPublishedFor(themeId) : this.getPublishedAll();
  },

  /**
   * Every template as one theme's DRAFT would render it. Backs the editor's preview
   * iframe, which loads the real routes so blocks get real context.
   */
  async getDraftAll(themeKey: ThemeKey): Promise<PublishedLayouts> {
    const [drafts, live, frameDraft] = await Promise.all([
      loadScope("draft", themeKey), published(themeKey), loadFrame("draft", themeKey),
    ]);
    // Draft wins per (template, variant); anything untouched falls through to live.
    const merged: ScopeMap = new Map(live.map);
    for (const [key, doc] of drafts) merged.set(key, doc);
    return toPublished(merged, frameDraft ?? (await liveFrame(themeKey)), themeKey);
  },

  /** Published document for one selector of one theme. */
  async getPublished(selector: LayoutSelector, themeKey: ThemeKey): Promise<LayoutDocument> {
    return resolve((await published(themeKey)).map, selector, themeKey);
  },

  /**
   * What the editor loads: this selector's draft, falling back to what it would
   * resolve to live — so opening a variant nobody touched starts from the template
   * default rather than a blank page.
   */
  async getDraft(selector: LayoutSelector, themeKey: ThemeKey): Promise<LayoutDraftResponse> {
    assertVariantAllowed(selector);
    const [drafts, version] = await Promise.all([
      loadScope("draft", themeKey),
      draftVersion(selector, themeKey),
    ]);

    const own = drafts.get(cacheKey(selector.templateKey, selector.variant));
    if (own) return { document: own, version };

    // An untouched variant inherits the DRAFT default, not the published one — an
    // admin who edits the shared default and then switches the picker to one page
    // must not be shown a version they have already moved past.
    if (selector.variant !== DEFAULT_VARIANT) {
      const templateDraft = drafts.get(cacheKey(selector.templateKey, DEFAULT_VARIANT));
      // `version` stays null: what came back is ANOTHER selector's row.
      if (templateDraft) return { document: templateDraft, version };
    }

    return { document: await this.getPublished(selector, themeKey), version };
  },

  /**
   * @param baseVersion the revision the caller read, for optimistic concurrency.
   *   `undefined` skips the check — every INTERNAL caller (theme install, revert,
   *   tests) takes that path. `null` asserts "there was no row when I read".
   */
  async saveDraft(
    selector: LayoutSelector,
    raw: unknown,
    userId: string,
    baseVersion: string | null | undefined,
    themeKey: ThemeKey,
  ): Promise<LayoutDraftResponse> {
    assertTemplateKnown(selector.templateKey);
    assertVariantAllowed(selector);
    const parsed = layoutDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new XentiumError({
        code: XEC.API_VALIDATION, httpStatus: 422,
        message: `Invalid layout document: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      });
    }
    if (parsed.data.templateKey !== selector.templateKey) {
      throw new XentiumError({
        code: XEC.API_VALIDATION, httpStatus: 422,
        message: `Document is for "${parsed.data.templateKey}", not "${selector.templateKey}".`,
      });
    }
    // An editor still open from before home lost its `aside` may send one: carry it
    // into the right rail rather than refusing the save.
    const doc = foldHomeAside(parsed.data);
    assertRegionsValid(doc);

    await writeDraftRow(selector, doc, doc.schemaVersion, userId, baseVersion, themeKey);
    return { document: doc, version: await draftVersion(selector, themeKey) };
  },

  // ── Site frame ────────────────────────────────────────────────────────────

  /** One theme's live frame. */
  async getPublishedFrame(themeKey: ThemeKey): Promise<SiteFrame> {
    return liveFrame(themeKey);
  },

  /** What the editor loads: the draft, else what is live, plus what the theme ships. */
  async getFrameDraft(themeKey: ThemeKey): Promise<FrameDraftResponse> {
    const [draft, live, theme, version, themeName] = await Promise.all([
      loadFrame("draft", themeKey), liveFrame(themeKey), shippedFrame(themeKey),
      draftVersion(FRAME_SELECTOR, themeKey), themeNameOf(themeKey),
    ]);
    return { frame: draft ?? live, version, theme, themeName };
  },

  /** Autosave target for the popover. Same concurrency rule as a layout draft. */
  async saveFrameDraft(
    raw: unknown, userId: string, baseVersion: string | null | undefined, themeKey: ThemeKey,
  ): Promise<FrameDraftResponse> {
    const parsed = siteFrameSchema.safeParse(raw);
    if (!parsed.success) {
      throw new XentiumError({
        code: XEC.API_VALIDATION, httpStatus: 422,
        message: `Invalid site frame: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      });
    }
    await writeDraftRow(FRAME_SELECTOR, parsed.data, LAYOUT_SCHEMA_VERSION, userId, baseVersion, themeKey);
    return this.getFrameDraft(themeKey);
  },

  /**
   * Back to what the theme ships — or, with no theme frame, to full width — as a
   * DRAFT, so it is previewed and published like every other change.
   */
  async revertFrameToTheme(userId: string, themeKey: ThemeKey): Promise<FrameDraftResponse> {
    await writeFrameRows((await shippedFrame(themeKey)) ?? DEFAULT_SITE_FRAME, ["draft"], userId, themeKey);
    return this.getFrameDraft(themeKey);
  },

  /** Which (template, variant) pairs of one theme have a draft differing from live. */
  async getDraftStatus(themeKey: ThemeKey): Promise<{ pending: LayoutSelector[] }> {
    const [drafts, live] = await Promise.all([loadScope("draft", themeKey), published(themeKey)]);
    const pending: LayoutSelector[] = [];
    for (const [key, draft] of drafts) {
      const sep = key.indexOf(SEP);
      const templateKey = key.slice(0, sep) as TemplateKey;
      const variant = key.slice(sep + 1);
      // Compared against what this selector would actually RESOLVE to, so a draft
      // equal to the inherited document is correctly reported as no change.
      const current = await resolve(live.map, { templateKey, variant }, themeKey);
      if (!same(draft, current)) pending.push({ templateKey, variant });
    }
    // The frame publishes with the layouts — one Publish in the editor.
    const frameDraft = await loadFrame("draft", themeKey);
    if (frameDraft && !sameFrame(frameDraft, await liveFrame(themeKey))) pending.push(FRAME_SELECTOR);
    return { pending };
  },

  /**
   * Promote every pending draft of one theme to published, then clear those drafts.
   * Site-wide within the theme, matching the appearance publish.
   */
  async publish(userId: string, themeKey: ThemeKey): Promise<{ published: LayoutSelector[] }> {
    const { pending } = await this.getDraftStatus(themeKey);
    if (pending.length === 0) return { published: [] };

    const [drafts, frameDraft] = await Promise.all([loadScope("draft", themeKey), loadFrame("draft", themeKey)]);
    await prisma.$transaction(async (tx) => {
      for (const selector of pending) {
        // The frame rides the same promotion; it is simply not a layout document.
        const isFrame = selector.templateKey === SITE_FRAME_ROW_KEY;
        const doc: object | undefined = isFrame
          ? frameDraft ?? undefined
          : drafts.get(cacheKey(selector.templateKey, selector.variant));
        if (!doc) continue;
        const schemaVersion = isFrame ? LAYOUT_SCHEMA_VERSION : (doc as LayoutDocument).schemaVersion;
        await tx.layout.upsert({
          where:  rowKey(themeKey, selector.templateKey, selector.variant, "published"),
          update: { document: doc, schemaVersion, updatedById: userId },
          create: {
            themeKey, templateKey: selector.templateKey, variant: selector.variant, scope: "published",
            document: doc, schemaVersion, updatedById: userId,
          },
        });
        await tx.layout.deleteMany({
          where: { themeKey, templateKey: selector.templateKey, variant: selector.variant, scope: "draft" },
        });
      }
    });

    publishedMemo.delete(themeKey);
    // The style version is the channel every open tab already listens to.
    await appearanceService.bumpStyleVersion();
    return { published: pending };
  },

  /**
   * Back to inherited: delete both rows for this selector. A page variant then
   * follows the template default; a template default follows what the theme ships
   * (or, for Core, the code default).
   */
  async reset(selector: LayoutSelector, themeKey: ThemeKey): Promise<void> {
    assertVariantAllowed(selector);
    await prisma.layout.deleteMany({
      where: { themeKey, templateKey: selector.templateKey, variant: selector.variant },
    });
    publishedMemo.delete(themeKey);
    await appearanceService.bumpStyleVersion();
  },

  /** Discard the draft only, keeping what is live. */
  async discardDraft(selector: LayoutSelector, themeKey: ThemeKey): Promise<void> {
    assertVariantAllowed(selector);
    await prisma.layout.deleteMany({
      where: { themeKey, templateKey: selector.templateKey, variant: selector.variant, scope: "draft" },
    });
  },

  // ── What the theme ships (inheritance) ────────────────────────────────────

  /** One theme's shipped documents, per template. Core ships none. */
  async getThemeLayer(themeKey: ThemeKey): Promise<Partial<Record<string, LayoutDocument>>> {
    return shippedDocs(themeKey);
  },

  /**
   * Per template: has the admin moved this theme's document away from what the theme
   * ships (or, where it ships nothing, from the code default)? `current` is the draft
   * if there is one, else what is published.
   */
  async getOwnership(themeKey: ThemeKey): Promise<Record<string, { customised: boolean; hasTheme: boolean }>> {
    const [drafts, live, shipped] = await Promise.all([
      loadScope("draft", themeKey), published(themeKey), shippedDocs(themeKey),
    ]);
    const out: Record<string, { customised: boolean; hasTheme: boolean }> = {};
    for (const key of templateKeys()) {
      const current = drafts.get(cacheKey(key, DEFAULT_VARIANT))
        ?? live.map.get(cacheKey(key, DEFAULT_VARIANT))
        ?? null;
      const baseline = shipped[key] ?? codeDefault(key);
      out[key] = {
        // Nothing stored means the baseline is rendering, which is never a customisation.
        customised: current !== null && !same(current, baseline),
        hasTheme:   !!shipped[key],
      };
    }
    return out;
  },

  /** Whether the admin moved this theme's frame away from what it ships (or full width). */
  async isFrameCustomised(themeKey: ThemeKey): Promise<boolean> {
    const [draft, live, shipped] = await Promise.all([
      loadFrame("draft", themeKey), loadFrame("published", themeKey), shippedFrame(themeKey),
    ]);
    const current = draft ?? live;
    return current !== null && !sameFrame(current, shipped ?? DEFAULT_SITE_FRAME);
  },

  /**
   * Put a template back to what the theme ships, as a DRAFT — previewed and published
   * like every other layout change. Null when the theme ships nothing for it.
   */
  async revertToTheme(templateKey: TemplateKey, userId: string, themeKey: ThemeKey): Promise<LayoutDocument | null> {
    const doc = (await shippedDocs(themeKey))[templateKey];
    if (!doc) return null;
    const saved = await this.saveDraft({ templateKey, variant: DEFAULT_VARIANT }, doc, userId, undefined, themeKey);
    return saved.document;
  },

  /**
   * Before a theme's package is REPLACED by an update: forget the rows that are still
   * exactly what the old version shipped, so the new version shows through, and keep
   * the ones the admin changed. Must run against the OLD package.
   *
   * @returns which templates were kept as customised.
   */
  async releaseUntouched(themeKey: ThemeKey): Promise<{ kept: string[]; frameKept: boolean }> {
    const ownership = await this.getOwnership(themeKey);
    const kept: string[] = [];
    for (const [key, { customised }] of Object.entries(ownership)) {
      if (customised) { kept.push(key); continue; }
      await prisma.layout.deleteMany({ where: { themeKey, templateKey: key, variant: DEFAULT_VARIANT } });
    }
    const frameKept = await this.isFrameCustomised(themeKey);
    if (!frameKept) {
      await prisma.layout.deleteMany({ where: { themeKey, templateKey: SITE_FRAME_ROW_KEY } });
    }
    publishedMemo.delete(themeKey);
    return { kept, frameKept };
  },

  /** Variant keys that carry their own stored document, for the editor's picker. */
  async listVariants(templateKey: TemplateKey, themeKey: ThemeKey): Promise<{ variant: string; scope: Scope }[]> {
    const rows = await prisma.layout.findMany({
      where: { themeKey, templateKey, NOT: { variant: DEFAULT_VARIANT } },
      select: { variant: true, scope: true },
      orderBy: { variant: "asc" },
    });
    return rows.map((r) => ({ variant: r.variant, scope: r.scope as Scope }));
  },

  /**
   * Test seam + used by plugin enable/disable. Also drops the parsed code defaults:
   * a plugin's default document is only as stable as the plugin.
   */
  bustCache() {
    publishedMemo.clear();
    defaultCache = new Map();
  },

  /** Every row of one theme, raw, for an update's undo point. */
  async snapshotTheme(themeKey: ThemeKey): Promise<LayoutRowSnapshot[]> {
    const rows = await prisma.layout.findMany({
      where:  { themeKey },
      select: { templateKey: true, variant: true, scope: true, document: true },
    });
    return rows.map((r) => ({ ...r, document: r.document as unknown }));
  },

  /** Put one theme's rows back exactly as captured. Deletes first, so nothing created since survives. */
  async restoreTheme(snapshot: LayoutRowSnapshot[], userId: string, themeKey: ThemeKey): Promise<void> {
    await prisma.$transaction([
      prisma.layout.deleteMany({ where: { themeKey } }),
      ...snapshot.map((row) => prisma.layout.create({
        data: {
          themeKey,
          templateKey: row.templateKey,
          variant:     row.variant,
          scope:       row.scope,
          document:    row.document as object,
          updatedById: userId,
        },
      })),
    ]);
    publishedMemo.delete(themeKey);
  },

  /** One theme's PUBLISHED rows (site frame included), raw — what a Studio revision keeps. */
  async snapshotPublished(themeKey: ThemeKey): Promise<PublishedRowSnapshot[]> {
    const rows = await prisma.layout.findMany({
      where:  { themeKey, scope: "published" },
      select: { templateKey: true, variant: true, document: true, schemaVersion: true },
    });
    return rows.map((r) => ({ ...r, document: r.document as unknown }));
  },

  /**
   * Stage a revision's layouts as the theme's DRAFT, to be reviewed and published.
   *
   * Every selector the theme has a row for now, or had then, gets a draft: the
   * revision's document where it had one, and otherwise the baseline (what the theme
   * ships, else the code default; for the frame, the theme's frame else full width) —
   * a template that was inherited then is inherited again once this publishes.
   */
  async stageSnapshot(rows: PublishedRowSnapshot[], userId: string, themeKey: ThemeKey): Promise<void> {
    const key = (t: string, v: string) => `${t}\u0000${v}`;
    const wanted = new Map(rows.map((r) => [key(r.templateKey, r.variant), r]));
    const now = await prisma.layout.findMany({ where: { themeKey }, select: { templateKey: true, variant: true } });
    for (const r of now) {
      const k = key(r.templateKey, r.variant);
      if (wanted.has(k)) continue;
      const selector = { templateKey: r.templateKey as TemplateKey, variant: r.variant };
      if (r.templateKey === SITE_FRAME_ROW_KEY) {
        wanted.set(k, { ...selector, document: (await shippedFrame(themeKey)) ?? DEFAULT_SITE_FRAME, schemaVersion: LAYOUT_SCHEMA_VERSION });
      } else if (isKnownTemplate(r.templateKey as TemplateKey)) {
        const doc = await baselineFor(themeKey, selector.templateKey);
        wanted.set(k, { ...selector, document: doc, schemaVersion: doc.schemaVersion });
      }
      // A disabled plugin's template: left exactly as it is.
    }
    for (const r of wanted.values()) {
      await writeDraftRow(
        { templateKey: r.templateKey as TemplateKey, variant: r.variant },
        r.document as object, r.schemaVersion, userId, undefined, themeKey,
      );
    }
  },

  /** Everything stored for one theme, for uninstall. */
  async forgetTheme(themeKey: ThemeKey): Promise<void> {
    if (!themeKey) return; // Core cannot be uninstalled
    await prisma.layout.deleteMany({ where: { themeKey } });
    bustThemeLayouts(themeKey);
  },

  SCHEMA_VERSION: LAYOUT_SCHEMA_VERSION,
};

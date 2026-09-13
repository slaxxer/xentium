/**
 * Layout documents (ADR-0005).
 *
 * Structure per template, stored as data. Two scopes: `draft` (what the ACP
 * editor writes) and `published` (what the site serves). Deliberately mirrors
 * the appearance draft→publish model — one staging concept for the whole
 * Appearance area, not two.
 *
 * Absence is a valid, expected state. A template with no row renders
 * DEFAULT_LAYOUTS from @xentium/contracts, so a fresh install, a failed
 * validation and a reset all converge on the same renderable page.
 *
 * ## Variants
 *
 * A row is identified by (templateKey, variant, scope). `variant` is `''` for the
 * template default and a key — a page slug, for `page.detail` — for one instance's
 * own arrangement. Resolution is exactly two steps: the variant row, then the
 * default row, then the code default. No cascade, no hierarchy to reason about.
 */
import {
  DEFAULT_VARIANT,
  LAYOUT_SCHEMA_VERSION,
  defaultLayoutFor,
  isKnownTemplate,
  layoutDocumentSchema,
  missingRequiredBlocks,
  parseLayoutDocument,
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
import { NEC } from "../../shared/errors/nec.js";
import { memoTtl } from "../../shared/utils/memoTtl.js";
import { appearanceService } from "../appearance/appearance.service.js";

/**
 * `theme` is the INHERITANCE layer: what an imported `.nvtheme` shipped for a template.
 *
 * It is deliberately NOT in the render path — resolution stays exactly two steps
 * (variant → template default → code default), which is the rule ADR-0005 exists to
 * protect. The theme row is a BASELINE: it says what the admin's document started as, so
 * an update can tell "untouched, safe to replace" from "customised, must keep", and so
 * "Revert to theme" has something to revert to.
 */
type Scope = "draft" | "published" | "theme";

/** Separator for the composite map key: a NUL can never appear in either half. */
const SEP = "\u0000";

/** Every stored document for a scope, keyed `templateKey` + NUL + `variant`. */
type ScopeMap = Map<string, LayoutDocument>;

const cacheKey = (templateKey: string, variant: string) => `${templateKey}${SEP}${variant}`;

/** Published documents are read on nearly every page render. */
const publishedMemo = memoTtl(async () => loadScope("published"), 30_000);

/**
 * Parsed documents per installed theme, for visitors wearing one.
 *
 * Keyed by theme id and never expired, for the same reason the themed stylesheet is:
 * a theme's payload is immutable once installed. Cleared when a theme is installed
 * or removed.
 */
const themeLayoutMemo = new Map<string, Record<string, LayoutDocument>>();

/** Forget a theme's parsed documents — call when its row changes or goes away. */
export function bustThemeLayouts(themeId?: string): void {
  if (themeId) themeLayoutMemo.delete(themeId);
  else themeLayoutMemo.clear();
}

async function loadScope(scope: Scope): Promise<ScopeMap> {
  const rows = await prisma.layout.findMany({ where: { scope } });
  const out: ScopeMap = new Map();
  for (const row of rows) {
    const key = row.templateKey as TemplateKey;
    // A retired core key, or a template whose plugin is currently disabled. Ignored
    // rather than crashed on — and, crucially, the ROW is left alone: turning a
    // plugin off must never be what deletes an admin's arrangement of its pages.
    if (!isKnownTemplate(key)) continue;
    const { document, usedDefault } = parseLayoutDocument(key, row.document);
    // A stored document that no longer validates is a bug or a downgrade. Serving
    // the default is the right answer; silently persisting the broken one is not.
    if (!usedDefault) out.set(cacheKey(key, row.variant), document);
  }
  return out;
}

/**
 * The code default, run through the SAME parse a stored row gets.
 *
 * ⚠ Not `DEFAULT_LAYOUTS[key]` directly. Zod emits object keys in schema order, so a
 * parsed document has `children` before `visibility` while the literal default in
 * contracts has them the other way round — identical documents, different
 * `JSON.stringify`. Every comparison in this file is a stringify (pending status,
 * theme-update ownership), so an untouched `home` compared unequal to its own default:
 * the draft chip said "pending publish" forever, and a theme update would have treated
 * the template as customised and refused to update it. Normalising both sides through
 * one function is the fix; cached because `resolve` runs on every page render.
 *
 * ⚠ Keyed by template AND invalidated by `bustCache`, because a plugin template's
 * default arrives with the plugin: caching one forever would serve a stale default
 * after a plugin update changed it.
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

/** The published document for a selector, variant → default → code default. */
function resolve(map: ScopeMap, { templateKey, variant }: LayoutSelector): LayoutDocument {
  if (variant !== DEFAULT_VARIANT) {
    const own = map.get(cacheKey(templateKey, variant));
    if (own) return own;
  }
  return map.get(cacheKey(templateKey, DEFAULT_VARIANT)) ?? codeDefault(templateKey);
}

/**
 * This selector's OWN draft revision, or `null` when it has no row.
 *
 * Deliberately not read out of the cached scope map: that holds documents, and a
 * concurrency token has to come from the row itself.
 */
async function draftVersion(selector: LayoutSelector): Promise<string | null> {
  const row = await prisma.layout.findUnique({
    where: {
      templateKey_variant_scope: {
        templateKey: selector.templateKey, variant: selector.variant, scope: "draft",
      },
    },
    select: { updatedAt: true },
  });
  return row ? row.updatedAt.toISOString() : null;
}

/** Prisma's unique-constraint violation, without importing the whole error namespace. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * Somebody else wrote this selector first.
 *
 * Carries the CURRENT revision so the client can offer "keep mine" as a deliberate
 * overwrite without a second round trip — and `persist: false`, because two admins
 * on one page is an expected outcome of a shared editor, not a fault worth a row in
 * the error log every time an autosave loses a race.
 */
async function staleWrite(selector: LayoutSelector): Promise<XentiumError> {
  return new XentiumError({
    code: NEC.API_CONFLICT,
    httpStatus: 409,
    message: "This layout changed since you opened it.",
    details: { version: await draftVersion(selector) },
    persist: false,
  });
}

/**
 * Reject a template nothing has registered.
 *
 * Reading tolerates an unknown key (it renders the code default, which is empty);
 * WRITING must not, or a typo — or a request naming a plugin that is disabled —
 * stores a row no page will ever read and reports success.
 */
function assertTemplateKnown(templateKey: TemplateKey) {
  if (!isKnownTemplate(templateKey)) {
    throw new XentiumError({
      code: NEC.API_VALIDATION, httpStatus: 422,
      message: `Unknown template "${templateKey}". A plugin template needs its plugin enabled.`,
    });
  }
}

/** Reject a variant on a template that has no instances to vary. */
function assertVariantAllowed({ templateKey, variant }: LayoutSelector) {
  if (variant === DEFAULT_VARIANT) return;
  if (!templateAcceptsVariants(templateKey)) {
    throw new XentiumError({
      code: NEC.API_VALIDATION, httpStatus: 422,
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
      code: NEC.API_VALIDATION, httpStatus: 422,
      message: `Unknown region(s) for "${doc.templateKey}": ${unknown.join(", ")}`,
    });
  }
  // Structural rules the document SHAPE cannot express: nesting depth, duplicate
  // ids, children on a block that cannot hold them, a `column` outside its row, and
  // an audience on a block the template requires. The editor cannot produce any of
  // these — the check exists because a `.nvtheme` import is a second way into this
  // table, and an unbounded document is a render bomb rather than a layout.
  const treeProblems = validateBlockTree(doc.regions, {
    requiredTypes: requiredBlocksFor(doc.templateKey),
  });
  if (treeProblems.length > 0) {
    throw new XentiumError({
      code: NEC.API_VALIDATION, httpStatus: 422,
      message: `Invalid block tree in "${doc.templateKey}": ${treeProblems.join(" ")}`,
    });
  }
  // Chrome renders on every page, so a header with no way into the site and no
  // way to sign in is a locked door. Required blocks may move between regions;
  // they may not disappear. Enforced here as well as in the editor, because a
  // .nvtheme import is another way in.
  const missing = missingRequiredBlocks(doc.templateKey, doc);
  if (missing.length > 0) {
    throw new XentiumError({
      code: NEC.API_VALIDATION, httpStatus: 422,
      message: `"${doc.templateKey}" cannot be saved without: ${missing.join(", ")}`,
    });
  }
}

/** What the public endpoint serves: template defaults plus the variants that exist. */
export interface PublishedLayouts {
  /** Keyed by template — core's eight plus whatever enabled plugins registered. */
  templates: Record<string, LayoutDocument>;
  /**
   * Only variants that are actually stored, so a site with no per-page layouts pays
   * nothing. ⚠ This grows with the number of overridden pages; a site that gives
   * hundreds of pages their own layout would want this fetched per page instead.
   */
  variants: Partial<Record<string, Record<string, LayoutDocument>>>;
}

function toPublished(map: ScopeMap): PublishedLayouts {
  const templates: Record<string, LayoutDocument> = {};
  // Registered templates only. A document stored for a disabled plugin's template is
  // not served — the page it belongs to does not exist right now — but it is still
  // in the table, waiting for the plugin to come back.
  for (const key of templateKeys()) {
    templates[key] = map.get(cacheKey(key, DEFAULT_VARIANT)) ?? codeDefault(key);
  }

  const variants: PublishedLayouts["variants"] = {};
  for (const [key, doc] of map) {
    const sep = key.indexOf(SEP);
    const templateKey = key.slice(0, sep) as TemplateKey;
    const variant = key.slice(sep + 1);
    if (variant === DEFAULT_VARIANT) continue;
    (variants[templateKey] ??= {})[variant] = doc;
  }
  return { templates, variants };
}

export const layoutService = {
  /** Every published document, defaults filled in. The shape the frontend consumes. */
  async getPublishedAll(): Promise<PublishedLayouts> {
    return toPublished(await publishedMemo());
  },

  /**
   * The same, as a VISITOR wearing one of the installed themes would see it.
   *
   * The theme's own documents where it ships one, the site's published document
   * everywhere else. A theme rarely ships all eight templates — `meadow` ships only
   * `home` — and the alternative to falling back would be a visitor whose profile
   * page is the bare code default because the theme had no opinion about it.
   *
   * ⚠ The theme's documents replace the site's; they are NOT merged with them. The
   * admin's arrangement was built on the ACTIVE theme, and a per-template mix of two
   * themes' layouts is an arrangement nobody designed. Whoever wears the site's own
   * theme still gets the admin's work, which is the case that matters.
   *
   * ⚠ Returns the plain published set for an id naming nothing installed — a cookie
   * outlives an uninstall.
   */
  async getPublishedAllForTheme(themeId: string): Promise<PublishedLayouts> {
    const site = await this.getPublishedAll();

    const cached = themeLayoutMemo.get(themeId);
    if (cached) return { ...site, templates: { ...site.templates, ...cached } };

    const row = await prisma.theme.findUnique({
      where: { id: themeId }, select: { payload: true },
    });
    const documents = (row?.payload as { documents?: Record<string, unknown> } | null)?.documents;
    if (!documents) return site;

    // Parsed through the same function every other document goes through: a payload
    // is data that arrived in a zip, and the render path must never be the first
    // thing to find out it is malformed.
    // ⚠ `usedDefault` means the document did not parse — and the CODE default is not
    // what this theme ships, so the template is dropped and the SITE's document is
    // used instead. Keeping the fallback would replace an admin's page with an empty
    // one on the strength of a theme's broken file.
    const parsed: Record<string, LayoutDocument> = {};
    for (const [key, doc] of Object.entries(documents)) {
      const { document, usedDefault } = parseLayoutDocument(key as TemplateKey, doc);
      if (!usedDefault) parsed[key] = document;
    }
    themeLayoutMemo.set(themeId, parsed);
    return { ...site, templates: { ...site.templates, ...parsed } };
  },

  /**
   * Every template as the DRAFT would render it. Backs the editor's preview
   * iframe, which loads the real routes so blocks get real context instead of
   * mock data — the preview is the actual page, not an approximation of it.
   */
  async getDraftAll(): Promise<PublishedLayouts> {
    const [drafts, published] = await Promise.all([loadScope("draft"), publishedMemo()]);
    // Draft wins per (template, variant); anything untouched falls through to live.
    const merged: ScopeMap = new Map(published);
    for (const [key, doc] of drafts) merged.set(key, doc);
    return toPublished(merged);
  },

  /** Published document for one selector — the resolution order in one place. */
  async getPublished(selector: LayoutSelector): Promise<LayoutDocument> {
    return resolve(await publishedMemo(), selector);
  },

  /**
   * What the editor loads: this selector's draft, falling back to what it would
   * resolve to live — so opening a variant an admin has never touched starts from
   * the template default rather than a blank page.
   */
  async getDraft(selector: LayoutSelector): Promise<LayoutDraftResponse> {
    assertVariantAllowed(selector);
    const [drafts, version] = await Promise.all([
      loadScope("draft"),
      draftVersion(selector),
    ]);

    const own = drafts.get(cacheKey(selector.templateKey, selector.variant));
    if (own) return { document: own, version };

    // An untouched variant inherits the DRAFT default, not the published one.
    // Otherwise an admin who edits the shared default and then switches the picker
    // to one page is shown the old live layout and starts from a version they have
    // already moved past. Falling back to published only happens when the template
    // default has no draft either.
    if (selector.variant !== DEFAULT_VARIANT) {
      const templateDraft = drafts.get(cacheKey(selector.templateKey, DEFAULT_VARIANT));
      // `version` stays null: what came back is ANOTHER selector's row. Claiming its
      // revision would let a save built on the template default overwrite a variant
      // row a second tab created in the meantime.
      if (templateDraft) return { document: templateDraft, version };
    }

    return { document: resolve(await publishedMemo(), selector), version };
  },

  /**
   * @param baseVersion the revision the caller read, for optimistic concurrency.
   *   `undefined` skips the check entirely — that is the path every INTERNAL caller
   *   takes (theme import, revert-to-theme, tests), none of which is racing an admin.
   *   `null` asserts "there was no row when I read", which a second tab creating one
   *   must invalidate.
   */
  async saveDraft(
    selector: LayoutSelector,
    raw: unknown,
    userId: string,
    baseVersion?: string | null,
  ): Promise<LayoutDraftResponse> {
    assertTemplateKnown(selector.templateKey);
    assertVariantAllowed(selector);
    const parsed = layoutDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new XentiumError({
        code: NEC.API_VALIDATION, httpStatus: 422,
        message: `Invalid layout document: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      });
    }
    if (parsed.data.templateKey !== selector.templateKey) {
      throw new XentiumError({
        code: NEC.API_VALIDATION, httpStatus: 422,
        message: `Document is for "${parsed.data.templateKey}", not "${selector.templateKey}".`,
      });
    }
    assertRegionsValid(parsed.data);

    const key = {
      templateKey: selector.templateKey, variant: selector.variant, scope: "draft",
    };
    const where = { templateKey_variant_scope: key };
    const data = {
      document: parsed.data as object,
      schemaVersion: parsed.data.schemaVersion,
      updatedById: userId,
    };

    if (baseVersion === undefined) {
      // Unconditional: the caller is not competing with anyone.
      await prisma.layout.upsert({ where, update: data, create: { ...key, ...data } });
    } else if (baseVersion === null) {
      // "There was no row when I read." The unique index is what decides — checking
      // for absence first and then creating is the race this exists to close.
      try {
        await prisma.layout.create({ data: { ...key, ...data } });
      } catch (e) {
        if (isUniqueViolation(e)) throw await staleWrite(selector);
        throw e;
      }
    } else {
      // Conditional on the revision, so the read and the write cannot be split.
      const { count } = await prisma.layout.updateMany({
        where: { ...key, updatedAt: new Date(baseVersion) },
        data,
      });
      if (count === 0) throw await staleWrite(selector);
    }

    return { document: parsed.data, version: await draftVersion(selector) };
  },

  /** Which (template, variant) pairs have a draft differing from what is live. */
  async getDraftStatus(): Promise<{ pending: LayoutSelector[] }> {
    const [drafts, published] = await Promise.all([loadScope("draft"), publishedMemo()]);
    const pending: LayoutSelector[] = [];
    for (const [key, draft] of drafts) {
      const sep = key.indexOf(SEP);
      const templateKey = key.slice(0, sep) as TemplateKey;
      const variant = key.slice(sep + 1);
      // Compared against what this selector would actually RESOLVE to, so a variant
      // draft equal to the inherited default is correctly reported as no change.
      const live = resolve(published, { templateKey, variant });
      if (JSON.stringify(draft) !== JSON.stringify(live)) pending.push({ templateKey, variant });
    }
    return { pending };
  },

  /**
   * Promote every pending draft to published, then clear the drafts so they
   * mirror live again. Site-wide rather than per-template, matching the
   * appearance publish job — one "publish" verb in the Appearance area.
   */
  async publish(userId: string): Promise<{ published: LayoutSelector[] }> {
    const { pending } = await this.getDraftStatus();
    if (pending.length === 0) return { published: [] };

    const drafts = await loadScope("draft");
    await prisma.$transaction(async (tx) => {
      for (const selector of pending) {
        const doc = drafts.get(cacheKey(selector.templateKey, selector.variant));
        if (!doc) continue;
        const where = {
          templateKey_variant_scope: {
            templateKey: selector.templateKey, variant: selector.variant, scope: "published",
          },
        };
        await tx.layout.upsert({
          where,
          update: { document: doc as object, schemaVersion: doc.schemaVersion, updatedById: userId },
          create: {
            templateKey: selector.templateKey, variant: selector.variant, scope: "published",
            document: doc as object, schemaVersion: doc.schemaVersion, updatedById: userId,
          },
        });
        await tx.layout.deleteMany({
          where: { templateKey: selector.templateKey, variant: selector.variant, scope: "draft" },
        });
      }
    });

    publishedMemo.bust();
    // Reuse the style version: connected clients already listen for it over SSE,
    // so a layout change reaches every open tab through the existing channel
    // instead of a second push mechanism.
    await appearanceService.bumpStyleVersion();
    return { published: pending };
  },

  /**
   * Back to inherited: delete both rows for this selector.
   *
   * For a variant that means the page falls back to the template default, which is
   * the useful meaning of "reset" for one page. For the default itself it means the
   * code default, as before.
   */
  async reset(selector: LayoutSelector): Promise<void> {
    assertVariantAllowed(selector);
    await prisma.layout.deleteMany({
      where: {
        templateKey: selector.templateKey, variant: selector.variant,
        // NOT the theme row. Deleting the baseline would both lose the revert target and
        // make the next theme update read every template as untouched — so an admin who
        // reset one template would silently have all their others overwritten.
        scope: { in: ["draft", "published"] },
      },
    });
    publishedMemo.bust();
    await appearanceService.bumpStyleVersion();
  },

  /** Discard the draft only, keeping what is live. */
  async discardDraft(selector: LayoutSelector): Promise<void> {
    assertVariantAllowed(selector);
    await prisma.layout.deleteMany({
      where: { templateKey: selector.templateKey, variant: selector.variant, scope: "draft" },
    });
  },

  // ── Theme layer (inheritance) ─────────────────────────────────────────────

  /** What the installed theme ships per template. Template defaults only. */
  async getThemeLayer(): Promise<Partial<Record<string, LayoutDocument>>> {
    const map = await loadScope("theme");
    const out: Partial<Record<string, LayoutDocument>> = {};
    for (const key of templateKeys()) {
      const doc = map.get(cacheKey(key, DEFAULT_VARIANT));
      if (doc) out[key] = doc;
    }
    return out;
  },

  /** Record what the theme ships for a template. Called by import, nothing else. */
  async saveThemeLayer(templateKey: TemplateKey, doc: LayoutDocument, userId: string): Promise<void> {
    const where = {
      templateKey_variant_scope: { templateKey, variant: DEFAULT_VARIANT, scope: "theme" },
    };
    await prisma.layout.upsert({
      where,
      update: { document: doc as object, schemaVersion: doc.schemaVersion, updatedById: userId },
      create: {
        templateKey, variant: DEFAULT_VARIANT, scope: "theme",
        document: doc as object, schemaVersion: doc.schemaVersion, updatedById: userId,
      },
    });
  },

  /**
   * Whether the admin has moved away from what they started with, per template.
   *
   * The baseline is the THEME's document when one is installed, and the code default
   * otherwise — so on a fresh site an untouched template reads as untouched, and a
   * hand-built one reads as customised even though no theme has ever been imported.
   *
   * `current` is the draft if there is one, else what is published: the draft is where
   * the editor writes, but an admin who customised and published has no draft left.
   */
  async getOwnership(): Promise<Record<string, { customised: boolean; hasTheme: boolean }>> {
    const [drafts, published, themeLayer] = await Promise.all([
      loadScope("draft"), publishedMemo(), this.getThemeLayer(),
    ]);
    const out: Record<string, { customised: boolean; hasTheme: boolean }> = {};
    for (const key of templateKeys()) {
      const current = drafts.get(cacheKey(key, DEFAULT_VARIANT))
        ?? published.get(cacheKey(key, DEFAULT_VARIANT))
        ?? null;
      const baseline = themeLayer[key] ?? codeDefault(key);
      out[key] = {
        // Nothing stored means the code default is rendering, which is never a
        // customisation — not even when a theme is installed, since the theme's own
        // import would have written a row.
        customised: current !== null && JSON.stringify(current) !== JSON.stringify(baseline),
        hasTheme:   !!themeLayer[key],
      };
    }
    return out;
  },

  /**
   * Put a template back to what the theme ships, as a DRAFT.
   *
   * The counterpart to `reset` rather than a replacement for it: reset means the code
   * default, this means the theme's. Both exist because with a theme installed those are
   * two different documents and an admin needs to be able to ask for either. Lands in the
   * draft so a revert is previewed and published like every other layout change.
   */
  async revertToTheme(templateKey: TemplateKey, userId: string): Promise<LayoutDocument | null> {
    const themeLayer = await this.getThemeLayer();
    const doc = themeLayer[templateKey];
    if (!doc) return null;
    // No baseVersion: reverting is a deliberate replacement of whatever is there.
    const saved = await this.saveDraft({ templateKey, variant: DEFAULT_VARIANT }, doc, userId);
    return saved.document;
  },

  /** Variant keys that carry their own stored document, for the editor's picker. */
  async listVariants(templateKey: TemplateKey): Promise<{ variant: string; scope: Scope }[]> {
    const rows = await prisma.layout.findMany({
      where: { templateKey, NOT: { variant: DEFAULT_VARIANT } },
      select: { variant: true, scope: true },
      orderBy: { variant: "asc" },
    });
    // Theme rows are template defaults, so `NOT: { variant: DEFAULT_VARIANT }` has
    // already excluded them.
    return rows.map((r) => ({ variant: r.variant, scope: r.scope as Scope }));
  },

  /**
   * Test seam + used by publish/reset and by plugin enable/disable.
   *
   * Also drops the parsed code defaults, because a plugin's default document is only
   * as stable as the plugin: an update that changes it would otherwise keep serving
   * the version that was registered when the process started.
   */
  bustCache() {
    publishedMemo.bust();
    defaultCache = new Map();
  },

  /**
   * Put a theme's document for one template ON — published AND draft together.
   *
   * ⚠ Both scopes, deliberately. `published` is what visitors get, so writing only
   * that would leave the Layout Editor still showing the previous theme's
   * arrangement as a pending draft — an edit the admin never made, which they would
   * then publish over the top. And a draft row that merely EQUALS the published one
   * is not pending (`getDraftStatus` compares them), so this leaves nothing spurious
   * waiting to be published.
   */
  async applyThemeDocument(templateKey: TemplateKey, doc: LayoutDocument, userId: string): Promise<void> {
    const row = { document: doc as object, schemaVersion: doc.schemaVersion, updatedById: userId };
    await prisma.$transaction(["published", "draft"].map((scope) => prisma.layout.upsert({
      where:  { templateKey_variant_scope: { templateKey, variant: DEFAULT_VARIANT, scope } },
      update: row,
      create: { templateKey, variant: DEFAULT_VARIANT, scope, ...row },
    })));
    publishedMemo.bust();
  },

  /**
   * Every stored row for the scopes a theme import touches, as raw JSON.
   *
   * Raw and unparsed on purpose: this is a SNAPSHOT to be put back byte for byte,
   * not something to render. Parsing here would silently normalise a document, and
   * a restore that "fixes" what it restores is not a restore.
   *
   * ⚠ `published` IS included, and has to be. It used to be excluded on the grounds
   * that an import never wrote it — true while activating a theme only staged. Now
   * that activation goes LIVE, an undo that skipped `published` would leave visitors
   * on the theme the admin just rejected, which is the one thing undo exists to
   * prevent.
   */
  async snapshotStagedScopes(): Promise<LayoutRowSnapshot[]> {
    const rows = await prisma.layout.findMany({
      where:  { scope: { in: ["draft", "theme", "published"] } },
      select: { templateKey: true, variant: true, scope: true, document: true },
    });
    return rows.map((r) => ({
      templateKey: r.templateKey,
      variant:     r.variant,
      scope:       r.scope as Scope,
      document:    r.document as unknown,
    }));
  },

  /**
   * Put those scopes back exactly as the snapshot found them.
   *
   * ⚠ It DELETES first. A restore that only wrote rows back would leave behind every
   * row the import created for a template that had none before — which is most of
   * them on a site that had never staged a layout, so "undo" would undo almost
   * nothing.
   */
  async restoreStagedScopes(snapshot: LayoutRowSnapshot[], userId: string): Promise<void> {
    await prisma.$transaction([
      prisma.layout.deleteMany({ where: { scope: { in: ["draft", "theme", "published"] } } }),
      ...snapshot.map((row) => prisma.layout.create({
        data: {
          templateKey: row.templateKey,
          variant:     row.variant,
          scope:       row.scope,
          document:    row.document as object,
          updatedById: userId,
        },
      })),
    ]);
    this.bustCache();
  },

  SCHEMA_VERSION: LAYOUT_SCHEMA_VERSION,
};

/** One `ncf_layouts` row, captured verbatim. */
export interface LayoutRowSnapshot {
  templateKey: string;
  variant:     string;
  scope:       Scope;
  document:    unknown;
}

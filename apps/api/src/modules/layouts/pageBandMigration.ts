/**
 * One-time carry-over of a page's own `header` / `footer` bands into its body.
 *
 * A page template used to declare four regions — a band above the body, the body, the
 * rail, a band below. The bands were the accretion the four-landmark set was supposed
 * to END: they sit inside `<main>`, so they are not the page's header and footer at
 * all (those are the site's, `chrome.header` / `chrome.footer`), every shipped default
 * left them EMPTY, and what they offered over a `section` at the top of the body was a
 * name — the wrong one, since an admin reading "Header" in a page's structure
 * reasonably concluded the site header had gone missing.
 *
 * Without this, a site that HAD put something in one of them keeps those blocks in the
 * document and simply stops rendering them: an undeclared region is kept and skipped
 * by design ("disabling a plugin must never delete an admin's layout"), so the loss
 * would be silent and permanent-looking.
 *
 * The same three properties as the migrations beside it:
 *
 *  - **Idempotent.** A flag records completion, so a restart is a no-op.
 *  - **Non-destructive.** Blocks MOVE, keeping ids, props, visibility, variants and
 *    children; nothing is dropped, and a document with empty bands (almost all of
 *    them) is left untouched rather than rewritten.
 *  - **Ordered.** A band above the body lands at the TOP of it and a band below at
 *    the BOTTOM, because that is where those blocks were on the page. Appending both
 *    would silently move an admin's intro under the article.
 */
import {
  isChromeTemplate,
  layoutDocumentSchema,
  regionsFor,
  type BlockNode,
  type LayoutDocument,
} from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache, getSetting } from "../../shared/utils/settings.js";
import { logger } from "../../infrastructure/logging/logger.js";

/** Set once the carry-over has been considered, whether or not it wrote anything. */
export const PAGE_BANDS_MERGED = "layout.pageBandsMerged";

/** The document with its bands folded into the body, or null when there is nothing
 *  to do — which is the normal case, since the shipped defaults ship them empty. */
export function migratePageBands(doc: LayoutDocument): LayoutDocument | null {
  const regions = doc.regions as Record<string, BlockNode[] | undefined>;
  const above = regions.header ?? [];
  const below = regions.footer ?? [];
  const declared = new Set(regionsFor(doc.templateKey));

  /**
   * Empty regions the template does not declare, dropped in the same pass.
   *
   * Not tidying for its own sake: "is this customised?" is a `JSON.stringify` against
   * the code default, so ONE stray empty key makes an untouched page read as
   * customised for ever — and a theme update then declines to touch it. The region
   * consolidation left exactly this behind (`beforeBody` / `afterBody` on
   * `article.detail`), and the bands would have left the same.
   *
   * ⚠ EMPTY only. An undeclared region holding blocks is an admin's work — from a
   * plugin whose template is not registered right now, say — and it is kept, which is
   * the rule that says disabling a plugin must never delete a layout.
   */
  const strays = Object.keys(regions).filter(
    (r) => !declared.has(r) && r !== "header" && r !== "footer" && !(regions[r] ?? []).length,
  );

  const hasBands = "header" in regions || "footer" in regions;
  if (!hasBands && !strays.length) return null;

  const rest: Record<string, BlockNode[] | undefined> = {};
  for (const [name, nodes] of Object.entries(regions)) {
    if (name === "header" || name === "footer" || strays.includes(name)) continue;
    rest[name] = nodes;
  }

  if (!above.length && !below.length) {
    return { ...doc, regions: rest as LayoutDocument["regions"] };
  }
  return {
    ...doc,
    regions: {
      ...rest,
      main: [...above, ...(regions.main ?? []), ...below],
    } as LayoutDocument["regions"],
  };
}

async function markDone(): Promise<void> {
  await prisma.setting.upsert({
    where:  { key: PAGE_BANDS_MERGED },
    update: { value: true },
    create: { key: PAGE_BANDS_MERGED, value: true },
  });
  bustSettingsCache(PAGE_BANDS_MERGED);
}

export async function migratePageBandsIntoBody(): Promise<void> {
  if (await getSetting<boolean>(PAGE_BANDS_MERGED, false)) return;

  // EVERY scope and every variant: a draft is work an admin is mid-way through, the
  // `theme` baseline is what "Revert to theme" restores, and a variant row is as much
  // a stored document as the template default.
  const rows = await prisma.layout.findMany({
    select: { id: true, templateKey: true, document: true },
  });

  let changed = 0;
  for (const row of rows) {
    // Chrome keeps its `header` / `footer` — those regions ARE the site's header and
    // footer, and they are the reason the page-level pair had to go.
    if (isChromeTemplate(row.templateKey)) continue;

    const parsed = layoutDocumentSchema.safeParse(row.document);
    if (!parsed.success) continue;   // a document we cannot read is not one we can fix

    const next = migratePageBands(parsed.data);
    if (!next) continue;

    await prisma.layout.update({
      where: { id: row.id },
      data:  { document: next as unknown as object },
    });
    changed++;
  }

  await markDone();
  if (changed) logger.info({ changed }, "Page bands folded into the body");
}

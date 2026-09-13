/**
 * One-time carry-over of the footer onto the `footer` BLOCK.
 *
 * The footer's own appearance — its background, the hairline above it, the content
 * column — used to be a hardcoded `<div class="nv-foot">` in `SiteFooter.tsx`, with
 * `chrome.footer` holding the four pieces as loose leaves. So an admin who clicked
 * the footer in the Layout Editor found the pieces and never the thing they sit on,
 * while the header had been one block for a release.
 *
 * The band is a block now, and it is a CONTAINER: the footer's pieces are painted ON
 * it, so they are its children. Existing documents therefore need their region
 * children moved INSIDE a band — a site whose footer is a stored document (any site
 * whose footer has ever been rearranged, plus every `.nvtheme` that shipped one)
 * would otherwise keep an unpaintable footer for ever.
 *
 * The same three properties as the migrations beside it:
 *
 *  - **Idempotent.** A flag records completion, so a restart is a no-op.
 *  - **Non-destructive.** Nothing is dropped or reordered: the region's children
 *    become the band's children, in order, with their props and their audiences.
 *  - **Silent when there is nothing to carry.** A footer that already has a band, an
 *    empty one, and a site with no stored footer at all all write no rows.
 */
import {
  MAX_BLOCK_DEPTH,
  layoutDocumentSchema,
  type BlockNode,
  type LayoutDocument,
} from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache, getSetting } from "../../shared/utils/settings.js";
import { logger } from "../../infrastructure/logging/logger.js";

/** Set once the carry-over has been considered, whether or not it wrote anything. */
export const FOOTER_BAND_MIGRATED = "layout.footerBandMigrated";

/**
 * The id the shipped default uses — the same reasoning as the header's `h-band`:
 * "has the admin customised this?" is a `JSON.stringify` against the code default,
 * so a migrated footer and a fresh one have to be the same document or an untouched
 * site reads as customised for ever after.
 */
const BAND_ID = "f-band";

/** How deep a subtree goes, counting the node itself as 1. */
function depthOf(node: BlockNode): number {
  const children = node.children ?? [];
  return children.length === 0 ? 1 : 1 + Math.max(...children.map(depthOf));
}

/** The document with its footer wrapped in a band, or null when there is nothing to do. */
export function migrateFooterBand(doc: LayoutDocument): LayoutDocument | null {
  const footer = doc.regions.footer;
  if (!footer?.length) return null;
  // Already on the new shape — including a footer with two bands, which is legal and
  // means the admin built the second one on purpose.
  if (footer.some((b) => b.type === "footer")) return null;

  // Wrapping adds a level. Nothing anyone has built comes near the limit (the
  // deepest footer piece is a leaf), but a document that WOULD exceed it must be
  // left alone rather than converted into one the API then refuses to save.
  if (footer.some((b) => depthOf(b) + 1 > MAX_BLOCK_DEPTH)) return null;

  const band: BlockNode = {
    id:   BAND_ID,
    type: "footer",
    /*
     * EXACTLY the props the shipped default carries — one key, not the whole schema.
     *
     * ⚠ `parseLayoutDocument` does NOT fill a block's prop defaults: `props` is a
     * passthrough record, so a parsed document keeps whatever keys it was given. The
     * code default therefore stringifies as `{"showTopBorder":true}`, and a band
     * written here with the full set compares UNEQUAL to it — which made a footer
     * nobody had touched read as customised: a draft chip stuck on "pending publish"
     * for ever, and a theme update that would refuse to touch the template.
     *
     * The renderer supplies the rest (`props.minHeight ?? 0`), so the two forms draw
     * identically. The look is the one the hardcoded wrapper had: `--footer-bg` from
     * the Style Editor, and the hairline above it.
     */
    props: { showTopBorder: true },
    children: footer,
  } as BlockNode;

  return { ...doc, regions: { ...doc.regions, footer: [band] } };
}

async function markDone(): Promise<void> {
  await prisma.setting.upsert({
    where:  { key: FOOTER_BAND_MIGRATED },
    update: { value: true },
    create: { key: FOOTER_BAND_MIGRATED, value: true },
  });
  bustSettingsCache(FOOTER_BAND_MIGRATED);
}

export async function migrateFooterBandBlocks(): Promise<void> {
  if (await getSetting<boolean>(FOOTER_BAND_MIGRATED, false)) return;

  // EVERY scope: a draft is work an admin is mid-way through, and the `theme`
  // baseline is what "Revert to theme" restores — leaving either on the old shape
  // would resurrect an unpaintable footer the moment it was used.
  const rows = await prisma.layout.findMany({
    where:  { templateKey: "chrome.footer" },
    select: { id: true, document: true },
  });

  let changed = 0;
  for (const row of rows) {
    const parsed = layoutDocumentSchema.safeParse(row.document);
    if (!parsed.success) continue;   // a document we cannot read is not one we can fix

    const next = migrateFooterBand(parsed.data);
    if (!next) continue;

    await prisma.layout.update({
      where: { id: row.id },
      data:  { document: next as unknown as object },
    });
    changed++;
  }

  await markDone();
  if (changed) logger.info({ changed }, "Footers carried over to the footer block");
}

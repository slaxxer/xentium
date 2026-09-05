/**
 * One-time carry-over of a hand-built masthead onto the `header` BLOCK.
 *
 * The site header used to be something an admin assembled: a full-width `section`
 * with a height and a gradient, a `logo` dropped inside it, and the navbar under it.
 * It is one block now — the band, its height, its background and whether it carries
 * the logo — because the site's most recognisable element should not require knowing
 * how to compose one.
 *
 * Without this, every site that already built that masthead keeps a `section` doing
 * the header's job: it renders exactly as before (the `section` block is still there
 * for every other band), but the Header settings an admin now expects would not be on
 * it, and the shipped default would only reach sites that never touched their header.
 *
 * The same three properties as the migrations beside it:
 *
 *  - **Idempotent.** A flag records completion, so a restart is a no-op.
 *  - **Non-destructive.** Only a section that IS the masthead is converted, and its
 *    look is carried across value for value — same gradient, same angle, same image,
 *    same height. A section holding anything other than the logo is left alone,
 *    because converting it would drop whatever else it holds.
 *  - **Silent when there is nothing to carry.** A site whose header is already the
 *    shipped default, or has no stored layout at all, writes no rows.
 */
import {
  layoutDocumentSchema,
  type BlockNode,
  type LayoutDocument,
} from "@nodevo/contracts";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache, getSetting } from "../../shared/utils/settings.js";
import { logger } from "../../infrastructure/logging/logger.js";

/** Set once the carry-over has been considered, whether or not it wrote anything. */
export const HEADER_BAND_MIGRATED = "layout.headerBandMigrated";

/**
 * The id the shipped default uses.
 *
 * Reused on purpose: "has the admin customised this?" is a `JSON.stringify` against
 * the code default, so a converted header and a fresh one have to be the same
 * document or an untouched site would read as customised for ever after.
 */
const BAND_ID = "h-band";

/**
 * Is this section the MASTHEAD, rather than some other band an admin put up there?
 *
 * Three things have to hold, and each one is a way of being wrong:
 *  - it spans the page (`width: full`) — a centred band is a piece of content;
 *  - it has a height (`minHeight`) or a background — that is what makes it a
 *    masthead rather than a spacer;
 *  - it holds nothing but the logo. A section carrying a heading, a search field or
 *    a plugin block is doing more than the `header` block can, and converting it
 *    would silently delete the rest.
 */
function isMasthead(node: BlockNode): boolean {
  if (node.type !== "section") return false;
  const props = node.props as {
    width?: string; minHeight?: number;
    backgroundGradient?: string[]; backgroundImage?: string;
  };
  if (props.width !== "full") return false;

  const decorated =
    (props.minHeight ?? 0) > 0 ||
    (props.backgroundGradient ?? []).length > 0 ||
    !!props.backgroundImage?.trim();
  if (!decorated) return false;

  const children = node.children ?? [];
  return children.every((c) => c.type === "logo");
}

/** The same look, expressed as the block that now owns it. */
function toHeaderBlock(node: BlockNode): BlockNode {
  const props = node.props as {
    minHeight?: number; backgroundGradient?: string[];
    backgroundAngle?: number; backgroundImage?: string;
  };
  const logo = (node.children ?? []).find((c) => c.type === "logo");

  return {
    id:   BAND_ID,
    type: "header",
    props: {
      // `minHeight` and `height` are the same idea under both names: a floor. A band
      // that sized to its content (0) keeps doing that.
      height:             props.minHeight ?? 0,
      backgroundImage:    props.backgroundImage ?? "",
      backgroundGradient: props.backgroundGradient ?? [],
      backgroundAngle:    props.backgroundAngle ?? 180,
      // The logo becomes a setting rather than a child. Its own `showWordmark`
      // travels with it, because that is a choice the admin made about this logo.
      showLogo:     !!logo,
      showWordmark: (logo?.props as { showWordmark?: boolean } | undefined)?.showWordmark ?? true,
    },
  } as BlockNode;
}

/** The document with its masthead converted, or null when there is nothing to do. */
export function migrateHeaderBand(doc: LayoutDocument): LayoutDocument | null {
  const header = doc.regions.header;
  if (!header?.length) return null;
  // Already on the new shape — including a site that has both, which is legal and
  // means the admin built a second band on purpose.
  if (header.some((b) => b.type === "header")) return null;

  const index = header.findIndex(isMasthead);
  if (index === -1) return null;

  const next = [...header];
  next[index] = toHeaderBlock(header[index]!);
  return { ...doc, regions: { ...doc.regions, header: next } };
}

async function markDone(): Promise<void> {
  await prisma.setting.upsert({
    where:  { key: HEADER_BAND_MIGRATED },
    update: { value: true },
    create: { key: HEADER_BAND_MIGRATED, value: true },
  });
  bustSettingsCache(HEADER_BAND_MIGRATED);
}

export async function migrateHeaderBandBlocks(): Promise<void> {
  if (await getSetting<boolean>(HEADER_BAND_MIGRATED, false)) return;

  // EVERY scope, for the reason the region consolidation gives: a draft is work an
  // admin is mid-way through, and the `theme` baseline is what "Revert to theme"
  // restores — leaving either on the old shape would resurrect it the moment it was
  // used.
  const rows = await prisma.layout.findMany({
    where:  { templateKey: "chrome.header" },
    select: { id: true, document: true },
  });

  let changed = 0;
  for (const row of rows) {
    const parsed = layoutDocumentSchema.safeParse(row.document);
    if (!parsed.success) continue;   // a document we cannot read is not one we can fix

    const next = migrateHeaderBand(parsed.data);
    if (!next) continue;

    await prisma.layout.update({
      where: { id: row.id },
      data:  { document: next as unknown as object },
    });
    changed++;
  }

  await markDone();
  if (changed) logger.info({ changed }, "Mastheads carried over to the header block");
}

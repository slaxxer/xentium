/**
 * One-time carry-over of stored layouts onto the four-landmark region set (ADR-0005).
 *
 * The region set was consolidated to `header` / `main` / `aside` / `footer` — the
 * HTML5 landmarks — and the site chrome to one region each, with the nav strip
 * becoming a `navbar` BLOCK inside the header. What used to be region membership is
 * now either parentage (a navbar's children) or order in a single list.
 *
 * Without this, a site that had ever saved a layout would lose its navbar and its
 * footer on upgrade — SILENTLY, and in the worst possible way. An unknown region is
 * kept and skipped by design ("disabling a plugin must never delete an admin's
 * layout"), so the blocks would still be in the document, still in the database, and
 * simply never rendered again. Nothing would error.
 *
 * The same three properties as `guestHeroMigration`:
 *
 *  - **Idempotent.** A flag records completion, so a restart is a no-op.
 *  - **Non-destructive.** It only MOVES blocks between regions of the same document,
 *    keeping ids, props, visibility, variants and children exactly as they were. A
 *    document already on the new shape is left alone.
 *  - **Silent when there is nothing to carry.** A site with no stored layouts — the
 *    normal case, since the code defaults are already correct — writes no rows.
 */
import {
  DEFAULT_LAYOUTS,
  layoutDocumentSchema,
  type BlockNode,
  type LayoutDocument,
} from "@nodevo/contracts";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache, getSetting } from "../../shared/utils/settings.js";
import { logger } from "../../infrastructure/logging/logger.js";

/** Set once the carry-over has been considered, whether or not it wrote anything. */
export const REGIONS_CONSOLIDATED = "layout.regionsConsolidated";

/**
 * The navbar the old three regions become.
 *
 * The id is the one the shipped default uses, so a migrated document and a fresh one
 * are the same document — which matters because "has the admin customised this?" is a
 * `JSON.stringify` comparison against the code default.
 */
const NAVBAR_ID = "h-navbar";

/** Regions that no longer exist, and where their blocks belong now. */
const MOVES: Record<string, { from: readonly string[]; to: string }> = {
  "chrome.footer":  { from: ["top", "main", "bottom"], to: "footer" },
  "article.detail": { from: ["beforeBody", "afterBody"], to: "main" },
};

/**
 * `article.detail`'s three body regions in reading order.
 *
 * ⚠ Order is the whole point: `beforeBody` came BEFORE `main` and `afterBody` after
 * it. Concatenating the retired regions onto the end of `main` would silently move an
 * admin's intro block below the article.
 */
const ARTICLE_ORDER = ["beforeBody", "main", "afterBody"] as const;

function migrateChromeHeader(doc: LayoutDocument): LayoutDocument | null {
  const { left, center, right, bandAbove, bandBelow, header } = doc.regions as Record<string, BlockNode[] | undefined>;
  const zones = [left, center, right].filter(Boolean) as BlockNode[][];
  if (!zones.length) return null;   // already on the new shape

  // `align` carries what the region carried. `left` is the start of the row, which is
  // the absent case — never stored, exactly like `variant` and `visibility`.
  const children: BlockNode[] = [
    ...(left ?? []),
    ...(center ?? []).map((n) => ({ ...n, align: "center" as const })),
    ...(right ?? []).map((n) => ({ ...n, align: "right" as const })),
  ];

  return {
    ...doc,
    regions: {
      // A masthead the admin had already built in a band keeps its position relative
      // to the nav strip — that ordering was the entire point of the bands, and it is
      // now just the order of this list.
      header: [
        ...(bandAbove ?? []),
        ...(header ?? []),
        { id: NAVBAR_ID, type: "navbar", props: {}, children },
        ...(bandBelow ?? []),
      ],
    },
  };
}

function migrateByMove(templateKey: string, doc: LayoutDocument): LayoutDocument | null {
  const move = MOVES[templateKey];
  if (!move) return null;

  const regions = doc.regions as Record<string, BlockNode[] | undefined>;
  if (!move.from.some((r) => regions[r]?.length)) return null;   // nothing to carry

  const order = templateKey === "article.detail" ? ARTICLE_ORDER : [...move.from, move.to];
  const merged = order.flatMap((r) => regions[r] ?? []);

  const next: Record<string, BlockNode[]> = {};
  for (const [name, nodes] of Object.entries(regions)) {
    if (move.from.includes(name) || name === move.to) continue;
    if (nodes) next[name] = nodes;
  }
  next[move.to] = merged;
  return { ...doc, regions: next };
}

/** Writes the completion flag. Bust the cache, per the settings contract. */
async function markDone(): Promise<void> {
  await prisma.setting.upsert({
    where:  { key: REGIONS_CONSOLIDATED },
    update: { value: true },
    create: { key: REGIONS_CONSOLIDATED, value: true },
  });
  bustSettingsCache(REGIONS_CONSOLIDATED);
}

export async function migrateRegionConsolidation(): Promise<void> {
  if (await getSetting<boolean>(REGIONS_CONSOLIDATED, false)) return;

  // EVERY scope: a draft is unpublished work an admin is mid-way through, and the
  // `theme` baseline is what "Revert to theme" restores — leaving either on the old
  // shape would resurrect the broken document the moment it was used.
  const rows = await prisma.layout.findMany({
    select: { id: true, templateKey: true, document: true },
  });

  let changed = 0;
  for (const row of rows) {
    const parsed = layoutDocumentSchema.safeParse(row.document);
    if (!parsed.success) continue;   // a document we cannot read is not one we can fix

    const next = row.templateKey === "chrome.header"
      ? migrateChromeHeader(parsed.data)
      : migrateByMove(row.templateKey, parsed.data);
    if (!next) continue;

    await prisma.layout.update({
      where: { id: row.id },
      data:  { document: next as unknown as object },
    });
    changed++;
  }

  await markDone();
  if (changed) logger.info({ changed }, "Layouts carried over to the four-landmark region set");
}

/** Exported for the test, which asserts the move rather than the database call. */
export const __test = { migrateChromeHeader, migrateByMove, DEFAULT_LAYOUTS };

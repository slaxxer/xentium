/**
 * One-time carry-over of edge-art seasons to the `fx` edge namespace.
 *
 * "Only in season" was core's own field on an edge (`edge.season`) until 2026-10-21;
 * it now lives in plugin data as `edge.ext.fx.season`, and core draws its edge art all
 * year. The contract moves the field on every PARSE (a save, a theme import), but a
 * stored document is served as it is — so a site with a seasonal edge would show it
 * the whole year until someone happened to save that template.
 *
 * The same three properties as the migrations beside it:
 *
 *  - **Idempotent.** A flag records completion, so a restart is a no-op.
 *  - **Non-destructive.** Only the `season` key moves; nothing else in the document is
 *    rewritten (no parse, so no defaults filled in that would read as an edit).
 *  - **Silent when there is nothing to carry.**
 */
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache, getSetting } from "../../shared/utils/settings.js";
import { logger } from "../../infrastructure/logging/logger.js";

/** Set once the carry-over has been considered, whether or not it wrote anything. */
export const EDGE_SEASON_MIGRATED = "layout.edgeSeasonMigrated";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** One edge with its season moved under `ext.fx`, or null when it has none. */
function moveSeason(edge: unknown): Obj | null {
  if (!isObj(edge) || !("season" in edge)) return null;
  const { season, ...rest } = edge;
  if (!isObj(season)) return rest;
  const ext = isObj(rest.ext) ? rest.ext : {};
  const fx = isObj(ext.fx) ? ext.fx : {};
  // Already carried (an editor saved it since): the plugin's own dates win.
  if ("season" in fx) return rest;
  return { ...rest, ext: { ...ext, fx: { ...fx, season } } };
}

function moveInNodes(nodes: unknown): { nodes: unknown; changed: boolean } {
  if (!Array.isArray(nodes)) return { nodes, changed: false };
  let changed = false;
  const next = nodes.map((node) => {
    if (!isObj(node)) return node;
    let out = node;
    if (isObj(node.edges)) {
      const top = moveSeason(node.edges.top);
      const bottom = moveSeason(node.edges.bottom);
      if (top || bottom) {
        out = { ...out, edges: { ...node.edges, ...(top ? { top } : {}), ...(bottom ? { bottom } : {}) } };
        changed = true;
      }
    }
    const kids = moveInNodes(node.children);
    if (kids.changed) {
      out = { ...out, children: kids.nodes };
      changed = true;
    }
    return out;
  });
  return { nodes: next, changed };
}

/** The document with every edge's season moved under `ext.fx`, or null when it has none. */
export function migrateEdgeSeasons(doc: unknown): Obj | null {
  if (!isObj(doc) || !isObj(doc.regions)) return null;
  let changed = false;
  const regions: Obj = {};
  for (const [key, nodes] of Object.entries(doc.regions)) {
    const r = moveInNodes(nodes);
    regions[key] = r.nodes;
    changed ||= r.changed;
  }
  return changed ? { ...doc, regions } : null;
}

async function markDone(): Promise<void> {
  await prisma.setting.upsert({
    where:  { key: EDGE_SEASON_MIGRATED },
    update: { value: true },
    create: { key: EDGE_SEASON_MIGRATED, value: true },
  });
  bustSettingsCache(EDGE_SEASON_MIGRATED);
}

export async function migrateEdgeSeasonsToPlugin(): Promise<void> {
  if (await getSetting<boolean>(EDGE_SEASON_MIGRATED, false)) return;

  let changed = 0;
  // Every row — drafts, published, every theme's — and every installed theme's
  // shipped documents, which are the baseline under the admin's edits.
  const rows = await prisma.layout.findMany({ select: { id: true, document: true } });
  for (const row of rows) {
    const next = migrateEdgeSeasons(row.document);
    if (!next) continue;
    await prisma.layout.update({ where: { id: row.id }, data: { document: next as object } });
    changed++;
  }

  const themes = await prisma.theme.findMany({ select: { id: true, payload: true } });
  for (const theme of themes) {
    const payload = theme.payload as { documents?: Record<string, unknown> } | null;
    if (!payload?.documents) continue;
    let touched = false;
    const documents: Record<string, unknown> = {};
    for (const [key, doc] of Object.entries(payload.documents)) {
      const next = migrateEdgeSeasons(doc);
      documents[key] = next ?? doc;
      touched ||= !!next;
    }
    if (!touched) continue;
    await prisma.theme.update({ where: { id: theme.id }, data: { payload: { ...payload, documents } as object } });
    changed++;
  }

  await markDone();
  if (changed) logger.info({ changed }, "Edge-art seasons moved under ext.fx");
}

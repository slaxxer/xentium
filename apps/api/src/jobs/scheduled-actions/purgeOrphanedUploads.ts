/**
 * system.purge-orphaned-uploads — delete upload files nothing references.
 *
 * Nothing in the codebase deletes an upload except the appearance logo swap
 * (`appearance.routes.ts`), so replaced avatars, group icons and the entire
 * upload directory of a hard-deleted article or page stay on disk forever. This
 * is the one action that reclaims them.
 *
 * It deletes real files and there is no undo, so three guards apply:
 *
 *  1. **Body JSON counts as a reference.** Inline page images (`pages/<id>/img-*`)
 *     are never stored in a column — the editor drops the URL into the ProseMirror
 *     body. A scan that only looked at `featured_image` would delete every inline
 *     image on the site. Bodies are scanned for `/uploads/...` references too.
 *  2. **Soft-deleted rows still count as references.** A restored article must
 *     come back with its image, so `deleted_at` is deliberately NOT filtered.
 *  3. **A grace period on file age.** An upload that has landed on disk but whose
 *     owning row is still being written (or an editor upload the author has not
 *     saved yet) must not be swept out from under the request. Files younger than
 *     `graceHours` are never touched.
 *
 * If a future feature stores an upload path somewhere new, it MUST be added to
 * collectReferenced() below — the failure mode is silent data loss.
 *
 * PLUGIN UPLOADS ARE NEVER TOUCHED. Plugins write siblings of the core folders in
 * the same UPLOAD_DIR (a dev box here has forum-attachments/, plugins/,
 * shoutbox-smileys/), and core has no idea what references them — a sweep across
 * those would delete every forum attachment on the site. ROOTS is therefore an
 * allowlist of the core folders, not a scan of UPLOAD_DIR. A plugin that wants
 * this behaviour ships its own cleanup, exactly as it ships its own cron.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { prisma } from "../../infrastructure/db.js";
import { env } from "../../config/env.js";
import { ALLOWED_UPLOAD_DIRS } from "../../infrastructure/storage/LocalStorageProvider.js";
import { registerScheduledAction, type ActionResult, type ActionRunCtx } from "./action-registry.js";

/** Upload subdirectories. Taken FROM the storage provider rather than restated
 *  beside it: a second copy is a copy that drifts, and a root missing here is a
 *  directory this purge silently never visits. */
const ROOTS = ALLOWED_UPLOAD_DIRS;
type Root = (typeof ROOTS)[number];

const paramsSchema = z.object({
  graceHours: z
    .number().int().min(1).max(24 * 30).default(24)
    .meta({
      title:       "Grace period (hours)",
      description: "Never delete a file younger than this. Protects uploads whose owning record is still being written.",
    }),
  scope: z
    .enum(["all", ...ROOTS]).default("all")
    .meta({
      title:       "Scope",
      description: "Limit the sweep to one upload folder. Useful for checking one area before running the lot.",
    }),
});
type Params = z.infer<typeof paramsSchema>;

const BASE = path.resolve(env.UPLOAD_DIR);

/** Every file under `dir`, as paths relative to BASE with POSIX separators. */
async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // a root that was never used has no directory — not an error
  }
  const out: string[] = [];
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(abs)));
    else if (e.isFile()) out.push(path.relative(BASE, abs).split(path.sep).join("/"));
  }
  return out;
}

/**
 * Pull `/uploads/<path>` references out of a JSONB column. Done in SQL so a site
 * with large article bodies never loads them all into memory. The match stops at
 * the characters that can terminate a URL inside JSON-encoded HTML/ProseMirror.
 */
async function refsInJson(table: string, column: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ ref: string }[]>(
    `SELECT DISTINCT (regexp_matches("${column}"::text, '/uploads/([^"''\\\\ )>]+)', 'g'))[1] AS ref
       FROM "${table}"`,
  );
  return rows.map((r) => r.ref);
}

/**
 * Upload paths referenced by LAYOUT DOCUMENTS.
 *
 * ⚠ A second matcher, not a second call to `refsInJson`, because a layout stores a
 * BARE RELATIVE path (`"layouts/a.png"`, what `storage.save` returns) while an
 * article body stores the public URL (`/uploads/…`). The `/uploads/` pattern finds
 * nothing here, so reusing it would report every section background as unreferenced
 * and the purge would delete the site's masthead — quietly, on a schedule, weeks
 * after anyone touched it.
 *
 * Both scopes are scanned. A DRAFT is unpublished work an admin is mid-way through,
 * and deleting the image out from under it is the same loss as deleting a live one.
 */
async function refsInLayouts(): Promise<string[]> {
  const roots = ROOTS.join("|");
  const rows = await prisma.$queryRawUnsafe<{ ref: string }[]>(
    `SELECT DISTINCT (regexp_matches("document"::text, '(?:/uploads/)?((?:${roots})/[^"''\\ )>]+)', 'g'))[1] AS ref
       FROM "ncf_layouts"`,
  );
  return rows.map((r) => r.ref);
}

/**
 * Every upload path the database still points at. Conservative by construction:
 * anything that might be a reference is treated as one.
 */
async function collectReferenced(): Promise<Set<string>> {
  const [users, groups, logos, articles, pages, articleBodyRefs, pageBodyRefs, layoutRefs] = await Promise.all([
    prisma.user.findMany({ where: { avatar: { not: null } }, select: { avatar: true } }),
    prisma.group.findMany({ where: { icon: { not: null } }, select: { icon: true } }),
    prisma.setting.findMany({ where: { key: { startsWith: "appearance.logo." } }, select: { value: true } }),
    prisma.article.findMany({ where: { featuredImage: { not: null } }, select: { featuredImage: true } }),
    prisma.page.findMany({ where: { featuredImage: { not: null } }, select: { featuredImage: true } }),
    refsInJson("ncf_articles", "body"),
    refsInJson("ncf_pages", "body"),
    // Section backgrounds and every other asset prop a block carries. These live
    // ONLY in the document — no column points at them — so without this the files
    // have no reference anywhere and the sweep treats them all as orphans.
    refsInLayouts(),
  ]);

  const set = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== "string" || !v) return;
    // Stored paths are relative ("avatars/x.png"), but a body reference arrives
    // as the public URL path — normalise both to the relative form.
    set.add(v.replace(/^\/?uploads\//, "").replace(/^\/+/, ""));
  };

  users.forEach((u) => add(u.avatar));
  groups.forEach((g) => add(g.icon));
  logos.forEach((s) => add(s.value));
  articles.forEach((a) => add(a.featuredImage));
  pages.forEach((p) => add(p.featuredImage));
  articleBodyRefs.forEach(add);
  pageBodyRefs.forEach(add);
  layoutRefs.forEach(add);
  return set;
}

/** Drop directories left empty by the sweep, deepest first. Never the roots. */
async function pruneEmptyDirs(root: string): Promise<void> {
  const abs = path.join(BASE, root);
  let entries;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch { return; }
  for (const e of entries.filter((x) => x.isDirectory())) {
    const child = path.join(abs, e.name);
    await pruneEmptyDirs(path.join(root, e.name));
    const left = await fs.readdir(child).catch(() => ["keep"]);
    if (left.length === 0) await fs.rmdir(child).catch(() => {});
  }
}

const humanBytes = (n: number) =>
  n < 1024 ? `${n} B`
  : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB`
  : `${(n / 1024 ** 2).toFixed(1)} MB`;

export async function runPurgeOrphanedUploads(
  params: Params,
  ctx: ActionRunCtx,
): Promise<ActionResult> {
  const roots = params.scope === "all" ? [...ROOTS] : [params.scope as Root];
  const referenced = await collectReferenced();
  const youngerThan = Date.now() - params.graceHours * 3_600_000;

  let deleted = 0;
  let bytes   = 0;
  let skippedYoung = 0;
  const samples: string[] = [];

  for (const root of roots) {
    for (const rel of await walk(path.join(BASE, root))) {
      if (referenced.has(rel)) continue;

      const abs = path.join(BASE, rel);
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat) continue;
      if (stat.mtimeMs > youngerThan) { skippedYoung++; continue; }

      if (!ctx.dryRun) {
        // A file that vanished between the scan and here is already the outcome
        // we wanted; anything else (permissions) must surface as a failed run.
        await fs.rm(abs, { force: true });
      }
      deleted++;
      bytes += stat.size;
      if (samples.length < 5) samples.push(rel);
    }
  }

  if (!ctx.dryRun && deleted > 0) {
    for (const root of roots) await pruneEmptyDirs(root);
  }

  const scope = params.scope === "all" ? "all folders" : params.scope;
  if (deleted === 0) {
    return {
      changed: 0,
      summary: `No orphaned uploads in ${scope}` +
        (skippedYoung ? ` (${skippedYoung} file(s) inside the ${params.graceHours}h grace period).` : "."),
    };
  }

  const verb = ctx.dryRun ? "would delete" : "deleted";
  const more = deleted > samples.length ? `, +${deleted - samples.length} more` : "";
  return {
    changed: ctx.dryRun ? 0 : deleted,
    summary: `${verb} ${deleted} orphaned file(s), ${humanBytes(bytes)} in ${scope} — ${samples.join(", ")}${more}.` +
      (skippedYoung ? ` ${skippedYoung} file(s) kept inside the ${params.graceHours}h grace period.` : ""),
  };
}

registerScheduledAction({
  key:   "system.purge-orphaned-uploads",
  label: "Purge orphaned uploads",
  description:
    "Deletes files in the core upload folders (avatars, groups, themes, articles, pages, layouts) that no record points at " +
    "any more — replaced avatars and group icons, and the leftovers of deleted articles and pages. Inline images " +
    "referenced from page/article bodies and files belonging to soft-deleted records are kept, and plugin upload " +
    "folders are never touched. Always dry-run this first: deleted files cannot be recovered.",
  domain:         "System",
  params:         paramsSchema,
  minIntervalSec: 6 * 60 * 60,
  destructive:    true,
  run:            runPurgeOrphanedUploads,
});

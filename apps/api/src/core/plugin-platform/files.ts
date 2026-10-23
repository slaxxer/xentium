import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { Response } from "express";
import { fileTypeFromBuffer } from "file-type";
import { XEC } from "@xentium/contracts";
import { XentiumError } from "@xentium/errors";
import { LocalStorageProvider } from "@xentium/server-kit";
import type { PluginFile, PluginFileInput, PluginFiles, PluginFileSaveOptions } from "@xentium/plugin-sdk";
import { prisma } from "../../infrastructure/db.js";
import { env } from "../../config/env.js";
import { cleanImage, imageVariants, type VariantName } from "../../shared/media/images.js";

/**
 * Files for plugins (ADR-0011): `host.files`. Core checks the type by the bytes
 * (never the name), names the file itself, strips camera data and GPS from images
 * and makes their sizes, and keeps a row per file in `xcf_files`.
 *
 * On disk: `uploads/addons/<pluginId>/<public|private>/<id>/<name>`. Public files
 * are served by `/uploads` (app.ts allows `addons/<id>/public/` only); a private
 * file leaves only through `send`, called by the plugin's own route after its own
 * check. The member's file name is kept as metadata, never used on disk.
 */

/** What `accept` may name, and the types (by their bytes) each stands for. */
export const FILE_KINDS: Record<string, readonly string[]> = {
  image:    ["jpg", "png", "webp", "gif", "avif"],
  pdf:      ["pdf"],
  archive:  ["zip", "7z", "rar", "gz", "tar"],
  audio:    ["mp3", "ogg", "wav", "m4a", "flac", "opus"],
  video:    ["mp4", "webm", "mov"],
  document: ["docx", "xlsx", "pptx", "odt", "ods", "odp", "rtf"],
};
const IMAGE = new Set(FILE_KINDS.image);
const DEFAULT_MAX = 20 * 1024 * 1024;
const HARD_MAX = 200 * 1024 * 1024;
const ID = /^[0-9a-f-]{36}$/;
const ROOT = "addons";

/** No cleaning here: images are cleaned (and sized) by this service before they are written. */
const disk = new LocalStorageProvider({ baseDir: env.UPLOAD_DIR, allowedSubdirs: [ROOT] });

type Row = Awaited<ReturnType<typeof prisma.pluginFile.findFirst>> & object;
interface StoredVariant { file: string; ext: string; width: number; height: number; bytes: number }

const dirOf = (pluginId: string, visibility: string, id: string) => path.join(ROOT, pluginId, visibility, id);

function refused(message: string, status = 422): never {
  throw new XentiumError({ code: XEC.API_VALIDATION, httpStatus: status, message });
}

function allowedExts(accept: string[]): Set<string> {
  const out = new Set<string>();
  for (const a of accept) {
    const kind = FILE_KINDS[a];
    if (kind) kind.forEach((e) => out.add(e));
    else if (Object.values(FILE_KINDS).some((k) => k.includes(a))) out.add(a);
    else throw new Error(`[plugin files] "${a}" is not a file kind or type core accepts.`);
  }
  return out;
}

function shape(row: Row): PluginFile {
  const base = dirOf(row.pluginId, row.visibility, row.id);
  const publicUrl = (file: string) => (row.visibility === "public" ? disk.publicUrl(path.join(base, file)) : null);
  const variants = row.variants as Record<VariantName, StoredVariant> | null;
  return {
    ref: row.id,
    mime: row.mime,
    ext: row.ext,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    kind: row.kind,
    itemId: row.itemId,
    visibility: row.visibility as "public" | "private",
    originalName: row.originalName,
    uploaderId: row.uploaderId,
    createdAt: row.createdAt.toISOString(),
    url: publicUrl(variants ? variants.full.file : `file.${row.ext}`),
    variants: variants
      ? Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { url: publicUrl(v.file), width: v.width, height: v.height, ext: v.ext }])) as PluginFile["variants"]
      : null,
  };
}

/** `host.files` for one plugin. */
export function filesFor(pluginId: string): PluginFiles {
  const mine = async (ref: string) => {
    if (typeof ref !== "string" || !ID.test(ref)) return null;
    return prisma.pluginFile.findFirst({ where: { id: ref, pluginId } });
  };

  return {
    async save(input: PluginFileInput, opts: PluginFileSaveOptions) {
      const buffer = Buffer.isBuffer(input) ? input : input?.buffer;
      if (!Buffer.isBuffer(buffer) || !buffer.length) refused("No file was sent");
      const visibility = opts.visibility;
      if (visibility !== "public" && visibility !== "private") throw new Error(`[plugin files] visibility must be "public" or "private".`);
      const max = Math.min(opts.maxBytes ?? DEFAULT_MAX, HARD_MAX);
      if (buffer.length > max) refused(`The file is larger than ${Math.floor(max / 1024 / 1024)} MB`, 413);

      const allowed = allowedExts(opts.accept);
      const detected = await fileTypeFromBuffer(buffer);
      const ext = detected?.ext === "jpeg" ? "jpg" : detected?.ext;
      if (!ext || !allowed.has(ext)) refused("This type of file is not allowed here");

      const id = crypto.randomUUID();
      const dir = dirOf(pluginId, visibility, id);
      let width: number | null = null, height: number | null = null;
      let variants: Record<string, StoredVariant> | null = null;
      try {
        if (IMAGE.has(ext) && opts.variants !== false) {
          const made = await imageVariants(buffer, ext);
          width = made.width; height = made.height;
          variants = {};
          for (const v of made.variants) {
            const file = `${v.name}.${v.ext}`;
            await disk.save(dir, file, v.buffer);
            variants[v.name] = { file, ext: v.ext, width: v.width, height: v.height, bytes: v.buffer.length };
          }
        } else {
          const data = IMAGE.has(ext) ? await cleanImage(buffer, `x.${ext}`) : buffer;
          await disk.save(dir, `file.${ext}`, data);
        }
      } catch (err) {
        await fs.rm(path.join(path.resolve(env.UPLOAD_DIR), dir), { recursive: true, force: true }).catch(() => {});
        throw err;
      }

      const name = typeof (input as { originalname?: unknown }).originalname === "string"
        ? (input as { originalname: string }).originalname.slice(0, 255) : null;
      const row = await prisma.pluginFile.create({
        data: {
          id, pluginId, visibility, ext, width, height,
          mime: detected!.mime,
          bytes: buffer.length,
          kind: opts.kind ?? null,
          itemId: opts.itemId ?? null,
          variants: (variants ?? undefined) as object | undefined,
          originalName: name,
          uploaderId: opts.uploaderId ?? null,
        },
      });
      return shape(row);
    },

    async get(ref) {
      const row = await mine(ref);
      return row ? shape(row) : null;
    },

    async list(filter = {}) {
      const rows = await prisma.pluginFile.findMany({
        where: { pluginId, ...(filter.kind ? { kind: filter.kind } : {}), ...(filter.itemId ? { itemId: filter.itemId } : {}) },
        orderBy: { createdAt: "asc" },
        take: 500,
      });
      return rows.map(shape);
    },

    async send(resArg: unknown, ref: string, opts = {}) {
      const res = resArg as Response;
      const row = await mine(ref);
      if (!row) throw new XentiumError({ code: XEC.API_NOT_FOUND, httpStatus: 404, message: "File not found" });
      const variants = row.variants as Record<VariantName, StoredVariant> | null;
      const file = variants ? (variants[opts.variant ?? "full"] ?? variants.full).file : `file.${row.ext}`;
      const abs = path.join(path.resolve(env.UPLOAD_DIR), dirOf(row.pluginId, row.visibility, row.id), file);
      const download = opts.download === true ? (row.originalName ?? `file.${row.ext}`) : opts.download || null;
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (row.visibility === "private") res.setHeader("Cache-Control", "private, no-store");
      // Anything but an image is a download, so it can never render as a page here.
      if (download || !IMAGE.has(row.ext)) res.attachment(download ?? row.originalName ?? `file.${row.ext}`);
      await new Promise<void>((resolve, reject) => res.sendFile(abs, (err) => (err ? reject(err) : resolve())));
    },

    async remove(ref) {
      const row = await mine(ref);
      if (!row) return false;
      await prisma.pluginFile.delete({ where: { id: row.id } });
      await fs.rm(path.join(path.resolve(env.UPLOAD_DIR), dirOf(row.pluginId, row.visibility, row.id)), { recursive: true, force: true });
      return true;
    },

    async removeFor(filter) {
      const rows = await prisma.pluginFile.findMany({ where: { pluginId, kind: filter.kind ?? undefined, itemId: filter.itemId ?? undefined }, select: { id: true } });
      for (const r of rows) await this.remove(r.id);
      return rows.length;
    },
  };
}

/** Uninstall with its data: every file of the plugin, rows and bytes. */
export async function dropPluginFiles(pluginId: string): Promise<void> {
  await prisma.pluginFile.deleteMany({ where: { pluginId } });
  if (/^[a-z0-9][a-z0-9._-]*$/i.test(pluginId)) {
    await fs.rm(path.join(path.resolve(env.UPLOAD_DIR), ROOT, pluginId), { recursive: true, force: true });
  }
}

/** For the orphan purge: is `rel` (a path under uploads) a file some row still owns? */
export function liveAddonFile(rel: string, ids: Set<string>): boolean {
  const m = /^addons\/[^/]+\/(?:public|private)\/([^/]+)\//.exec(rel);
  return !!m && ids.has(m[1]!);
}

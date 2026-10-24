/**
 * The CMS's storage provider, built from the framework implementation
 * (`@xentium/server-kit`).
 *
 * The package enforces the allowlist and blocks traversal; this file names the
 * directories, because `avatars` / `articles` / `themes` are CMS concepts.
 * `themes` covers both `themes/logo` (the site logo) and `themes/<theme-id>`
 * (assets unpacked from an imported .xttheme). `layouts` holds imagery a block
 * references — a `section` background, today. `badges` holds award icons (ADR-0009),
 * bounded to 32x32 at the route that writes them. `covers` holds members' own profile
 * covers — one file per user, replaced in place.
 *
 * ⚠ Most of these are written only by admin-authenticated paths, but `avatars` and
 * `covers` are NOT: a member writes their own, named after their user id. Every
 * filename is basenamed + sanitised before it gets here, and those two routes carry
 * their own per-rank limits (`assertProfileImageAllowed`).
 *
 * ⚠ There is a SECOND list of the same name in `app/app.ts` deciding what
 * `/uploads` will SERVE. They are separate on purpose — a directory can be
 * writable without being public — so adding one here does not make it reachable,
 * and adding it there does not make it writable. A new directory usually needs both.
 */
import { LocalStorageProvider, type StorageProvider } from "@xentium/server-kit";
import { env } from "../../config/env.js";
import { cleanImage } from "../../shared/media/images.js";

/**
 * ⚠ Keep in step with `jobs/scheduled-actions/purgeOrphanedUploads.ts`, which sweeps
 * exactly these roots: a directory added here with nothing teaching that job how its
 * files are REFERENCED becomes a directory whose contents are all orphans, and the
 * purge deletes them on a schedule long after anyone connects the two.
 */
export const ALLOWED_UPLOAD_DIRS = ["avatars", "covers", "articles", "pages", "groups", "themes", "layouts", "emojis", "addons"] as const;

export { LocalStorageProvider };

/**
 * Core's storage: the framework provider, with every raster image cleaned on the way
 * in — turned upright, re-encoded without EXIF/GPS (`shared/media/images.ts`). In ONE
 * place on purpose: every upload path (avatars, covers, article images, emojis, group
 * icons, layout backgrounds, theme assets, add-on files) gets it, including ones
 * written after this, without each having to remember.
 */
class CleaningStorageProvider extends LocalStorageProvider {
  override async save(subdir: string, filename: string, data: Buffer): Promise<string> {
    return super.save(subdir, filename, await cleanImage(data, filename));
  }
}

export const storage: StorageProvider = new CleaningStorageProvider({
  baseDir: env.UPLOAD_DIR,
  allowedSubdirs: ALLOWED_UPLOAD_DIRS,
});

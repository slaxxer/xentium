/**
 * The CMS's storage provider, built from the framework implementation
 * (`@nodevo/server-kit`).
 *
 * The package enforces the allowlist and blocks traversal; this file names the
 * directories, because `avatars` / `articles` / `themes` are CMS concepts.
 * `themes` covers both `themes/logo` (the site logo) and `themes/<theme-id>`
 * (assets unpacked from an imported .nvtheme). `layouts` holds imagery a block
 * references — a `section` background, today. `badges` holds award icons (ADR-0009),
 * bounded to 32x32 at the route that writes them. Written only by admin-
 * authenticated paths, and every filename is basenamed + sanitised before it
 * gets here.
 *
 * ⚠ There is a SECOND list of the same name in `app/app.ts` deciding what
 * `/uploads` will SERVE. They are separate on purpose — a directory can be
 * writable without being public — so adding one here does not make it reachable,
 * and adding it there does not make it writable. A new directory usually needs both.
 */
import { LocalStorageProvider, type StorageProvider } from "@nodevo/server-kit";
import { env } from "../../config/env.js";

/**
 * ⚠ Keep in step with `jobs/scheduled-actions/purgeOrphanedUploads.ts`, which sweeps
 * exactly these roots: a directory added here with nothing teaching that job how its
 * files are REFERENCED becomes a directory whose contents are all orphans, and the
 * purge deletes them on a schedule long after anyone connects the two.
 */
export const ALLOWED_UPLOAD_DIRS = ["avatars", "articles", "pages", "groups", "badges", "themes", "layouts"] as const;

export { LocalStorageProvider };

export const storage: StorageProvider = new LocalStorageProvider({
  baseDir: env.UPLOAD_DIR,
  allowedSubdirs: ALLOWED_UPLOAD_DIRS,
});

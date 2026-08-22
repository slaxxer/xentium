/**
 * The CMS's storage provider, built from the framework implementation
 * (`@nodevo/server-kit`).
 *
 * The package enforces the allowlist and blocks traversal; this file names the
 * directories, because `avatars` / `articles` / `themes` are CMS concepts.
 * `themes` covers both `themes/logo` (the site logo) and `themes/<theme-id>`
 * (assets unpacked from an imported .nvtheme). Written only by admin-
 * authenticated paths, and every filename is basenamed + sanitised before it
 * gets here.
 */
import { LocalStorageProvider, type StorageProvider } from "@nodevo/server-kit";
import { env } from "../../config/env.js";

/** Keep in step with `jobs/scheduled-actions/purgeOrphanedUploads.ts`. */
export const ALLOWED_UPLOAD_DIRS = ["avatars", "articles", "pages", "groups", "themes"] as const;

export { LocalStorageProvider };

export const storage: StorageProvider = new LocalStorageProvider({
  baseDir: env.UPLOAD_DIR,
  allowedSubdirs: ALLOWED_UPLOAD_DIRS,
});

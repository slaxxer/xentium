import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { logger } from "../../infrastructure/logging/logger.js";

/**
 * Does the code we are about to RUN still match the package it came from?
 *
 * The signature check at install time proves the package was ours. It says
 * nothing about the files afterwards — the engine extracts the archive and
 * imports from the extracted tree, so that tree is what actually executes. A
 * signature verified once and never looked at again is a trust-on-first-use
 * story, and the interesting moment is not the install, it is every boot after
 * it.
 *
 * So this compares the extracted files against the retained `.xtplugin`, on
 * every enable — which includes startup, because that is how enabled plugins
 * come back. It holds for signed and unsigned packages alike: an unsigned
 * plugin is a developer's own code, and that code being quietly edited under
 * them is still worth catching.
 *
 * ⚠ It checks the files the package SHIPPED, and deliberately ignores anything
 * else in the directory. A plugin that writes a cache file beside itself, or a
 * `node_modules` link the engine puts there, must not read as tampering — a
 * false positive here disables a working plugin on boot, which is worse than
 * the detection is good. Modification of a shipped file is the real attack:
 * an added file is inert unless something imports it, and the thing that would
 * have to import it is a shipped file that would then itself be modified.
 */

export interface IntegrityResult {
  /** Files that no longer match the package. Empty means intact. */
  changed: string[];
  /** Shipped files missing from the extraction entirely. */
  missing: string[];
  /** False when we could not check at all — no package on disk to compare to. */
  checked: boolean;
}

/**
 * Never throws. A plugin we cannot check is reported as unchecked rather than
 * as broken: an instance whose package files were cleaned up should keep
 * running, and "we do not know" must not be dressed up as "it is fine" OR as
 * "it is compromised".
 */
export async function checkExtractionIntegrity(
  packagePath: string,
  extractDir: string,
): Promise<IntegrityResult> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(await fs.readFile(packagePath));
  } catch {
    return { changed: [], missing: [], checked: false };
  }

  const changed: string[] = [];
  const missing: string[] = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;

    // The package is already trusted to be free of traversal (validatePackage
    // refuses `..` before anything is written), but this resolves a path from
    // archive data and then reads it, so it re-checks rather than assuming.
    const target = path.resolve(extractDir, entry.entryName);
    if (!target.startsWith(path.resolve(extractDir) + path.sep)) {
      changed.push(entry.entryName);
      continue;
    }

    let onDisk: Buffer;
    try {
      onDisk = await fs.readFile(target);
    } catch {
      missing.push(entry.entryName);
      continue;
    }

    const want = createHash("sha256").update(entry.getData()).digest("hex");
    const have = createHash("sha256").update(onDisk).digest("hex");
    if (want !== have) changed.push(entry.entryName);
  }

  return { changed, missing, checked: true };
}

/**
 * The same check, phrased as the decision an enable has to make.
 *
 * Returns a message when the plugin must not be loaded, or null when it may be.
 * The message is what the admin reads in the ACP's "failed to load" row, so it
 * names files rather than saying something went wrong.
 */
export async function assertExtractionIntact(
  pluginId: string,
  packagePath: string,
  extractDir: string,
): Promise<string | null> {
  const result = await checkExtractionIntegrity(packagePath, extractDir);

  if (!result.checked) {
    // Not an error. Common on an instance whose package files were pruned, and
    // on anything installed before packages were retained.
    logger.debug({ pluginId }, "Plugin integrity not checked — no package on disk");
    return null;
  }

  const broken = [...result.changed, ...result.missing];
  if (broken.length === 0) return null;

  logger.error(
    { pluginId, changed: result.changed, missing: result.missing },
    "Plugin files no longer match the package they were installed from — refusing to load",
  );

  const shown = broken.slice(0, 3).join(", ");
  const rest = broken.length > 3 ? ` and ${broken.length - 3} more` : "";
  return (
    `This plugin's files have changed since it was installed (${shown}${rest}). `
    + `It has not been loaded. Reinstall it from the marketplace, or remove it.`
  );
}

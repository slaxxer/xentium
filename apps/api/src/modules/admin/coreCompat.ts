import { meetsMinimum, withinMaximum } from "../../config/version.js";

/**
 * Which installed plugins refuse the core version we are about to offer.
 *
 * Checked BEFORE an update is offered, not discovered at apply time: an admin
 * who is going to be blocked should be told on the card, with the names, rather
 * than after the site is in maintenance mode. `xentium update` runs the same
 * test against the same declarations, so the ACP and the CLI cannot disagree.
 *
 * The same reading `assertCompatible` uses at enable time — a plugin declaring
 * `minXentiumVersion: "1.2"` means the 1.2 line, while "1.2.0-alpha.4" is exact.
 *
 * A plugin that declares nothing is NOT blocked. We have no idea what it
 * supports, and refusing every core update because an old plugin was vague
 * would make the whole feature unusable on exactly the sites that need it.
 */

export interface InstalledManifest {
  id: string;
  name: string;
  manifest: { minXentiumVersion?: string; maxXentiumVersion?: string } | null;
}

export interface Blocker {
  id: string;
  name: string;
  /** What it says it supports, for the card: "1.0+", "1.0–1.2", or just "1.0"
   *  when the floor and the ceiling are the same version. */
  supports: string;
}

export function pluginsBlocking(version: string, installed: InstalledManifest[]): Blocker[] {
  const blockers: Blocker[] = [];
  for (const plugin of installed) {
    const min = plugin.manifest?.minXentiumVersion;
    const max = plugin.manifest?.maxXentiumVersion;
    if (!min) continue;
    const tooOld = !meetsMinimum(version, min);
    const tooNew = !!max && !withinMaximum(version, max);
    if (tooOld || tooNew) {
      const supports = !max ? `${min}+` : max === min ? min : `${min}–${max}`;
      blockers.push({ id: plugin.id, name: plugin.name, supports });
    }
  }
  return blockers;
}

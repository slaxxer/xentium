/**
 * Themes every install ships with: Xentium Dark, the core look after dark.
 *
 * Added to the library at boot, INACTIVE — installing is not switching, so a site
 * keeps its look. Readers can wear it straight away from the theme chooser (an
 * installed theme is offered to them), and an admin can make it the site's own.
 *
 * Seeded ONCE. `themes.bundled.<id>` records the version that was put in the
 * library, so:
 *  - a row the admin uninstalled stays uninstalled (the flag is there, the row not);
 *  - a newer bundled version replaces the package of a row that is still ours (its
 *    version equals the flag), keeping whether it is active. So does a CHANGED package
 *    at the same version: until the rollout every package stays 1.0.0 and is replaced
 *    in place, so the bytes, not the number, say whether core shipped something new. The admin's edits to it
 *    live in settings and layout rows of their own, not in the package, so they stay.
 *  - a row the admin replaced by importing their own package under the same id is
 *    theirs, and is left alone.
 */
import { XENTIUM_DARK_PACKAGE, themeManifestSchema } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { getFreshSetting, bustSettingsCache } from "../../shared/utils/settings.js";
import { bustThemeCss } from "../appearance/appearance.service.js";
import { bustThemeLayouts } from "../layouts/layout.service.js";

const BUNDLED = [XENTIUM_DARK_PACKAGE];

const flagKey = (id: string) => `themes.bundled.${id}`;

/** JSON with sorted keys: `jsonb` reorders keys, so a plain stringify would differ every boot. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v);
}

async function setFlag(id: string, version: string): Promise<void> {
  const key = flagKey(id);
  await prisma.setting.upsert({ where: { key }, update: { value: version }, create: { key, value: version } });
  bustSettingsCache(key);
}

export async function ensureBundledThemes(): Promise<void> {
  for (const pkg of BUNDLED) {
    const manifest = themeManifestSchema.parse(pkg.manifest);
    const { id, version } = manifest;
    const [seeded, row] = await Promise.all([
      getFreshSetting<string | null>(flagKey(id), null),
      prisma.theme.findUnique({ where: { id }, select: { version: true, payload: true } }),
    ]);

    if (!row) {
      if (seeded) continue; // put in once and removed since: the admin's call
      await prisma.theme.create({
        data: {
          id, name: manifest.name, version, vendor: manifest.vendor,
          manifest: manifest as object, payload: pkg.payload as object, active: false,
        },
      });
      await setFlag(id, version);
      continue;
    }

    if (seeded !== row.version) continue; // not ours: the admin imported their own
    if (row.version === version && canonical(row.payload) === canonical(pkg.payload)) continue; // current
    await prisma.theme.update({
      where: { id },
      data: { name: manifest.name, version, vendor: manifest.vendor, manifest: manifest as object, payload: pkg.payload as object },
    });
    bustThemeCss(id);
    bustThemeLayouts(id);
    await setFlag(id, version);
  }
}

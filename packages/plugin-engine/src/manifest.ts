import { z } from "zod";
import { XentiumError, XEC } from "@xentium/errors";
import { meetsMinimum, withinMaximum } from "./version.js";

export const manifestSchema = z.object({
  id:                 z.string().regex(/^[a-z0-9-]+$/, "id must be kebab-case"),
  name:               z.string().min(1),
  version:            z.string().regex(/^\d+\.\d+\.\d+/, "version must be semver"),
  vendor:             z.string().min(1),
  // "1.0", "1.0.0" or "1.0.0-alpha.11" — see `meetsMinimum` for what each means.
  minXentiumVersion:   z.string().regex(/^\d+\.\d+/, "minXentiumVersion must be semver"),
  maxXentiumVersion:   z.string().regex(/^\d+\./, "maxXentiumVersion must be semver").optional(),
  licenseRequired:    z.boolean().default(false),
  // Reserved DB namespace for this plugin's tables. When declared, the migration
  // runner enforces that every table/index/sequence/type/function/trigger the
  // plugin's migrations create (and every object they alter/drop/index) begins
  // with this prefix — keeping plugin schema namespaced and unable to collide
  // with core (`xcf_`) or another plugin. Convention: short + snake, ending in
  // `_` (e.g. `forum_`, `sb_`, `amod_`). Optional for back-compat; the reserved-
  // namespace guard applies to every plugin regardless.
  tablePrefix:        z.string().regex(/^[a-z][a-z0-9]*_$/, "tablePrefix must be lowercase snake_case ending in '_'").optional(),
  // Storefront metadata, ignored by the host at every step — it is carried so a
  // marketplace can extract the listing's gallery from the artifact it is
  // already verifying, rather than from a second upload that can drift out of
  // step with the bytes being sold. Each entry is a package-relative path under
  // `assets/`; anything else is refused by whoever reads it.
  screenshots:        z.array(z.string()).max(6).default([]),
  permissions:        z.array(z.string()).default([]),
  migrations:         z.array(z.string()).default([]),
  entrypoints: z.object({
    server: z.string().optional(),
    web:    z.string().optional(),
  }).default({}),
});

export type PluginManifest = z.infer<typeof manifestSchema>;

/**
 * Parse and compatibility-check a manifest.
 *
 * `hostVersion` is injected rather than read: the package cannot know which
 * application is hosting it, and a marketplace vetting a submission checks
 * against a *target* version rather than its own.
 */
export function validateManifest(raw: unknown, hostVersion: string): PluginManifest {
  const manifest = manifestSchema.parse(raw);
  assertCompatible(manifest, hostVersion);
  return manifest;
}

/**
 * Compatibility check (§10 lifecycle step 4): the plugin's declared
 * min/maxXentiumVersion window must contain the host version. A bound written
 * without a prerelease names a release line (a 1.0.0-alpha build accepts a plugin
 * targeting 1.0); one written with a prerelease is exact (see `meetsMinimum`).
 */
export function assertCompatible(manifest: PluginManifest, hostVersion: string): void {
  if (!meetsMinimum(hostVersion, manifest.minXentiumVersion)) {
    throw new XentiumError({
      code: XEC.PLUGIN_INCOMPATIBLE,
      httpStatus: 422,
      message: `Plugin "${manifest.id}" requires Xentium ${manifest.minXentiumVersion}+ (this is ${hostVersion})`,
    });
  }
  if (manifest.maxXentiumVersion && !withinMaximum(hostVersion, manifest.maxXentiumVersion)) {
    throw new XentiumError({
      code: XEC.PLUGIN_INCOMPATIBLE,
      httpStatus: 422,
      message: `Plugin "${manifest.id}" supports Xentium up to ${manifest.maxXentiumVersion} (this is ${hostVersion})`,
    });
  }
}

/** Binds `validateManifest` to one host version, for an application that always checks against its own. */
export function createManifestValidator(hostVersion: string) {
  return (raw: unknown): PluginManifest => validateManifest(raw, hostVersion);
}

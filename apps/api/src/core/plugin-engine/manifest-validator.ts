import { z } from "zod";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";
import { NODEVO_VERSION, compareBaseVersions } from "../../config/version.js";

export const manifestSchema = z.object({
  id:                 z.string().regex(/^[a-z0-9-]+$/, "id must be kebab-case"),
  name:               z.string().min(1),
  version:            z.string().regex(/^\d+\.\d+\.\d+/, "version must be semver"),
  vendor:             z.string().min(1),
  minNodevoVersion:   z.string().regex(/^\d+\.\d+/, "minNodevoVersion must be semver"),
  maxNodevoVersion:   z.string().regex(/^\d+\./, "maxNodevoVersion must be semver").optional(),
  licenseRequired:    z.boolean().default(false),
  // Reserved DB namespace for this plugin's tables. When declared, the migration
  // runner enforces that every table/index/sequence/type/function/trigger the
  // plugin's migrations create (and every object they alter/drop/index) begins
  // with this prefix — keeping plugin schema namespaced and unable to collide
  // with core (`ncf_`) or another plugin. Convention: short + snake, ending in
  // `_` (e.g. `forum_`, `sb_`, `amod_`). Optional for back-compat; the reserved-
  // namespace guard applies to every plugin regardless.
  tablePrefix:        z.string().regex(/^[a-z][a-z0-9]*_$/, "tablePrefix must be lowercase snake_case ending in '_'").optional(),
  permissions:        z.array(z.string()).default([]),
  migrations:         z.array(z.string()).default([]),
  entrypoints: z.object({
    server: z.string().optional(),
    web:    z.string().optional(),
  }).default({}),
});

export type PluginManifest = z.infer<typeof manifestSchema>;

export function validateManifest(raw: unknown): PluginManifest {
  const manifest = manifestSchema.parse(raw);
  assertCompatible(manifest);
  return manifest;
}

/**
 * Compatibility check (§10 lifecycle step 4): the plugin's declared
 * min/maxNodevoVersion window must contain the running platform version.
 * Base versions only — a 1.0.0-alpha build accepts plugins targeting 1.0,
 * and prerelease identifiers never affect the comparison.
 */
function assertCompatible(manifest: PluginManifest): void {
  if (compareBaseVersions(NODEVO_VERSION, manifest.minNodevoVersion) < 0) {
    throw new NodevoError({
      code: NEC.PLUGIN_INCOMPATIBLE,
      httpStatus: 422,
      message: `Plugin "${manifest.id}" requires Nodevo ${manifest.minNodevoVersion}+ (this is ${NODEVO_VERSION})`,
    });
  }
  if (manifest.maxNodevoVersion && compareBaseVersions(NODEVO_VERSION, manifest.maxNodevoVersion) > 0) {
    throw new NodevoError({
      code: NEC.PLUGIN_INCOMPATIBLE,
      httpStatus: 422,
      message: `Plugin "${manifest.id}" supports Nodevo up to ${manifest.maxNodevoVersion} (this is ${NODEVO_VERSION})`,
    });
  }
}

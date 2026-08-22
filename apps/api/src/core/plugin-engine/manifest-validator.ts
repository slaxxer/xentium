/**
 * The CMS's binding of the framework manifest validator (`@nodevo/plugin-engine`).
 *
 * The package takes the host version as an argument — it cannot know which
 * application is hosting it, and a marketplace vetting a submission checks
 * against a target version rather than its own. This binds it to ours.
 */
import { createManifestValidator, manifestSchema, type PluginManifest } from "@nodevo/plugin-engine";
import { NODEVO_VERSION } from "../../config/version.js";

export const validateManifest = createManifestValidator(NODEVO_VERSION);
export { manifestSchema };
export type { PluginManifest };

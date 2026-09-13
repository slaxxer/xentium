/**
 * The CMS's binding of the framework manifest validator (`@xentium/plugin-engine`).
 *
 * The package takes the host version as an argument — it cannot know which
 * application is hosting it, and a marketplace vetting a submission checks
 * against a target version rather than its own. This binds it to ours.
 */
import { createManifestValidator, manifestSchema, type PluginManifest } from "@xentium/plugin-engine";
import { XENTIUM_VERSION } from "../../config/version.js";

export const validateManifest = createManifestValidator(XENTIUM_VERSION);
export { manifestSchema };
export type { PluginManifest };

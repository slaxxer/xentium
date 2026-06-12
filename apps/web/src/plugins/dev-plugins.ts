// DEV ONLY. Build-time imports of official plugin web entries so `vite dev`
// keeps full HMR for plugin code. This module is reached only from a
// `import.meta.env.DEV` branch in main.tsx, so it is dead-code-eliminated from
// production builds — keeping forum code out of the core bundle. In production,
// plugin UI is loaded at runtime from compiled bundles via /api/meta/plugin-web.
// Official plugins live in their own repos and are NOT bundled in core.
// To develop one locally with HMR, check it out under plugins/official/ and
// add its web entry here (this file edit stays local — see .gitignore).
const ENTRIES: Record<string, () => Promise<unknown>> = {};

/** Plugin ids provided here as build-time (HMR) entries. main.tsx runtime-loads
 *  any OTHER enabled plugin from its compiled bundle, so uploaded plugins work
 *  in dev too without per-plugin wiring. */
export const DEV_PLUGIN_IDS = Object.keys(ENTRIES);

export async function loadDevPlugins(enabledIds: string[]): Promise<void> {
  await Promise.all(
    Object.entries(ENTRIES)
      .filter(([id]) => enabledIds.includes(id))
      .map(([, importFn]) => importFn()),
  );
}

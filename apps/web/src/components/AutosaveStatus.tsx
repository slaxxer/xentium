import { SaveChip } from "./SaveChip";

/**
 * Autosave indicator — an alias for `SaveChip`.
 *
 * This used to be a second, separate indicator: inline-styled, and with its
 * copy ("Changes save automatically" / "Saving…") hardcoded in English. That
 * meant the ACP shipped TWO looks for one idea — five core pages and every
 * plugin rendered one of them, `SettingsPage` and `EmailPage` the other — and
 * the plugin-facing one silently ignored the four non-English locales the rest
 * of the panel was translated into.
 *
 * Kept as a name rather than deleted because it is the import path every plugin
 * already uses (and one of the host globals plugins externalise), so removing it
 * would break bundles that ship separately from core. New code should import
 * `SaveChip` directly.
 */
export function AutosaveStatus({ saving }: { saving: boolean }) {
  return <SaveChip saving={saving} />;
}

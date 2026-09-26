import { createContext, useContext, type ReactNode } from "react";
import { SaveChip } from "./SaveChip";
import { useReportSaving } from "../hooks/useAutosave";

/**
 * Marks a region whose page already shows a `SaveChip` for everything on it —
 * the group page around a plugin's groupConfigPanel, say. Inside it,
 * `AutosaveStatus` reports to that chip instead of drawing a second one.
 */
const HostedChip = createContext(false);

export function SaveChipHost({ children }: { children: ReactNode }) {
  return <HostedChip.Provider value={true}>{children}</HostedChip.Provider>;
}

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
  const hosted = useContext(HostedChip);
  // Shipped plugin bundles call this, not useReportSaving — so the choice is
  // made here, and a panel written before the group page existed still reports
  // to its chip instead of showing two that can disagree.
  useReportSaving(hosted && saving);
  return hosted ? null : <SaveChip saving={saving} />;
}

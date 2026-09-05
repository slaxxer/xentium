import type { TFunction } from "i18next";
import type { ProgressEvent } from "../../../lib/streamProgress";
import { blocksThisSiteCannotDraw } from "../../../layout/themeFootprint";

/**
 * What to tell an admin after a theme finished installing.
 *
 * There are TWO ways into the same install — the Marketplace grid and the Licence
 * panel's owned rows — and both reach the same endpoint and the same importer, so
 * both owe the admin the same two facts. Keeping the sentence here is the only way
 * they cannot drift; it had already drifted once, with the Licence panel reporting
 * a plugin install for a theme.
 *
 * Fact one: a theme import lands in the appearance DRAFT. Nothing changes for
 * visitors until someone publishes, and an admin who installs a theme and sees the
 * site unchanged is looking at correct behaviour nobody told them about.
 *
 * Fact two: what will not appear. That is NOT simply the import report's lists —
 * see below, it is the reason this function is not three lines.
 */

/**
 * ⚠ `unknownBlocks` is a CANDIDATE set, not the answer — the API cannot see plugin
 * blocks and over-reports every one of them. `blocksThisSiteCannotDraw` narrows it
 * to the truth; the full reasoning lives there, beside the registry it consults.
 */
export function themeInstallMessage(
  t: TFunction,
  name: string,
  /** The stream's terminal event — it carries the import report. Nullable because
   *  a job that never reached its `done` frame has none. */
  final: ProgressEvent | null | undefined,
): string {
  const staged = t("marketplace.themeStaged", { name });

  const list = (value: unknown): string[] => (Array.isArray(value) ? value as string[] : []);

  const missing = [
    ...list(final?.unknownTemplates),
    ...blocksThisSiteCannotDraw(list(final?.unknownBlocks)),
  ];
  if (!missing.length) return staged;

  return `${staged} ${t("marketplace.themeSkipped", { count: missing.length, list: missing.join(", ") })}`;
}

import { isKnownTemplate } from "@xentium/contracts";
import { getBlock } from "./blockRegistry";

/**
 * What THIS site cannot draw of a theme's dependency footprint.
 *
 * A theme is data: its layouts name exactly which templates and block types they
 * place, so the marketplace reads that off the package at ingest and publishes it
 * with the listing (`usesTemplates` / `usesBlocks`). This is the other half —
 * comparing that footprint against the registries this browser actually holds.
 *
 * It exists because of a behaviour that is correct and still surprising. The
 * importer SKIPS an unknown block or template and keeps everything else, so that
 * disabling a plugin can never delete an admin's arrangement. On a site that
 * merely disabled something, that is exactly right. On a theme bought sixty
 * seconds ago it reads as "I paid for this and half of it did not appear" — so
 * the comparison has to happen before the button, not after.
 */
export interface ThemeGaps {
  /** Block types no registered block answers to. */
  blocks:    string[];
  /** Template keys the registry does not know — a plugin's own page. */
  templates: string[];
}

/**
 * ⚠ Reports TYPES, never a plugin to go and buy. A plugin's id (`nodevo-forum`)
 * and its block namespace (`forum.`) are different strings by design, and the
 * mapping between them lives in that plugin's own registration — which this site
 * does not have, because not having it is the entire problem being reported.
 * Guessing a plugin from a namespace would be inventing an answer; naming the
 * types is the true thing that can be said.
 *
 * ⚠ ABSENT and EMPTY are different answers. An empty footprint means the package
 * was walked and needs nothing beyond core. An absent one means the marketplace
 * never recorded it — a theme published before the footprint existed — and that
 * must not render as an all-clear. Absent yields `null`, the same as "no gaps",
 * because a silent card is the honest output for "we do not know"; the difference
 * matters at the call site only if a future caller wants to say "unknown", and it
 * is preserved here rather than collapsed upstream.
 */
export function themeGaps(footprint: {
  usesTemplates?: string[];
  usesBlocks?:    string[];
}): ThemeGaps | null {
  if (!footprint.usesBlocks || !footprint.usesTemplates) return null;

  const blocks    = footprint.usesBlocks.filter((type) => !getBlock(type));
  const templates = footprint.usesTemplates.filter((key) => !isKnownTemplate(key));

  return blocks.length || templates.length ? { blocks, templates } : null;
}

/**
 * Narrow an import report's `unknownBlocks` to the ones this site truly cannot draw.
 *
 * ⚠⚠ THE TWO REGISTRIES DO NOT AGREE, AND THE SERVER'S IS THE NARROWER ONE.
 *
 * The API's `KNOWN_BLOCKS` is derived from the CORE block catalogue in contracts.
 * Blocks are registered by plugin code in the BROWSER, so the API cannot see a
 * single one of them and reports every plugin block as unknown. That is correct
 * for its own purpose and its own comment says so: an unrecognised type is KEPT,
 * never rejected, so a theme survives the plugin being disabled.
 *
 * Shown to an admin unfiltered, that deliberate over-approximation becomes a false
 * statement — it named a block the forum plugin had registered right there and
 * called it unrenderable while it was on screen. Both surfaces that display the
 * report (the Themes page's manual upload, the marketplace install toast) must run
 * it through the registry this browser actually holds, which is also the registry
 * the pre-purchase card consults. The two answers have to agree; a card promising
 * two gaps and a report announcing three is worse than either alone.
 *
 * `unknownTemplates` needs no equivalent: the server's template registry DOES
 * include plugin-registered templates, and a layout for an unregistered one is
 * genuinely dropped rather than stored.
 */
export function blocksThisSiteCannotDraw(unknownBlocks: readonly string[]): string[] {
  return unknownBlocks.filter((type) => !getBlock(type));
}

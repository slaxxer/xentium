/**
 * Every icon core SHIPS, indexed by its FontAwesome name.
 *
 * ⚠ Assembled from definitions the bundle ALREADY carries — the curated badge glyphs
 * and the layout editor's per-block glyphs. It therefore costs nothing: no new
 * imports, no extra path data. Importing the whole free pack to make a picker
 * searchable would add well over a megabyte of SVG so that an admin can choose
 * roughly eighty things.
 *
 * ⚠ This is the BUNDLED tier, and it is what makes the fallback honest. An icon in
 * here draws on every install, with no kit, forever. An icon outside it needs the
 * site's kit, and the picker says so rather than letting an admin choose something
 * that will silently vanish for their visitors.
 */
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { BADGE_ICONS } from "./badgeIcons";
import { ALL_BLOCK_ICONS } from "../layout/blockIcons";

const index = new Map<string, IconDefinition>();

for (const def of [...Object.values(BADGE_ICONS), ...ALL_BLOCK_ICONS]) {
  // `iconName` is the canonical kebab name (`user-astronaut`), which is exactly the
  // half of a class an icon token stores.
  if (def?.iconName) index.set(def.iconName, def);
}

/** The definition core ships under this name, or undefined. */
export function bundledIcon(name: string): IconDefinition | undefined {
  return index.get(name);
}

/** Every bundled name, sorted — what the picker's grid shows. */
export const BUNDLED_ICON_NAMES: readonly string[] = [...index.keys()].sort();

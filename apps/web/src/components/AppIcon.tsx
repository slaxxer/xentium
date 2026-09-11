/**
 * One icon, from whichever set can draw it.
 *
 * A bundled Free definition wins, because it needs no network and cannot fail. When
 * there is no bundled icon under that name and the site has a FontAwesome kit, the
 * name is handed to the kit as a class instead — which is how an admin with Pro gets
 * Pro icons without a single Pro asset being shipped in the build.
 *
 * Nothing here is required for core to work: with no kit configured, an unknown name
 * simply draws nothing rather than a broken box.
 */
import { FontAwesomeIcon } from "./Icon";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { BADGE_ICONS } from "../lib/badgeIcons";
import { iconKitReady } from "../lib/iconKit";

/**
 * ⚠ A class string reaches the DOM as markup, so the charset is closed: lowercase,
 * digits, hyphen and space. An icon name is admin-supplied, and everything about
 * this component exists to put it on the page.
 */
const SAFE_CLASS = /^[a-z0-9- ]{1,80}$/;

/** `faStar` → `fa-solid fa-star`. Our stored names are the solid free set's. */
function classFor(name: string): string | null {
  // Already a class string — an admin naming a Pro style, e.g. "fa-duotone fa-dragon".
  if (name.startsWith("fa-")) return SAFE_CLASS.test(name) ? name : null;
  if (!/^fa[A-Z][A-Za-z0-9]*$/.test(name)) return null;
  const kebab = name
    .slice(2)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  return `fa-solid fa-${kebab}`;
}

export interface AppIconProps {
  /** Either one of our curated names (`faStar`) or a kit class (`fa-duotone fa-star`). */
  name:       string;
  className?: string;
}

export function AppIcon({ name, className }: AppIconProps) {
  const bundled = (BADGE_ICONS as Record<string, IconDefinition | undefined>)[name];
  if (bundled) return <FontAwesomeIcon icon={bundled} className={className} />;

  if (!iconKitReady()) return null;
  const cls = classFor(name);
  if (!cls) return null;

  /**
   * ⚠ The `<i>` is written as raw HTML so that REACT NEVER OWNS IT.
   *
   * A kit in SVG mode replaces every `fa-` element with an `<svg>` of its own. If
   * React had rendered that `<i>` itself, it would still be holding a reference to
   * a node that is no longer in the tree, and removing the component would throw
   * `NotFoundError` on a child that FontAwesome had already swapped out. Handing
   * React an opaque span sidesteps the whole class of bug, and works unchanged
   * whether the admin's kit is in SVG or web-font mode.
   */
  return <span className={className} dangerouslySetInnerHTML={{ __html: `<i class="${cls}"></i>` }} />;
}

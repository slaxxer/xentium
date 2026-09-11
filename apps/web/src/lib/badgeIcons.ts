/**
 * The curated badge glyphs, mapped from name to icon definition.
 *
 * ⚠ EXPLICIT IMPORTS, deliberately. `import * as icons from "@fortawesome/free-solid-svg-icons"`
 * would let a badge name be looked up directly and would also pull the entire pack
 * into the bundle — a megabyte and a half of SVG paths so that a handful of small
 * pictures can be chosen by string.
 *
 * ⚠ Every name in `BADGE_ICON_NAMES` must appear here. `badgeIcons.test.ts` pins the
 * two together, so a glyph added to the contract and forgotten here fails the build
 * instead of shipping a badge that draws nothing.
 */
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faStar, faTrophy, faMedal, faAward, faCrown, faCertificate,
  faRibbon, faGem, faFire, faBolt, faRocket, faFlag,
  faCode, faTerminal, faBug, faWrench, faHammer, faPen,
  faFeather, faBook, faGraduationCap, faLightbulb, faPalette, faCamera,
  faHeart, faThumbsUp, faComments, faHandshake, faUsers, faUserShield,
  faLifeRing, faHandHoldingHeart, faShieldHalved, faKey,
  faDice, faGamepad, faPuzzlePiece, faChess, faMusic, faGhost,
  faClock, faCalendarCheck, faCompass, faAnchor, faMountain, faSeedling,
  faLeaf, faMugHot,
} from "@fortawesome/free-solid-svg-icons";
import type { BadgeIconName } from "@nodevo/contracts";

export const BADGE_ICONS: Record<BadgeIconName, IconDefinition> = {
  faStar, faTrophy, faMedal, faAward, faCrown, faCertificate,
  faRibbon, faGem, faFire, faBolt, faRocket, faFlag,
  faCode, faTerminal, faBug, faWrench, faHammer, faPen,
  faFeather, faBook, faGraduationCap, faLightbulb, faPalette, faCamera,
  faHeart, faThumbsUp, faComments, faHandshake, faUsers, faUserShield,
  faLifeRing, faHandHoldingHeart, faShieldHalved, faKey,
  faDice, faGamepad, faPuzzlePiece, faChess, faMusic, faGhost,
  faClock, faCalendarCheck, faCompass, faAnchor, faMountain, faSeedling,
  faLeaf, faMugHot,
};

/** The glyph for a stored name, or null when the name is not one we draw. */
export function badgeIcon(name: string | null | undefined): IconDefinition | null {
  if (!name) return null;
  return BADGE_ICONS[name as BadgeIconName] ?? null;
}

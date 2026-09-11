/**
 * Badges (ADR-0009) — awards an admin grants.
 *
 * ⚠ The third meaning of "badge" here, and the only one that is GIVEN. A group
 * badge is membership rendered as a pill; a rank badge is a ladder rung's label.
 * Both are derived from what a user is. This one is not derived from anything.
 */

/**
 * The FontAwesome glyphs a badge may use.
 *
 * ⚠ A CURATED LIST, not "any FontAwesome name", for two reasons that point the same
 * way. The server cannot verify a name against a pack it does not bundle, so an
 * open string field stores typos that render as a silent gap on every card. And the
 * web app maps exactly these to icon definitions with explicit imports — an
 * `import * as icons` to look one up by string would pull the entire pack into the
 * bundle and defeat tree-shaking.
 *
 * Growing the list is one line here and one import in `lib/badgeIcons.ts`. The two
 * are pinned together by a test, so a name added to one and not the other fails
 * the build rather than shipping a blank badge.
 */
export const BADGE_ICON_NAMES = [
  // Achievement
  "faStar", "faTrophy", "faMedal", "faAward", "faCrown", "faCertificate",
  "faRibbon", "faGem", "faFire", "faBolt", "faRocket", "faFlag",
  // Craft
  "faCode", "faTerminal", "faBug", "faWrench", "faHammer", "faPen",
  "faFeather", "faBook", "faGraduationCap", "faLightbulb", "faPalette", "faCamera",
  // Community
  "faHeart", "faThumbsUp", "faComments", "faHandshake", "faUsers", "faUserShield",
  "faLifeRing", "faHandHoldingHeart", "faShieldHalved", "faKey",
  // Play
  "faDice", "faGamepad", "faPuzzlePiece", "faChess", "faMusic", "faGhost",
  // Time and place
  "faClock", "faCalendarCheck", "faCompass", "faAnchor", "faMountain", "faSeedling",
  "faLeaf", "faMugHot",
] as const;

export type BadgeIconName = (typeof BADGE_ICON_NAMES)[number];

export function isBadgeIconName(v: unknown): v is BadgeIconName {
  return typeof v === "string" && (BADGE_ICON_NAMES as readonly string[]).includes(v);
}

/** A badge as the catalogue holds it. */
export interface BadgeRow {
  id:           string;
  key:          string;
  name:         string;
  description:  string | null;
  /** Public URL of the uploaded icon. WINS over `faIcon` when both are set. */
  icon:         string | null;
  faIcon:       string | null;
  color:        string | null;
  displayOrder: number;
  isSystem:     boolean;
  /** How many users hold it. Only the admin listing carries this. */
  holders?:     number;
}

/** A badge as a user card draws it — the catalogue fields plus when it was given. */
export interface AwardedBadge {
  id:          string;
  key:         string;
  name:        string;
  description: string | null;
  icon:        string | null;
  faIcon:      string | null;
  color:       string | null;
  awardedAt:   string;
  /** The admin's reason, when they gave one. Shown in the badge's tooltip. */
  note:        string | null;
}

/** The maximum edge, in pixels, of an uploaded badge icon. */
export const BADGE_ICON_MAX_PX = 32;

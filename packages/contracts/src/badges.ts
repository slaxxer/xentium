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
  faIcon:       string | null;
  color:        string | null;
  displayOrder: number;
  isSystem:     boolean;
  /** Earned against thresholds rather than handed out. */
  autoAward:    boolean;
  /** `{ "articles": 10, "forum.posts": 50 }` — ALL must be met. */
  criteria:     Record<string, number>;
  /** How many users hold it. Only the admin listing carries this. */
  holders?:     number;
}

/**
 * How a member came by a badge.
 *
 * Both are real awards and both are kept until an admin revokes them — the
 * difference is only who decided. `manual` was handed over by a person; `earned`
 * was granted by the reward sweep because the member met the badge's thresholds.
 * Worth distinguishing so an admin looking at a member can tell at a glance which
 * ones they gave.
 */
export type BadgeSource = "manual" | "earned";

/** A badge as a user card draws it — the catalogue fields plus how it was come by. */
export interface AwardedBadge {
  id:          string;
  key:         string;
  name:        string;
  description: string | null;
  faIcon:      string | null;
  color:       string | null;
  awardedAt:   string;
  /** The admin's reason, when they gave one. Shown in the badge's tooltip. */
  note:        string | null;
  source:      BadgeSource;
}


/** A thing a badge can be earned for, as the ACP offers it. */
export interface BadgeMetricInfo {
  key:   string;
  label: string;
  /** The plugin that contributes it, or null for one of core's own. */
  plugin: string | null;
}

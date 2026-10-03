/**
 * A glyph per block type, for the structure tree and the block library.
 *
 * Why a lookup here rather than an `icon` on every `registerBlock` call: a core block
 * would then carry a presentational detail of ONE surface (the ACP editor) into the
 * renderer's own contract, and sixty registrations would each need editing to add a
 * field none of them render. The registry says what a block IS; this says how the
 * editor draws it in a list.
 *
 * ⚠ A missing entry is not a bug. `iconFor` falls back to the block's CATEGORY, so a
 * plugin block — which cannot appear in this file — still gets a sensible glyph, and
 * a core block added later looks unremarkable rather than broken. A plugin that wants
 * its own supplies `editorMeta.icon`, which wins over both.
 */
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faCopyright, faLink, faAward, faEye, faHeart, faImagePortrait, faMedal,
  faAlignLeft, faAt, faBars, faBell, faBolt, faBoxesStacked, faChartSimple,
  faCircleHalfStroke, faCircleInfo, faCircleUser, faClipboardList, faColumns,
  faComments, faFeather, faFileLines, faFlag, faFolderTree, faGaugeHigh, faGripLines,
  faHeading, faIdBadge, faImage, faLayerGroup, faListCheck, faMagnifyingGlass,
  faNewspaper, faPeopleGroup, faPuzzlePiece, faRankingStar, faRectangleAd, faShieldHalved,
  faSliders, faSquare, faTableCells, faTag, faTrophy, faUser, faUserGroup, faUsers,
  faWindowMaximize, faWindowMinimize,
} from "@fortawesome/free-solid-svg-icons";
import { getBlock } from "./blockRegistry";

/** The fallback: what a block of this KIND looks like when nothing more is known. */
const BY_CATEGORY: Record<string, IconDefinition> = {
  structure: faLayerGroup,
  content:   faAlignLeft,
  data:      faTableCells,
  plugin:    faPuzzlePiece,
};

const BY_TYPE: Record<string, IconDefinition> = {
  // structure
  section: faSquare,
  columns: faColumns,
  column: faColumns,
  spacer: faGripLines,
  // chrome
  header: faWindowMaximize,
  footer: faWindowMinimize,
  navbar: faBars,
  branding: faFlag,
  footerBar: faCopyright,
  footerLinks: faLink,
  footerText: faCopyright,
  logo: faFlag,
  navLinks: faBars,
  search: faMagnifyingGlass,
  themeToggle: faCircleHalfStroke,
  headerWidgets: faBoxesStacked,
  notifications: faBell,
  adminLink: faShieldHalved,
  userMenu: faCircleUser,
  whosOnline: faUsers,
  groupLegend: faUserGroup,
  boardStats: faChartSimple,
  doc: faCircleInfo,
  // content
  heading: faHeading,
  eyebrow: faTag,
  text: faAlignLeft,
  paragraph: faAlignLeft,
  richText: faFeather,
  image: faImage,
  // data
  articleIndex: faTableCells,
  articleDetail: faNewspaper,
  pluginSlot: faPuzzlePiece,
  // profile
  profileCard: faIdBadge,
  profileAvatar: faCircleUser,
  profileIdentity: faAt,
  profileStats: faChartSimple,
  profileActions: faSliders,
  profileBio: faAlignLeft,
  profileTabs: faFolderTree,
  profileContent: faFileLines,
  // members
  membersList: faPeopleGroup,
  membersTabs: faFolderTree,
  membersFilters: faListCheck,
  membersPodium: faTrophy,
  membersHofStats: faRankingStar,
  membersTeam: faShieldHalved,
  membersHowTo: faClipboardList,
  // home / guest landing
  guestSurface: faRectangleAd,
  guestHero: faBolt,
  guestHeroText: faHeading,
  guestPresence: faUsers,
  guestBody: faLayerGroup,
  guestFeed: faComments,
  guestRail: faColumns,
  homeProgression: faGaugeHigh,
  homeFeed: faComments,
  homeHotThreads: faComments,
  homePopularTags: faTag,
  homeSuggestedPeople: faUser,
  homeYourCard: faIdBadge,
  homeSectionNav: faFolderTree,
  homeSpaces: faBoxesStacked,
  homeMeCard: faIdBadge,
  // profile pieces
  profileCover: faImagePortrait,
  profileRank: faMedal,
  profileBadges: faAward,
  profileVisitors: faEye,
  profileFollowers: faHeart,
};

/**
 * Every definition this file imports, for the icon catalogue to index by name.
 *
 * ⚠ Derived from the two maps rather than listed again — a third list would drift,
 * and the point of exporting this is that these glyphs are ALREADY in the bundle, so
 * the picker can offer them for nothing.
 */
export const ALL_BLOCK_ICONS: readonly IconDefinition[] =
  [...Object.values(BY_CATEGORY), ...Object.values(BY_TYPE)];

/**
 * The glyph for a block type.
 *
 * `editorMeta.icon` first (a plugin's own choice), then this file, then the block's
 * category. A type nothing knows about — a layout naming a block whose plugin is
 * disabled — still draws, as a puzzle piece, because the row has to render either way.
 */
/** The block types with a glyph of their own (tests check core has one each). */
export const ICON_TYPES: readonly string[] = Object.keys(BY_TYPE);

export function iconFor(type: string): IconDefinition {
  const def = getBlock(type);
  const own = def?.editorMeta?.icon;
  if (own) return own;
  const byType = BY_TYPE[type];
  if (byType) return byType;
  return BY_CATEGORY[def?.editorMeta?.category ?? "plugin"] ?? faPuzzlePiece;
}

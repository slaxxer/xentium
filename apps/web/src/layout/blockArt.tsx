/**
 * The little abstract drawing on a block's catalogue card.
 *
 * Not a screenshot and not an icon. A screenshot would be a lie — a block's real
 * appearance depends on the site's tokens, its variant and what data it has, and
 * rendering one here would also mean mounting a block outside its host container.
 * An icon is already on the row and the tile. What the card needs is SHAPE: whether
 * a block is a full-width band, a pair of tracks, a run of text, a grid of things or
 * a list of them, which is the question someone browsing a catalogue is asking.
 *
 * So each card draws primitives in the accent, keyed by a shape the block declares
 * or, failing that, one derived from what it is. Same fallback discipline as
 * `blockIcons.ts`: a plugin block nothing knows about still draws something honest.
 */
import { getBlock } from "./blockRegistry";

export type BlockShape =
  | "stack"    // a band across the page, with body under it
  | "columns"  // two tracks, one wide one narrow
  | "text"     // lines of prose
  | "grid"     // a set of cards
  | "list"     // rows with a leading avatar
  | "media"    // a picture
  | "chip";    // a small control — a toggle, a search box, a menu

const BY_TYPE: Record<string, BlockShape> = {
  section: "stack",
  columns: "columns",
  column: "columns",
  spacer: "chip",
  header: "stack",
  footer: "stack",
  navbar: "chip",
  branding: "chip",
  footerBar: "chip",
  footerLinks: "chip",
  footerText: "text",
  logo: "media",
  navLinks: "chip",
  search: "chip",
  themeToggle: "chip",
  notifications: "chip",
  modTool: "chip",
  adminLink: "chip",
  userMenu: "chip",
  headerWidgets: "chip",
  heading: "text",
  eyebrow: "text",
  text: "text",
  paragraph: "text",
  richText: "text",
  image: "media",
  articleIndex: "grid",
  articleDetail: "text",
  membersList: "list",
  membersPodium: "grid",
  membersTeam: "list",
  whosOnline: "list",
  groupLegend: "list",
  boardStats: "grid",
  profileCard: "stack",
  profileContent: "text",
  profileTabs: "chip",
  profileStats: "grid",
  guestHero: "stack",
  guestFeed: "list",
  guestRail: "columns",
  guestBody: "columns",
  homeFeed: "list",
  homeHotThreads: "list",
  homeSuggestedPeople: "list",
  homePopularTags: "chip",
  homeYourCard: "stack",
  homeMeCard: "stack",
  homeSectionNav: "chip",
  homeSpaces: "grid",
  homeProgression: "chip",
  pluginSlot: "chip",
  membersTabs: "chip",
  membersFilters: "chip",
  membersHofStats: "grid",
  membersHowTo: "text",
  guestSurface: "stack",
  guestHeroText: "text",
  guestPresence: "list",
  profileAvatar: "media",
  profileCover: "media",
  profileRank: "chip",
  profileBadges: "chip",
  profileVisitors: "list",
  profileFollowers: "list",
  profileIdentity: "text",
  profileActions: "chip",
  profileBio: "text",
};

/** What KIND of thing a block looks like, when nothing more specific is known. */
const BY_CATEGORY: Record<string, BlockShape> = {
  structure: "stack",
  content: "text",
  data: "grid",
  plugin: "grid",
};

/** The block types with a picture of their own (tests check core has one each). */
export const SHAPE_TYPES: readonly string[] = Object.keys(BY_TYPE);

export function shapeFor(type: string): BlockShape {
  const byType = BY_TYPE[type];
  if (byType) return byType;
  const category = getBlock(type)?.editorMeta?.category;
  return BY_CATEGORY[category ?? "plugin"] ?? "grid";
}

/**
 * The drawing itself — plain elements, no SVG.
 *
 * Every bar is a token colour, so the artwork follows the ACP's own palette in both
 * themes instead of being a picture that only suits one of them.
 */
export function BlockArt({ type }: { type: string }) {
  const shape = shapeFor(type);
  return (
    <span className={`xt-art xt-art--${shape}`} aria-hidden="true">
      {shape === "stack" && (<><i className="xt-art__bar" /><i className="xt-art__fill" /></>)}
      {shape === "columns" && (<><i className="xt-art__wide" /><i className="xt-art__narrow" /></>)}
      {shape === "text" && (<><i className="xt-art__line xt-art__line--head" /><i className="xt-art__line" /><i className="xt-art__line" /><i className="xt-art__line xt-art__line--short" /></>)}
      {shape === "grid" && (<><i className="xt-art__cell" /><i className="xt-art__cell" /><i className="xt-art__cell" /><i className="xt-art__cell" /></>)}
      {shape === "list" && ([0, 1, 2].map((i) => (
        <span className="xt-art__row" key={i}><i className="xt-art__dot" /><i className="xt-art__line" /></span>
      )))}
      {shape === "media" && <i className="xt-art__media" />}
      {shape === "chip" && (<><i className="xt-art__pill" /><i className="xt-art__pill xt-art__pill--dim" /></>)}
    </span>
  );
}

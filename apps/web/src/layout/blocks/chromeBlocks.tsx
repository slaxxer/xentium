/**
 * Site-chrome blocks (ADR-0005 Amendment 1).
 *
 * The navbar and footer, element by element, so an admin can rearrange them —
 * logo position, whether search sits centre or right, whether "who's online"
 * comes before or after the group legend.
 *
 * Two rules run through all of it:
 *
 *  - **Each block owns its own visibility.** `userMenu` shows an avatar when
 *    signed in and sign-in buttons when not; `notifications` renders nothing for
 *    guests. The admin arranges WHERE a block sits, never WHETHER it appears —
 *    otherwise a header could be built that is empty for the visitors who most
 *    need it, and we would need one document per auth state.
 *  - **Markup is moved, not rewritten.** Each block renders the same JSX the
 *    hardcoded component did, so the shipped defaults are byte-identical to what
 *    the site looked like before the layout system touched it.
 */
import { blockPropSchemas, blockTypesIn } from "@xentium/contracts";
import { registerBlock, type BlockProps } from "../blockRegistry";
import { individuallyPlacedSlotIds } from "../slotBlocks";
import { useRenderedDocument } from "../LayoutRenderer";
import { slotRegistry } from "../../plugins/slotRegistry";
import {
  NavLogo, NavPrimaryLinks, NavSearchBlock, NavThemeToggle,
  NavNotifications, NavAdminLink, NavUserMenu,
} from "../../layouts/PubNav";
import {
  FooterWhosOnline, FooterGroupLegend, FooterBoardStats, FooterBranding,
} from "../../layouts/SiteFooter";
import { sectionBackground } from "./coreBlocks";
import "./chromeBlocks.scss";

const CHROME_HEADER = ["chrome.header"];
const CHROME_FOOTER = ["chrome.footer"];

// ── Header ──────────────────────────────────────────────────────────────────

/**
 * The nav strip — a row, and a container whose children are what is in it.
 *
 * It renders the markup `PubNav` used to render inline, so the shipped default looks
 * exactly as it did when the navbar was a template with three regions. What changed
 * is WHERE the arrangement lives: a child's `align` says which end of the row it sits
 * at, replacing region membership.
 *
 * ⚠ The children are rendered by the layout renderer, not by this component — it
 * receives them already wrapped, so a child's `align` cannot be read here. The row is
 * laid out in CSS from `[data-nv-align]`, which `RenderNode` stamps on the wrapper;
 * that also keeps a plugin's block alignable without it knowing anything about us.
 */
/**
 * THE HEADER — the band, and the logo in it.
 *
 * One block rather than a `section` an admin has to assemble (full width, a height,
 * two colour stops, a `logo` dropped inside): this is the site's most recognisable
 * element and it should be one thing with four settings. `section` is still there for
 * every OTHER band; what makes this one different is that it is the header.
 *
 * ⚠ `height` is a FLOOR (`min-height`). A translated site name, a bigger font from an
 * accessibility setting or a taller logo must push the band, never be clipped by it.
 *
 * ⚠ The inner column matches `.nv-region` and `.pub-nav__inner` exactly, which is
 * what puts the masthead logo directly above the navbar's own instead of a few pixels
 * off. Those numbers live in `chromeBlocks.scss` next to the rule that uses them.
 */
function SiteHeaderBlock({ props }: BlockProps<{
  height?: number; showLogo?: boolean; showWordmark?: boolean;
  backgroundImage?: string; backgroundGradient?: string[]; backgroundAngle?: number;
}>) {
  const background = sectionBackground(props);
  return (
    <div
      className={`nv-header${background ? " nv-header--bg" : ""}`}
      style={{
        minHeight: `${props.height ?? 250}px`,
        ...(background ? { backgroundImage: background } : {}),
      }}
    >
      {props.showLogo !== false && (
        <div className="nv-header__inner">
          <NavLogo showWordmark={props.showWordmark !== false} />
        </div>
      )}
    </div>
  );
}

registerBlock({
  type:      "header",
  schema:    blockPropSchemas.header,
  editorMeta: { label: "Header", category: "structure", allowedTemplates: CHROME_HEADER },
  component: SiteHeaderBlock,
});

registerBlock({
  type:      "navbar",
  schema:    blockPropSchemas.navbar,
  container: true,
  editorMeta: { label: "Navbar", category: "structure", allowedTemplates: CHROME_HEADER },
  component: ({ children }: BlockProps<Record<string, never>>) => (
    <nav className="pub-nav">
      <div className="pub-nav__inner">{children}</div>
    </nav>
  ),
});

registerBlock({
  type:   "logo",
  schema: blockPropSchemas.logo,
  editorMeta: { label: "Logo", category: "structure", allowedTemplates: CHROME_HEADER },
  component: ({ props }: BlockProps<{ showWordmark: boolean }>) =>
    <NavLogo showWordmark={props.showWordmark} />,
});

registerBlock({
  type:   "navLinks",
  schema: blockPropSchemas.navLinks,
  editorMeta: { label: "Navigation links", category: "content", allowedTemplates: CHROME_HEADER },
  component: () => <NavPrimaryLinks />,
});

registerBlock({
  type:   "search",
  schema: blockPropSchemas.search,
  editorMeta: { label: "Search", category: "content", allowedTemplates: CHROME_HEADER },
  component: ({ props }: BlockProps<{ expanded: boolean }>) => <NavSearchBlock expanded={props.expanded} />,
});

registerBlock({
  type:   "themeToggle",
  schema: blockPropSchemas.themeToggle,
  editorMeta: { label: "Light/dark toggle", category: "content", allowedTemplates: CHROME_HEADER },
  component: () => <NavThemeToggle />,
});

registerBlock({
  type:   "notifications",
  schema: blockPropSchemas.notifications,
  editorMeta: { label: "Notification bell", category: "content", allowedTemplates: CHROME_HEADER },
  component: () => <NavNotifications />,
});

registerBlock({
  type:   "adminLink",
  schema: blockPropSchemas.adminLink,
  editorMeta: { label: "Admin panel link", category: "content", allowedTemplates: CHROME_HEADER },
  component: () => <NavAdminLink />,
});

registerBlock({
  type:   "headerWidgets",
  schema: blockPropSchemas.headerWidgets,
  editorMeta: { label: "Plugin icons", category: "plugin", allowedTemplates: CHROME_HEADER },
  // Compatibility path: renders every `registerHeaderWidget` in one place, so
  // plugins that already inject a navbar item (messaging's inbox bell) keep
  // working untouched.
  //
  // Each widget ALSO exists as its own block now (`layout/slotBlocks.tsx`), which is
  // how an admin positions one independently. Rendering it in both places would show
  // it twice, so this cluster skips whatever the document already places on its own —
  // making the two mechanisms alternatives rather than a duplication hazard.
  component: () => {
    // The document from context, not a fresh lookup by key: in the editor's preview
    // the unsaved document is what is on screen, and a lookup would consult the saved
    // one and disagree with what the admin is looking at.
    const doc = useRenderedDocument();
    const placed = individuallyPlacedSlotIds(doc ? blockTypesIn(doc) : [], "headerWidget");
    return (
      <>
        {slotRegistry.getHeaderWidgets()
          .filter((w) => !placed.has(w.id))
          .map((w) => <w.component key={w.id} />)}
      </>
    );
  },
});

registerBlock({
  type:   "userMenu",
  schema: blockPropSchemas.userMenu,
  editorMeta: { label: "Account menu", category: "content", allowedTemplates: CHROME_HEADER },
  component: () => <NavUserMenu />,
});

// ── Footer ──────────────────────────────────────────────────────────────────

/**
 * THE FOOTER — the band, and everything in it.
 *
 * A CONTAINER, unlike the header's band: the masthead sits above the navbar and is a
 * block of its own, while the footer's band IS what holds its pieces. Painting them
 * onto it means they are its children, not its siblings.
 *
 * ⚠ The class is `.nv-foot` and must stay `.nv-foot` — it is `SCOPE_SELECTOR.footer`,
 * so the Style Editor's entire Footer section is emitted under it. The background
 * here is drawn OVER `--footer-bg` (which that panel sets) rather than instead of it:
 * a footer with no gradient of its own keeps whatever the Style Editor gave it, so
 * adopting this block changes nothing about how an existing site looks.
 */
function SiteFooterBlock({ props, children }: BlockProps<{
  minHeight?: number; showTopBorder?: boolean;
  backgroundImage?: string; backgroundGradient?: string[]; backgroundAngle?: number;
}> ) {
  const background = sectionBackground(props);
  const classes = [
    "nv-foot",
    background ? "nv-foot--bg" : "",
    props.showTopBorder === false ? "nv-foot--noline" : "",
  ].filter(Boolean).join(" ");
  return (
    <div
      className={classes}
      style={{
        ...(props.minHeight ? { minHeight: `${props.minHeight}px` } : {}),
        ...(background ? { backgroundImage: background } : {}),
      }}
    >
      {/* ⚠ The band is FULL WIDTH and the column is inside it — the same shape as
          `.nv-header` / `.nv-header__inner`. The band has to reach the edges of the
          window for a background to mean anything, and its contents have to line up
          with the page above it; one element cannot do both. */}
      <div className="nv-foot__inner">{children}</div>
    </div>
  );
}

registerBlock({
  type:      "footer",
  schema:    blockPropSchemas.footer,
  container: true,
  editorMeta: { label: "Footer", category: "structure", allowedTemplates: CHROME_FOOTER },
  component: SiteFooterBlock,
});

registerBlock({
  type:   "whosOnline",
  schema: blockPropSchemas.whosOnline,
  editorMeta: { label: "Who's online", category: "data", allowedTemplates: CHROME_FOOTER },
  component: ({ props }: BlockProps<{ maxNames: number }>) => <FooterWhosOnline maxNames={props.maxNames} />,
});

registerBlock({
  type:   "groupLegend",
  schema: blockPropSchemas.groupLegend,
  editorMeta: { label: "Group legend", category: "data", allowedTemplates: CHROME_FOOTER },
  component: () => <FooterGroupLegend />,
});

registerBlock({
  type:   "boardStats",
  schema: blockPropSchemas.boardStats,
  editorMeta: { label: "Board stats", category: "data", allowedTemplates: CHROME_FOOTER },
  component: () => <FooterBoardStats />,
});

registerBlock({
  type:   "branding",
  schema: blockPropSchemas.branding,
  editorMeta: { label: "Copyright & uptime", category: "content", allowedTemplates: CHROME_FOOTER },
  component: ({ props }: BlockProps<{ showUptime: boolean; showThemeChooser: boolean }>) =>
    <FooterBranding showUptime={props.showUptime} showThemeChooser={props.showThemeChooser} />,
});

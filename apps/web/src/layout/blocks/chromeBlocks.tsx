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
import { blockPropSchemas, blockTypesIn } from "@nodevo/contracts";
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

const CHROME_HEADER = ["chrome.header"];
const CHROME_FOOTER = ["chrome.footer"];

// ── Header ──────────────────────────────────────────────────────────────────

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
  component: ({ props }: BlockProps<{ showUptime: boolean }>) => <FooterBranding showUptime={props.showUptime} />,
});

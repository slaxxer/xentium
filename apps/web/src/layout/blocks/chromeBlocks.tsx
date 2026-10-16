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
import { Children, isValidElement, type ReactNode } from "react";
import { blockPropSchemas, blockTypesIn, type BlockNode, type LayoutDocument } from "@xentium/contracts";
import i18n from "i18next";
import { registerBlock, type BlockProps } from "../blockRegistry";
import { individuallyPlacedSlotIds } from "../slotBlocks";
import { useRenderedDocument } from "../LayoutRenderer";
import { slotRegistry } from "../../plugins/slotRegistry";
import {
  NavLogo, NavPrimaryLinks, NavSearchBlock,
  NavNotifications, NavModTool, NavAdminLink, NavUserMenu,
} from "../../layouts/PubNav";
import {
  FooterWhosOnline, FooterGroupLegend, FooterBoardStats, FooterBranding, FooterLinks, FooterText, FooterBar,
} from "../../layouts/SiteFooter";
import { sectionBackground } from "./coreBlocks";
import { isEditorPreview } from "../previewMode";
import { useSiteConfig } from "../../hooks/useSiteConfig";
import "./chromeBlocks.scss";
import { MemberWidget } from "../../components/MembersOnly";

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
 * laid out in CSS from `[data-xt-align]`, which `RenderNode` stamps on the wrapper;
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
 * ⚠ The inner column matches `.xt-region` and `.pub-nav__inner` exactly, which is
 * what puts the masthead logo directly above the navbar's own instead of a few pixels
 * off. Those numbers live in `chromeBlocks.scss` next to the rule that uses them.
 */
/** The node a rendered child came from — `RenderNode` elements carry it as a prop. */
const childNode = (child: ReactNode): BlockNode | undefined =>
  isValidElement<{ node?: BlockNode }>(child) ? child.props.node : undefined;

/** The masthead's account buttons — what "Buttons: Log in / account menu" switches. */
const ACCOUNT_TYPES = new Set(["userMenu", "modTool", "notifications", "headerWidgets", "adminLink"]);

function SiteHeaderBlock({ props, children }: BlockProps<{
  height?: number; showLogo?: boolean; showWordmark?: boolean;
  showMasthead?: boolean; logoAlign?: "left" | "center"; showTagline?: boolean; showButtons?: boolean;
  backgroundMode?: "image" | "gradient";
  backgroundImage?: string; backgroundGradient?: string[]; backgroundAngle?: number;
}>) {
  const { data: config } = useSiteConfig();
  // Image mode draws the image over the gradient (which shows until one is chosen);
  // gradient mode draws the gradient alone. Both values are kept either way.
  const background = sectionBackground({
    ...props,
    backgroundImage: props.backgroundMode === "image" ? props.backgroundImage : "",
  });

  /*
   * Hidden masthead: nothing on the site — the navbar carries the logo and account
   * actions instead. In the editor a slim marker stays, or the block could not be
   * clicked to switch it back on.
   */
  if (props.showMasthead === false) {
    return isEditorPreview() ? <div className="xt-header xt-header--hidden">{i18n.t("common:blockRender.mastheadHidden")}</div> : null;
  }

  // The logo is the brand; everything else placed in the header is the action group.
  const all = Children.toArray(children);
  const logos = all.filter((c) => childNode(c)?.type === "logo");
  // Buttons off: the account buttons leave the masthead (the navbar draws them).
  const actions = all.filter((c) => {
    const type = childNode(c)?.type;
    return type !== "logo" && !(props.showButtons === false && type && ACCOUNT_TYPES.has(type));
  });
  // A header from before it was a container draws its own logo.
  const legacyLogo = logos.length === 0 && props.showLogo !== false;
  const tagline = props.showTagline ? config?.siteTagline?.trim() : "";
  const centered = props.logoAlign === "center";

  return (
    <div
      className={`xt-header${background ? " xt-header--bg" : ""}${centered ? " xt-header--center" : ""}`}
      data-bg={props.backgroundMode ?? "gradient"}
      style={{
        minHeight: `${props.height ?? 250}px`,
        ...(background ? { backgroundImage: background } : {}),
      }}
    >
      <div className="xt-header__inner">
        <div className="xt-header__brand">
          {logos}
          {legacyLogo && <NavLogo showWordmark={props.showWordmark !== false} />}
          {tagline && <p className="xt-header__tagline">{tagline}</p>}
        </div>
        {actions.length > 0 && <div className="xt-header__actions">{actions}</div>}
      </div>
    </div>
  );
}

registerBlock({
  type:      "header",
  schema:    blockPropSchemas.header,
  container: true,
  editorMeta: { surface: true, label: "Header", category: "structure", allowedTemplates: CHROME_HEADER },
  component: SiteHeaderBlock,
});

/** The chrome's `header` block, wherever it sits. */
function findHeader(doc: LayoutDocument | null | undefined): BlockNode | undefined {
  const walk = (nodes: BlockNode[]): BlockNode | undefined => {
    for (const n of nodes) {
      if (n.type === "header") return n;
      const hit = n.children && walk(n.children);
      if (hit) return hit;
    }
    return undefined;
  };
  return doc ? walk(Object.values(doc.regions).flat()) : undefined;
}

/**
 * What the navbar draws on the masthead's behalf while it is hidden. Plain components,
 * not blocks: these are stand-ins for blocks that live in the header, and they go
 * away the moment the masthead is back.
 */
const CARRIED: Record<string, () => ReactNode> = {
  search:        () => <NavSearchBlock expanded={false} />,
  headerWidgets: () => <MemberWidget>{slotRegistry.getHeaderWidgets().map((w) => <w.component key={w.id} />)}</MemberWidget>,
  modTool:       () => <NavModTool />,
  notifications: () => <BellBlock />,
  adminLink:     () => <NavAdminLink />,
  userMenu:      () => <NavUserMenu />,
};

function NavbarBlock({ props, children }: BlockProps<{
  sticky?: boolean; height?: number; tone?: "theme" | "dark" | "brand" | "light";
}>) {
  // The document from context, like `headerWidgets`: in the editor the unsaved one is
  // on screen, and this has to agree with it.
  const doc = useRenderedDocument();
  const header = findHeader(doc);
  const hp = (header?.props ?? {}) as { showMasthead?: boolean; showButtons?: boolean };
  const mastheadShown = !!header && hp.showMasthead !== false;
  const buttonsShown = mastheadShown && hp.showButtons !== false;

  const own = new Set(Children.toArray(children).map((c) => childNode(c)?.type).filter(Boolean));
  // Masthead hidden (or deleted): the small logo is forced on…
  const needLogo = !mastheadShown && !own.has("logo");
  // …and whatever the masthead held comes down into the strip: everything when it is
  // hidden, the account buttons when only they are switched off.
  //
  // The account menu comes down WITH the icons it holds, in its order, avatar last:
  // each piece is listed with the masthead child it belongs to (`of`), which is what
  // the buttons switch and the navbar's own copy are checked against.
  const pieces = (header?.children ?? []).flatMap((n) => n.type === "userMenu"
    ? [...(n.children ?? []).map((c) => ({ t: c.type, of: n.type })), { t: n.type, of: n.type }]
    : [{ t: n.type, of: n.type }]);
  const carried = [...new Set(pieces
    .filter(({ t, of }) => CARRIED[t] && !own.has(t) && !own.has(of)
      && (!mastheadShown || (!buttonsShown && ACCOUNT_TYPES.has(of))))
    .map(({ t }) => t))];

  const classes = [
    "pub-nav",
    props.sticky === false && "pub-nav--static",
    props.tone && props.tone !== "theme" && `pub-nav--tone-${props.tone}`,
  ].filter(Boolean).join(" ");

  return (
    <nav className={classes} style={props.height ? { ["--nav-height" as string]: `${props.height}px` } : undefined}>
      <div className="pub-nav__inner">
        {needLogo && <NavLogo showWordmark />}
        {children}
        {carried.length > 0 && (
          <div className="pub-nav__carried">
            {carried.map((t) => <span key={t} className="pub-nav__carried-item">{CARRIED[t]!()}</span>)}
          </div>
        )}
      </div>
    </nav>
  );
}

registerBlock({
  type:      "navbar",
  schema:    blockPropSchemas.navbar,
  container: true,
  editorMeta: { surface: true, label: "Navbar", category: "structure", allowedTemplates: CHROME_HEADER },
  component: NavbarBlock,
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

/**
 * The bell — and, for a header that does not place a `modTool` block, the moderation
 * shield beside it.
 *
 * The shield used to be part of this block. Saved headers and the layouts themes ship
 * were written then, so a document that has no `modTool` of its own keeps getting the
 * shield here; once one is placed, this is the bell alone. Same rule as `headerWidgets`
 * and the plugin icons placed on their own: never both, never neither.
 */
function BellBlock({ icon }: { icon?: string } = {}) {
  // The document from context: in the editor the unsaved one is on screen.
  const doc = useRenderedDocument();
  const placesModTool = !!doc && blockTypesIn(doc).has("modTool");
  return <NavNotifications withModTool={!placesModTool} icon={icon} />;
}

registerBlock({
  type:   "modTool",
  schema: blockPropSchemas.modTool,
  editorMeta: { label: "Moderation tool", category: "content", allowedTemplates: CHROME_HEADER },
  component: ({ props }: BlockProps<{ icon?: string }>) => <NavModTool icon={props.icon} />,
});

registerBlock({
  type:   "notifications",
  schema: blockPropSchemas.notifications,
  editorMeta: { label: "Notification bell", category: "content", allowedTemplates: CHROME_HEADER },
  component: ({ props }: BlockProps<{ icon?: string }>) => <BellBlock icon={props.icon} />,
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
      <MemberWidget>
        {slotRegistry.getHeaderWidgets()
          .filter((w) => !placed.has(w.id))
          .map((w) => <w.component key={w.id} />)}
      </MemberWidget>
    );
  },
});

/**
 * The account menu — and the member's icons, which are ITS children: the moderation
 * tool, the bell, plugin icons, the admin link, search. They are drawn in one row
 * with the avatar last, so the menu is one block to place, not six siblings that
 * happened to share the masthead's pill. A guest sees whatever of them is for guests
 * (search), then Log in.
 */
registerBlock({
  type:      "userMenu",
  schema:    blockPropSchemas.userMenu,
  container: true,
  editorMeta: { label: "Account menu", category: "content", allowedTemplates: CHROME_HEADER },
  component: ({ children }) => (
    <div className="xt-account">
      {children}
      <NavUserMenu />
    </div>
  ),
});

// ── Footer ──────────────────────────────────────────────────────────────────

/**
 * THE FOOTER — the band, and everything in it.
 *
 * A CONTAINER, unlike the header's band: the masthead sits above the navbar and is a
 * block of its own, while the footer's band IS what holds its pieces. Painting them
 * onto it means they are its children, not its siblings.
 *
 * ⚠ The class is `.xt-foot` and must stay `.xt-foot` — it is `SCOPE_SELECTOR.footer`,
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
    "xt-foot",
    background ? "xt-foot--bg" : "",
    props.showTopBorder === false ? "xt-foot--noline" : "",
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
          `.xt-header` / `.xt-header__inner`. The band has to reach the edges of the
          window for a background to mean anything, and its contents have to line up
          with the page above it; one element cannot do both. */}
      <div className="xt-foot__inner">{children}</div>
    </div>
  );
}

registerBlock({
  type:      "footer",
  schema:    blockPropSchemas.footer,
  container: true,
  editorMeta: { surface: true, label: "Footer", category: "structure", allowedTemplates: CHROME_FOOTER },
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
  type:   "footerBar",
  schema: blockPropSchemas.footerBar,
  editorMeta: { label: "Footer bar", category: "content", allowedTemplates: CHROME_FOOTER },
  component: ({ props }: BlockProps<{ showUptime: boolean; showThemeChooser: boolean }>) =>
    <FooterBar showUptime={props.showUptime} showThemeChooser={props.showThemeChooser} />,
});

// Superseded by `footerBar`: still render where stored, no longer offered.
registerBlock({
  type:   "footerLinks",
  schema: blockPropSchemas.footerLinks,
  editorMeta: { label: "Footer links", category: "content", allowedTemplates: CHROME_FOOTER, retired: true },
  component: ({ props }: BlockProps<{ showThemeChooser: boolean }>) =>
    <FooterLinks showThemeChooser={props.showThemeChooser} />,
});

registerBlock({
  type:   "footerText",
  schema: blockPropSchemas.footerText,
  editorMeta: { label: "Footer text", category: "content", allowedTemplates: CHROME_FOOTER, retired: true },
  component: ({ props }: BlockProps<{ showUptime: boolean }>) => <FooterText showUptime={props.showUptime} />,
});

registerBlock({
  type:   "branding",
  schema: blockPropSchemas.branding,
  // Superseded by `footerLinks` + `footerText`.
  editorMeta: { label: "Copyright & uptime", category: "content", allowedTemplates: CHROME_FOOTER, retired: true },
  component: ({ props }: BlockProps<{ showUptime: boolean; showThemeChooser: boolean }>) => (
    <FooterBranding showUptime={props.showUptime} showThemeChooser={props.showThemeChooser} />
  ),
});

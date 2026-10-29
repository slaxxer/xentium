import type { ComponentType, ReactNode } from "react";
import { forgetConsentFor } from "../lib/consent";

// ── Editor panel (a tab beside Details in a content editor, e.g. the SEO plugin's) ─
/** What the editor knows about the content being written, kept current as you type. */
export interface EditorDraft {
  title: string;
  slug: string | null;
  excerpt: string;
  /** The body as plain text. */
  text: string;
  firstParagraph: string;
  headings: string[];
  wordCount: number;
  /** Links in the body that point at this site (`/…` or the site's own address). */
  internalLinks: number;
  images: number;
  imagesWithoutAlt: number;
  coverUrl: string | null;
}
export interface EditorPanelProps {
  contentKind: string;
  /** Null until the content has been saved once. */
  contentId: string | null;
  draft: EditorDraft;
  /** A short label on the panel's tab (a score), or null for none. */
  setBadge: (badge: { label: string; tone: "good" | "fair" | "bad" } | null) => void;
}
export interface EditorPanelSlot {
  id: string;
  /** Which editor it joins: `article` (core's), or a plugin's content kind. */
  contentKind: string;
  label: string;
  order?: number;
  component: ComponentType<EditorPanelProps>;
}

// ── Profile tab (registered by plugins, rendered in /u/:username) ─────────────
export interface ProfileTabSlot {
  id: string;
  label: string;
  component: ComponentType<{ profileId: string; profileUsername: string; isOwn: boolean }>;
}

// ── Account settings section ──────────────────────────────────────────────────
export interface AccountSectionSlot {
  id: string;
  label: string;
  component: ComponentType;
}

// ── Account tab ───────────────────────────────────────────────────────────────
/**
 * A tab of its own on the member's Account page (`/account?tab=<id>`), listed in
 * the account menu after core's tabs, under its `group` heading. For a plugin
 * whose member pages belong with the account (a shop's licences and invoices),
 * so it never builds an account area of its own.
 *
 * `id` is namespaced (`store.licences`) and is the tab's URL value. `permission`
 * hides the tab from members without it (a hint: the plugin's endpoints check
 * again). `keywords` feed the account menu's search.
 */
export interface AccountTabSlot {
  id: string;
  /** A getter may translate it at render. */
  label: string;
  /** FontAwesome IconDefinition. */
  icon?: unknown;
  /** Heading the tab is listed under; tabs sharing one are grouped. Absent = no heading. */
  group?: string;
  /** Lower renders higher, within the plugin tabs. */
  order?: number;
  permission?: string;
  keywords?: string;
  component: ComponentType;
}

// ── Sign-up field ─────────────────────────────────────────────────────────────
/**
 * An add-on's own field on the sign-up form (core 1.0.0). Its value is sent as
 * `addons["<pluginId>"]`; the add-on checks it in its `registration.validate`
 * filter and stores it in its `user.registered` listener. Core keeps none of it.
 */
export interface RegistrationFieldSlot {
  id: string;
  /** Lower sorts first; default 100. */
  order?: number;
  component: ComponentType<{ value: unknown; onChange: (value: unknown) => void }>;
}

// ── Privacy settings section ──────────────────────────────────────────────────
export interface PrivacySectionSlot {
  id: string;
  component: ComponentType;
}

// ── Root gate ─────────────────────────────────────────────────────────────────
/**
 * A gate a plugin wraps the ENTIRE app in.
 *
 * The counterpart to `registerAuthGuard` on the server: that one decides whether
 * somebody may log in, this one decides whether the SPA renders at all. A
 * private-beta plugin needs both — the API refuses the credential, and the
 * browser has to show a code wall instead of the site.
 *
 * Core cannot host this itself. The gate sits OUTSIDE the router (it has to, or
 * the app it is gating would already be mounted), so it has no `useLocation` —
 * which is why core hands it `pathname`, tracked through client-side navigation.
 * Without that a gate would read the URL once and every later `<Link>` would sail
 * straight past it.
 *
 * A gate renders `children` to allow and its own screen to refuse. Gates compose
 * in `order`, outermost first.
 */
export interface RootGateSlot {
  id: string;
  component: ComponentType<{ pathname: string; children: ReactNode }>;
  /** Lower wraps further out. */
  order?: number;
}

// ── ACP Settings section ──────────────────────────────────────────────────────
/**
 * A panel a plugin contributes INTO an existing ACP → Settings tab.
 *
 * The counterpart to `groupConfigPanel`, and it exists for the same reason: some
 * plugin configuration belongs beside the core setting it extends, not in a
 * top-level nav section of its own. A plugin that adds a site gate (a beta, a
 * waitlist) configures it where an admin looks for access settings, not under a
 * separate heading three groups further down.
 *
 * It appears exactly like one of core's own: an entry in the "on this page" nav
 * and a card in the flow. Core renders the shell — heading, icon, scroll anchor —
 * so a plugin's section cannot look foreign, and supplies only the body.
 *
 * There is no `tab`. Settings had a General/Beta split while core owned a beta;
 * the beta left for a plugin and took its tab with it.
 */
export interface SettingsSectionSlot {
  id: string;
  label: string;
  /** Sub-heading under the title, like core's own sections have. */
  description?: string;
  component: ComponentType;
  /** Lower renders first. Core's own sections always come before plugin ones. */
  order?: number;
}

// ── Frontend route (public or ACP) ───────────────────────────────────────────
export interface PluginRoute {
  path: string;
  component: ComponentType<any>;
  layout: "public" | "acp";
  /**
   * Public pages only: members only. A guest is sent to sign in and brought back.
   * (ACP routes are behind the admin gate already.) Absent = anyone may open it.
   */
  requiresAuth?: boolean;
}

// ── Header widget (registered by plugins, rendered in the top-nav action cluster) ─
// Rendered for authenticated users only, immediately left of the notification bell
// in both the public nav and the ACP topbar. The component owns its own button +
// dropdown (mirror NotificationBell). Lower `order` renders further left.
/**
 * Something a plugin draws once on EVERY public page, outside the layout: a consent
 * dialog, a chat bubble. Fixed-position by nature; it must draw nothing it does not
 * need to (no box, no space taken) and never cover the page by default.
 */
export interface SiteOverlaySlot {
  id: string;
  component: ComponentType;
  order?: number;
}

export interface HeaderWidgetSlot {
  id: string;
  /** Receives the glyph an admin picked for its block in the layout editor (a TokenIcon
   *  token), or nothing — draw your own default then. */
  component: ComponentType<{ icon?: string }>;
  order?: number;
  /** The block's name in the layout editor ("Messages"); a getter may translate it. */
  label?: string;
}

// ── User menu item (registered by plugins, rendered in the signed-in member's
// avatar dropdown between "Account settings" and "Sign out") ─────────────────
// A plain link, not a component: the menu owns the markup, so every entry looks
// and behaves like core's own (closing on click, keyboard, the danger divider).
export interface UserMenuItemSlot {
  id: string;
  /** A getter may translate it at render. */
  label: string;
  /** An in-app path ("/membership"). */
  to: string;
  /** FontAwesome IconDefinition. */
  icon?: unknown;
  /** Lower renders higher. */
  order?: number;
}

// ── Plugin-level metadata (icon, color, ACP position, notification prefixes) ──
export interface PluginMeta {
  pluginId: string;
  /** FontAwesome IconDefinition used in ACP sidebar and Marketplace */
  icon?: unknown;
  /**
   * One of the ACP rail's own icons (`forum`, `files`, `support`, `shop`, …), so the
   * plugin's section matches core's: outline at rest, filled when active. Wins over
   * `icon` in the rail. Unknown names fall back to `icon`.
   */
  acpIcon?: string;
  /** CSS color token used in Marketplace card accent */
  accentColor?: string;
  /** Section name as declared in registerAcpPage — used to match for icon/position */
  acpSectionName?: string;
  /** Where in the ACP nav this plugin's section appears */
  acpSectionPosition?: "after-content" | "after-moderation";
  /** Notification type strings (or prefixes ending with ".") that should show a system icon */
  systemNotificationPrefixes?: string[];
  /**
   * Notification types (or prefixes ending with ".") a MODERATOR's action triggers —
   * an approval, a rejection, a removal. The bell draws them with the moderation
   * shield (user rule 2026-10-12: every member notification from the mod tool wears
   * it), and this wins over `systemNotificationPrefixes`.
   */
  moderationNotificationPrefixes?: string[];
}

// ── Search tab (registered by plugins, rendered in SearchPage) ────────────────
export interface SearchTabSlot {
  /** Must match the `type` query param accepted by GET /api/search */
  id: string;
  label: string;
  /** Build a link URL from a search result item. Defaults to "#" if not provided. */
  linkFn?: (item: Record<string, unknown>) => string;
}

// ── Profile card stat (registered by plugins, shown in /u/:username stats bar) ─
export interface ProfileStatSlot {
  id: string;
  label: string;
  /** Async function that resolves the stat value for the given userId. */
  fetchValue: (userId: string) => Promise<number>;
  /** If provided, clicking the stat switches to this profile tab. */
  tabId?: string;
}

// ── Profile action (registered by plugins, shown in /u/:username card action row) ─
// Rendered in the profile card's top-right action cluster, beside the core
// Follow / Block buttons. The component owns its own button (and any dialog).
export interface ProfileActionSlot {
  id: string;
  component: ComponentType<{ profileId: string; profileUsername: string; isOwn: boolean }>;
  /** Lower renders further left. */
  order?: number;
}

// ── ModCanvas section (registered by plugins) ─────────────────────────────────
// Since ModCanvas v1 (2026-10-02): a group in the navbar moderation shield's dropdown,
// shown while `badgeCountFn` reports something waiting; picking it opens `component`
// in a dialog. `onNav` closes that dialog.
export interface ModCanvasSectionSlot {
  id: string;
  label: string;
  /** FontAwesome IconDefinition */
  icon: unknown;
  /** `contextUsername` is the profile the mod is currently viewing (`/u/:username`),
   *  or "" when not on a profile — lets sections render user-scoped tools inline. */
  component: ComponentType<{ onNav: (id: string) => void; contextUsername?: string }>;
  /** Called to get the badge count for this section's tab */
  badgeCountFn?: () => Promise<number>;
}

// ── ACP User Detail panel (registered by plugins, rendered on /admin/users/:id) ─
// Appended below the core panels on the User Detail page. The component owns its
// own card chrome and gates its own data (the backing endpoint enforces perms).
export interface UserDetailPanelSlot {
  id: string;
  component: ComponentType<{ userId: string; username: string }>;
  /** Lower renders higher up the page. */
  order?: number;
}

// ── Per-IP enrichment (rendered inline next to an IP wherever core lists IPs) ──
// e.g. advanced-moderation renders geo / VPN / proxy / risk for the given IP.
// Core passes the IP; the component fetches its own data and renders nothing if
// the plugin can't enrich it (no data / not permitted).
export interface IpEnrichmentSlot {
  id: string;
  component: ComponentType<{ ip: string }>;
}

// ── ModCanvas queue (registered by plugins) ───────────────────────────────────
// A plugin's work list in the moderation shield — e.g. the forum's threads awaiting
// approval. Each item is a ROW in the dropdown, beside reports and security cases;
// picking one opens its page (`href`), marks it (`markKey` = the page's
// `data-mod-target`) and shows a pill with the plugin's `actions`. Supersedes
// `registerModCanvasSection` (a dialog) for anything that is a list of decisions.
export interface ModQueueItem {
  id: string;
  title: string;
  /** Second line: who / where. */
  line?: string;
  /** ISO time; the list is oldest first. */
  createdAt: string;
  href?: string | null;
  /** The page's `data-mod-target` value for this item, to scroll to and mark it. */
  markKey?: string | null;
  /** A louder row (e.g. something urgent). */
  hot?: boolean;
}
export interface ModQueueAction {
  id: string;
  label: string;
  /** FontAwesome IconDefinition */
  icon?: unknown;
  tone?: "primary" | "danger" | "ghost";
  /** Ask first. With `reasonLabel`, the dialog takes a reason, passed to `run`. */
  confirm?: { title: string; body: string; reasonLabel?: string };
  /** Do it; the returned text is shown as a success toast. Throw to report a failure. */
  run(item: ModQueueItem, reason?: string): Promise<string | void>;
}
export interface ModQueueSlot {
  id: string;
  label: string;
  /** FontAwesome IconDefinition */
  icon: unknown;
  /** Everything waiting, for this moderator. Polled while the site is open. */
  fetchItems(): Promise<ModQueueItem[]>;
  actions: ModQueueAction[];
}

// ── ModCanvas user panel ──────────────────────────────────────────────────────
// ⚠ NOT RENDERED since ModCanvas v1 (2026-10-02): its host, the slide-over's Users
// tab, was retired. Kept so a plugin that registers one keeps loading.
// e.g. the shoutbox shows a "user is muted in the shoutbox" alert + Unmute button.
// Core passes the selected user; the component fetches its own data and renders
// nothing when there is nothing to show (not muted / not permitted).
export interface ModCanvasUserPanelSlot {
  id: string;
  component: ComponentType<{ userId: string; username: string }>;
  /** Lower renders higher up. */
  order?: number;
}

// ── Layout widget (registered by plugins, rendered inside the page layout flow) ─
// Rendered by <LayoutWidgetOutlet outlet="…"> mount points placed in the layout
// and rail-owning pages: "top" (inside .app-main, above the routed page, clamped
// to --content-max), "aside" (a card slot in a page's rail), "forum-top" (forum
// index, above the categories). The component receives the outlet id and decides
// itself whether to render there — placement is the plugin's own configuration,
// the outlet stays dumb and reusable.
export interface LayoutWidgetSlot {
  id: string;
  component: ComponentType<{ outlet: string }>;
  /** Lower renders first within an outlet. */
  order?: number;
}

// ── Per-group config panel (registered by plugins, rendered as a TAB in the core
// Group settings dialog on ACP → Groups). Lets a plugin add per-group settings
// (e.g. shoutbox rate/length limits) next to the core progression config WITHOUT
// core knowing the plugin's schema — the component owns its data (reads/writes via
// the plugin's own API) and each panel is a tab so the dialog stays compact.
export interface GroupConfigPanelSlot {
  id: string;
  /** Tab label. */
  label: string;
  component: ComponentType<{ groupId: string; groupName: string }>;
  /** Lower renders first (after the core Progression tab). */
  order?: number;
}

// ── Registry ──────────────────────────────────────────────────────────────────

/**
 * Something a plugin keeps in its own tables but shows INSIDE written content — a
 * poll in a forum post or an article. The content stores only a placeholder,
 * `<div data-xt-embed="<type>" data-id="<id>">`; wherever that content is drawn
 * (the editor, an article, a post) core swaps the placeholder for `component`.
 *
 * The component fetches its own data through the plugin's permission-checked
 * endpoints, so a placeholder is never a way to read something the viewer may not.
 */
export interface EmbedSlot {
  /** Lowercase letters, digits and dashes — the same rule the sanitizer applies. */
  type:      string;
  component: (props: { id: string }) => ReactNode;
}

/**
 * A button a plugin adds to the Composer's tool row (e.g. "Poll"). It opens
 * `panel` beside the bar; the panel calls `onInsert` with the embed it created,
 * and the Composer puts the placeholder into the document.
 *
 * Offered only on the `surfaces` listed (the Composer's `surface` prop, e.g.
 * `forum.post`, `article`) and only to members holding `permission`.
 */
export interface ComposerToolSlot {
  /** Namespaced: `<pluginId>.<tool>`. */
  id:          string;
  icon:        unknown;
  /** Tooltip and accessible name; a getter is fine, so it follows the language. */
  readonly label: string;
  surfaces:    string[];
  permission?: string;
  panel:       (props: { onInsert: (embed: { type: string; id: string }) => void; onClose: () => void }) => ReactNode;
}

class SlotRegistry {
  private profileTabs:       ProfileTabSlot[]       = [];
  private accountSections:   AccountSectionSlot[]   = [];
  private accountTabs:       AccountTabSlot[]       = [];
  private privacySections:   PrivacySectionSlot[]   = [];
  private settingsSections:  SettingsSectionSlot[]  = [];
  private editorPanels:      EditorPanelSlot[]      = [];
  private rootGates:         RootGateSlot[]         = [];
  private routes:            PluginRoute[]           = [];
  private pluginMetas:       PluginMeta[]            = [];
  private searchTabs:        SearchTabSlot[]         = [];
  private modCanvasSections: ModCanvasSectionSlot[]  = [];
  private modQueues:         ModQueueSlot[]          = [];
  private userDetailPanels:  UserDetailPanelSlot[]    = [];
  private ipEnrichments:     IpEnrichmentSlot[]       = [];
  private modCanvasUserPanels: ModCanvasUserPanelSlot[] = [];
  private profileStats:      ProfileStatSlot[]        = [];
  private profileActions:    ProfileActionSlot[]      = [];
  private headerWidgets:     HeaderWidgetSlot[]       = [];
  private siteOverlays:      SiteOverlaySlot[]        = [];
  private userMenuItems:     UserMenuItemSlot[]       = [];
  private layoutWidgets:     LayoutWidgetSlot[]       = [];
  private groupConfigPanels: GroupConfigPanelSlot[]   = [];
  private embeds:            EmbedSlot[]              = [];
  private composerTools:     ComposerToolSlot[]       = [];
  private registrationFields: RegistrationFieldSlot[]  = [];

  // Core notification prefixes that always show the system (gear) icon
  /**
   * ⚠ A type NOT listed here draws a `UserAvatar` made from whatever is in `title` —
   * which for a sender-less notification means initials cut out of a sentence. Every
   * type the site itself sends, rather than another member, belongs in this list.
   */
  private readonly coreSystemPrefixes = ["progression.", "license.", "system.", "badge."];

  // Ownership tracking: maps slotKey → pluginId so deregister works for
  // bare-word ids (e.g. "approvals", "forum") that don't share a prefix with the pluginId.
  private readonly _owners = new Map<string, string>();
  private _activePlugin    = "";

  private _own(key: string)                        { if (this._activePlugin) this._owners.set(key, this._activePlugin); }
  /**
   * Which plugin registered a slot id.
   *
   * Public because `layout/slotBlocks.tsx` derives a layout block per contribution
   * and has to stamp `pluginId` on it — that is what makes disabling the plugin
   * remove the block while leaving the admin's document untouched.
   */
  ownerOf(key: string): string | undefined     { return this._owners.get(key); }
  private _ownedBy(key: string, pid: string)       { return this._owners.get(key) === pid || key.startsWith(pid); }

  registerPluginMeta(meta: PluginMeta)                      { this._activePlugin = meta.pluginId; this.pluginMetas.push(meta); }
  registerProfileTab(slot: ProfileTabSlot)                  { this._own(slot.id);     this.profileTabs.push(slot); }
  registerAccountSection(slot: AccountSectionSlot)          { this._own(slot.id);     this.accountSections.push(slot); }
  registerAccountTab(slot: AccountTabSlot)                  { this._own(slot.id);     this.accountTabs.push(slot); }
  registerRegistrationField(slot: RegistrationFieldSlot)    { this._own(slot.id);     this.registrationFields.push(slot); }
  registerPrivacySection(slot: PrivacySectionSlot)          { this._own(slot.id);     this.privacySections.push(slot); }
  registerSettingsSection(slot: SettingsSectionSlot)         { this._own(slot.id);     this.settingsSections.push(slot); }
  registerEditorPanel(slot: EditorPanelSlot)                 { this._own(slot.id);     this.editorPanels.push(slot); }
  registerRootGate(slot: RootGateSlot)                       { this._own(slot.id);     this.rootGates.push(slot); }
  registerRoute(route: PluginRoute)                         { this._own(route.path);  this.routes.push(route); }
  registerSearchTab(tab: SearchTabSlot)                     { this._own(tab.id);      this.searchTabs.push(tab); }
  registerModCanvasSection(section: ModCanvasSectionSlot)   { this._own(section.id);  this.modCanvasSections.push(section); }
  registerModQueue(queue: ModQueueSlot)                     { this._own(queue.id);    this.modQueues.push(queue); }
  registerUserDetailPanel(panel: UserDetailPanelSlot)       { this._own(panel.id);    this.userDetailPanels.push(panel); }
  registerIpEnrichment(slot: IpEnrichmentSlot)              { this._own(slot.id);     this.ipEnrichments.push(slot); }
  registerModCanvasUserPanel(slot: ModCanvasUserPanelSlot)  { this._own(slot.id);     this.modCanvasUserPanels.push(slot); }
  registerProfileStat(stat: ProfileStatSlot)                { this._own(stat.id);     this.profileStats.push(stat); }
  registerProfileAction(slot: ProfileActionSlot)            { this._own(slot.id);     this.profileActions.push(slot); }
  registerHeaderWidget(slot: HeaderWidgetSlot)              { this._own(slot.id);     this.headerWidgets.push(slot); }
  registerSiteOverlay(slot: SiteOverlaySlot)                { this._own(slot.id);     this.siteOverlays.push(slot); }
  registerUserMenuItem(slot: UserMenuItemSlot)              { this._own(slot.id);     this.userMenuItems.push(slot); }
  registerLayoutWidget(slot: LayoutWidgetSlot)              { this._own(slot.id);     this.layoutWidgets.push(slot); }
  registerGroupConfigPanel(slot: GroupConfigPanelSlot)      { this._own(slot.id);     this.groupConfigPanels.push(slot); }
  /** One renderer per type; a second registration of the same type replaces the first. */
  registerEmbed(slot: EmbedSlot) {
    this._own(`embed:${slot.type}`);
    this.embeds = [...this.embeds.filter((e) => e.type !== slot.type), slot];
  }
  registerComposerTool(slot: ComposerToolSlot) {
    this._own(slot.id);
    this.composerTools = [...this.composerTools.filter((t) => t.id !== slot.id), slot];
  }

  getProfileTabs()       { return [...this.profileTabs]; }
  getAccountSections()   { return [...this.accountSections]; }
  getAccountTabs()       { return [...this.accountTabs].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
  /** Sign-up fields, each with the add-on id its value is sent under. */
  getRegistrationFields() {
    return [...this.registrationFields]
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
      .map((slot) => ({ slot, pluginId: this._owners.get(slot.id) ?? slot.id.split(/[.:/]/)[0]! }));
  }
  getPrivacySections()   { return [...this.privacySections]; }
  /** Outermost first. */
  getRootGates()         { return [...this.rootGates].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
  /** Plugin sections for ACP → Settings, in `order`. */
  getSettingsSections() {
    return [...this.settingsSections].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }
  getSearchTabs()        { return [...this.searchTabs]; }
  /** Plugin panels for one editor, in `order`. */
  getEditorPanels(contentKind: string) {
    return this.editorPanels.filter((p) => p.contentKind === contentKind).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }
  getModCanvasSections() { return [...this.modCanvasSections]; }
  getModQueues()         { return [...this.modQueues]; }
  getUserDetailPanels()  { return [...this.userDetailPanels].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
  getIpEnrichments()     { return [...this.ipEnrichments]; }
  getModCanvasUserPanels() { return [...this.modCanvasUserPanels].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
  getProfileStats()      { return [...this.profileStats]; }
  getProfileActions()    { return [...this.profileActions].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
  getHeaderWidgets()     { return [...this.headerWidgets].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
  getSiteOverlays()      { return [...this.siteOverlays].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
  getUserMenuItems()     { return [...this.userMenuItems].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
  getLayoutWidgets()     { return [...this.layoutWidgets].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
  getEmbed(type: string): EmbedSlot | undefined { return this.embeds.find((e) => e.type === type); }
  /** The tools a Composer on `surface` may offer; the permission check is the caller's. */
  getComposerTools(surface: string | undefined): ComposerToolSlot[] {
    return surface ? this.composerTools.filter((t) => t.surfaces.includes(surface)) : [];
  }
  getGroupConfigPanels() { return [...this.groupConfigPanels].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }

  getRoutes(layout?: PluginRoute["layout"]): PluginRoute[] {
    if (!layout) return [...this.routes];
    return this.routes.filter((r) => r.layout === layout);
  }

  getPluginMeta(pluginId: string): PluginMeta | undefined {
    return this.pluginMetas.find((m) => m.pluginId === pluginId);
  }

  getPluginMetaBySectionName(sectionName: string): PluginMeta | undefined {
    return this.pluginMetas.find((m) => m.acpSectionName === sectionName);
  }

  getAllPluginMetas(): PluginMeta[] {
    return [...this.pluginMetas];
  }

  /** Returns all notification type prefixes/exact-types that should render a system (gear) icon. */
  getSystemNotificationPrefixes(): string[] {
    const pluginPrefixes = this.pluginMetas.flatMap((m) => m.systemNotificationPrefixes ?? []);
    return [...this.coreSystemPrefixes, ...pluginPrefixes];
  }

  /** Core's moderation notifications plus every plugin's: these get the shield in the bell. */
  getModerationNotificationPrefixes(): string[] {
    return ["moderation.", ...this.pluginMetas.flatMap((m) => m.moderationNotificationPrefixes ?? [])];
  }

  deregister(pluginId: string) {
    this.profileTabs       = this.profileTabs.filter((s) => !this._ownedBy(s.id, pluginId));
    this.editorPanels      = this.editorPanels.filter((s) => !this._ownedBy(s.id, pluginId));
    this.accountSections   = this.accountSections.filter((s) => !this._ownedBy(s.id, pluginId));
    this.accountTabs       = this.accountTabs.filter((s) => !this._ownedBy(s.id, pluginId));
    this.registrationFields = this.registrationFields.filter((s) => !this._ownedBy(s.id, pluginId));
    this.privacySections   = this.privacySections.filter((s) => !this._ownedBy(s.id, pluginId));
    this.routes            = this.routes.filter((r) => !this._ownedBy(r.path, pluginId));
    this.pluginMetas       = this.pluginMetas.filter((m) => m.pluginId !== pluginId);
    this.searchTabs        = this.searchTabs.filter((t) => !this._ownedBy(t.id, pluginId));
    this.modCanvasSections = this.modCanvasSections.filter((s) => !this._ownedBy(s.id, pluginId));
    this.modQueues         = this.modQueues.filter((s) => !this._ownedBy(s.id, pluginId));
    this.userDetailPanels  = this.userDetailPanels.filter((s) => !this._ownedBy(s.id, pluginId));
    this.ipEnrichments     = this.ipEnrichments.filter((s) => !this._ownedBy(s.id, pluginId));
    this.modCanvasUserPanels = this.modCanvasUserPanels.filter((s) => !this._ownedBy(s.id, pluginId));
    this.profileStats      = this.profileStats.filter((s) => !this._ownedBy(s.id, pluginId));
    this.profileActions    = this.profileActions.filter((s) => !this._ownedBy(s.id, pluginId));
    this.headerWidgets     = this.headerWidgets.filter((s) => !this._ownedBy(s.id, pluginId));
    this.siteOverlays      = this.siteOverlays.filter((s) => !this._ownedBy(s.id, pluginId));
    this.userMenuItems     = this.userMenuItems.filter((s) => !this._ownedBy(s.id, pluginId));
    this.layoutWidgets     = this.layoutWidgets.filter((s) => !this._ownedBy(s.id, pluginId));
    this.groupConfigPanels = this.groupConfigPanels.filter((s) => !this._ownedBy(s.id, pluginId));
    this.embeds            = this.embeds.filter((e) => !this._ownedBy(`embed:${e.type}`, pluginId));
    this.composerTools     = this.composerTools.filter((t) => !this._ownedBy(t.id, pluginId));
    this._owners.forEach((owner, key) => { if (owner === pluginId) this._owners.delete(key); });
    // A disabled plugin's cookies and services leave the consent lists with it.
    forgetConsentFor(pluginId);
  }
}

export const slotRegistry = new SlotRegistry();

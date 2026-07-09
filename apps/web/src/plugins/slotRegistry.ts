import type { ComponentType } from "react";

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

// ── Privacy settings section ──────────────────────────────────────────────────
export interface PrivacySectionSlot {
  id: string;
  component: ComponentType;
}

// ── Frontend route (public or ACP) ───────────────────────────────────────────
export interface PluginRoute {
  path: string;
  component: ComponentType<any>;
  layout: "public" | "acp";
}

// ── Header widget (registered by plugins, rendered in the top-nav action cluster) ─
// Rendered for authenticated users only, immediately left of the notification bell
// in both the public nav and the ACP topbar. The component owns its own button +
// dropdown (mirror NotificationBell). Lower `order` renders further left.
export interface HeaderWidgetSlot {
  id: string;
  component: ComponentType;
  order?: number;
}

// ── Plugin-level metadata (icon, color, ACP position, notification prefixes) ──
export interface PluginMeta {
  pluginId: string;
  /** FontAwesome IconDefinition used in ACP sidebar and Marketplace */
  icon?: unknown;
  /** CSS color token used in Marketplace card accent */
  accentColor?: string;
  /** Section name as declared in registerAcpPage — used to match for icon/position */
  acpSectionName?: string;
  /** Where in the ACP nav this plugin's section appears */
  acpSectionPosition?: "after-content" | "after-moderation";
  /** Notification type strings (or prefixes ending with ".") that should show a system icon */
  systemNotificationPrefixes?: string[];
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

// ── ModCanvas section (registered by plugins, adds tabs to the mod panel) ─────
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

// ── ModCanvas user panel (rendered inline in the ModCanvas user mod-profile) ──
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

// ── Registry ──────────────────────────────────────────────────────────────────

class SlotRegistry {
  private profileTabs:       ProfileTabSlot[]       = [];
  private accountSections:   AccountSectionSlot[]   = [];
  private privacySections:   PrivacySectionSlot[]   = [];
  private routes:            PluginRoute[]           = [];
  private pluginMetas:       PluginMeta[]            = [];
  private searchTabs:        SearchTabSlot[]         = [];
  private modCanvasSections: ModCanvasSectionSlot[]  = [];
  private userDetailPanels:  UserDetailPanelSlot[]    = [];
  private ipEnrichments:     IpEnrichmentSlot[]       = [];
  private modCanvasUserPanels: ModCanvasUserPanelSlot[] = [];
  private profileStats:      ProfileStatSlot[]        = [];
  private profileActions:    ProfileActionSlot[]      = [];
  private headerWidgets:     HeaderWidgetSlot[]       = [];
  private layoutWidgets:     LayoutWidgetSlot[]       = [];

  // Core notification prefixes that always show the system (gear) icon
  private readonly coreSystemPrefixes = ["progression.", "license.", "system."];

  // Ownership tracking: maps slotKey → pluginId so deregister works for
  // bare-word ids (e.g. "approvals", "forum") that don't share a prefix with the pluginId.
  private readonly _owners = new Map<string, string>();
  private _activePlugin    = "";

  private _own(key: string)                        { if (this._activePlugin) this._owners.set(key, this._activePlugin); }
  private _ownedBy(key: string, pid: string)       { return this._owners.get(key) === pid || key.startsWith(pid); }

  registerPluginMeta(meta: PluginMeta)                      { this._activePlugin = meta.pluginId; this.pluginMetas.push(meta); }
  registerProfileTab(slot: ProfileTabSlot)                  { this._own(slot.id);     this.profileTabs.push(slot); }
  registerAccountSection(slot: AccountSectionSlot)          { this._own(slot.id);     this.accountSections.push(slot); }
  registerPrivacySection(slot: PrivacySectionSlot)          { this._own(slot.id);     this.privacySections.push(slot); }
  registerRoute(route: PluginRoute)                         { this._own(route.path);  this.routes.push(route); }
  registerSearchTab(tab: SearchTabSlot)                     { this._own(tab.id);      this.searchTabs.push(tab); }
  registerModCanvasSection(section: ModCanvasSectionSlot)   { this._own(section.id);  this.modCanvasSections.push(section); }
  registerUserDetailPanel(panel: UserDetailPanelSlot)       { this._own(panel.id);    this.userDetailPanels.push(panel); }
  registerIpEnrichment(slot: IpEnrichmentSlot)              { this._own(slot.id);     this.ipEnrichments.push(slot); }
  registerModCanvasUserPanel(slot: ModCanvasUserPanelSlot)  { this._own(slot.id);     this.modCanvasUserPanels.push(slot); }
  registerProfileStat(stat: ProfileStatSlot)                { this._own(stat.id);     this.profileStats.push(stat); }
  registerProfileAction(slot: ProfileActionSlot)            { this._own(slot.id);     this.profileActions.push(slot); }
  registerHeaderWidget(slot: HeaderWidgetSlot)              { this._own(slot.id);     this.headerWidgets.push(slot); }
  registerLayoutWidget(slot: LayoutWidgetSlot)              { this._own(slot.id);     this.layoutWidgets.push(slot); }

  getProfileTabs()       { return [...this.profileTabs]; }
  getAccountSections()   { return [...this.accountSections]; }
  getPrivacySections()   { return [...this.privacySections]; }
  getSearchTabs()        { return [...this.searchTabs]; }
  getModCanvasSections() { return [...this.modCanvasSections]; }
  getUserDetailPanels()  { return [...this.userDetailPanels].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
  getIpEnrichments()     { return [...this.ipEnrichments]; }
  getModCanvasUserPanels() { return [...this.modCanvasUserPanels].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
  getProfileStats()      { return [...this.profileStats]; }
  getProfileActions()    { return [...this.profileActions].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
  getHeaderWidgets()     { return [...this.headerWidgets].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }
  getLayoutWidgets()     { return [...this.layoutWidgets].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)); }

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

  deregister(pluginId: string) {
    this.profileTabs       = this.profileTabs.filter((s) => !this._ownedBy(s.id, pluginId));
    this.accountSections   = this.accountSections.filter((s) => !this._ownedBy(s.id, pluginId));
    this.privacySections   = this.privacySections.filter((s) => !this._ownedBy(s.id, pluginId));
    this.routes            = this.routes.filter((r) => !this._ownedBy(r.path, pluginId));
    this.pluginMetas       = this.pluginMetas.filter((m) => m.pluginId !== pluginId);
    this.searchTabs        = this.searchTabs.filter((t) => !this._ownedBy(t.id, pluginId));
    this.modCanvasSections = this.modCanvasSections.filter((s) => !this._ownedBy(s.id, pluginId));
    this.userDetailPanels  = this.userDetailPanels.filter((s) => !this._ownedBy(s.id, pluginId));
    this.ipEnrichments     = this.ipEnrichments.filter((s) => !this._ownedBy(s.id, pluginId));
    this.modCanvasUserPanels = this.modCanvasUserPanels.filter((s) => !this._ownedBy(s.id, pluginId));
    this.profileStats      = this.profileStats.filter((s) => !this._ownedBy(s.id, pluginId));
    this.profileActions    = this.profileActions.filter((s) => !this._ownedBy(s.id, pluginId));
    this.headerWidgets     = this.headerWidgets.filter((s) => !this._ownedBy(s.id, pluginId));
    this.layoutWidgets     = this.layoutWidgets.filter((s) => !this._ownedBy(s.id, pluginId));
    this._owners.forEach((owner, key) => { if (owner === pluginId) this._owners.delete(key); });
  }
}

export const slotRegistry = new SlotRegistry();

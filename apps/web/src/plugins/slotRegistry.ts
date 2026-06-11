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

// ── ModCanvas section (registered by plugins, adds tabs to the mod panel) ─────
export interface ModCanvasSectionSlot {
  id: string;
  label: string;
  /** FontAwesome IconDefinition */
  icon: unknown;
  component: ComponentType<{ onNav: (id: string) => void }>;
  /** Called to get the badge count for this section's tab */
  badgeCountFn?: () => Promise<number>;
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
  private profileStats:      ProfileStatSlot[]        = [];

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
  registerProfileStat(stat: ProfileStatSlot)                { this._own(stat.id);     this.profileStats.push(stat); }

  getProfileTabs()       { return [...this.profileTabs]; }
  getAccountSections()   { return [...this.accountSections]; }
  getPrivacySections()   { return [...this.privacySections]; }
  getSearchTabs()        { return [...this.searchTabs]; }
  getModCanvasSections() { return [...this.modCanvasSections]; }
  getProfileStats()      { return [...this.profileStats]; }

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
    this.profileStats      = this.profileStats.filter((s) => !this._ownedBy(s.id, pluginId));
    this._owners.forEach((owner, key) => { if (owner === pluginId) this._owners.delete(key); });
  }
}

export const slotRegistry = new SlotRegistry();

import type { ReactNode } from "react";
import { createElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../components/Icon";
import { faPuzzlePiece } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { slotRegistry } from "../../plugins/slotRegistry";
import { AcpIcon, type AcpIconName } from "./pages/acpIcons";
import { pluginTextKey } from "../../lib/coreText";

export interface NavChild {
  label: string;
  to: string;
  /**
   * Routes that are INSIDE this page without having nav entries of their own. The
   * entry stays highlighted there, and the breadcrumb names them under it.
   */
  within?: { to: string; label: string }[];
  /** A heading in the section panel this entry sits under (an `acp` key). */
  group?: string;
}

/** Whether `path` is this nav child's page, or one reached only through it. */
export function childMatches(child: NavChild, path: string): boolean {
  return path.startsWith(child.to) || !!child.within?.some((w) => path.startsWith(w.to));
}
export interface NavItem {
  label: string;        // `acp` i18n key for core items; literal label for plugin sections
  icon: ReactNode;
  iconName?: AcpIconName;  // same icon by name, for consumers that need it unrendered
                           // (the topbar breadcrumb / command palette index below)
  to?: string;          // leaf item (no children)
  key?: string;         // grouping key
  children?: NavChild[];
}

// Core ACP nav. `label` values are `acp` i18n keys (resolved with t() at render).
// Plugin-registered sections supply literal labels — i18next returns the key as-is
// when it's missing, so those pass through untranslated, which is correct.
export const ACP_NAV: NavItem[] = [
  { label: "nav.dashboard", icon: createElement(AcpIcon, { name: "dashboard", size: 18 }), iconName: "dashboard", to: "/admin" },
  {
    // Members and Access control were two sections (2026-10-17 merged): groups,
    // their permissions and the ranks that move members between them are one subject.
    label: "nav.members", icon: createElement(AcpIcon, { name: "user", size: 18 }), iconName: "user", key: "users",
    children: [
      { label: "nav.userList", to: "/admin/users" },
      { label: "nav.groups", to: "/admin/groups" },
      { label: "nav.permissions", to: "/admin/permissions" },
      { label: "nav.progression", to: "/admin/progression" },
      // A badge is something a member HOLDS; next to Progression, the other way a
      // member is marked out.
      { label: "nav.badges", to: "/admin/badges" },
      { label: "nav.profileFields", to: "/admin/profile-fields" },
    ],
  },
  {
    label: "nav.content", icon: createElement(AcpIcon, { name: "file", size: 18 }), iconName: "file", key: "content",
    children: [
      { label: "nav.articles", to: "/admin/articles" },
      { label: "nav.categories", to: "/admin/categories" },
      // The editor's tools: what members can write with, beside the emojis it offers.
      // Was "Composer" under Appearance.
      { label: "nav.editor", to: "/admin/composer" },
      { label: "nav.emojis", to: "/admin/emojis" },
      { label: "nav.legal", to: "/admin/legal" },
    ],
  },
  {
    label: "nav.moderation", icon: createElement(AcpIcon, { name: "shield", size: 18 }), iconName: "shield", key: "moderation",
    children: [
      { label: "nav.reviewCases", to: "/admin/cases" },
      // Used on every warning and ban, so before the log and the settings.
      { label: "nav.modTemplates", to: "/admin/mod-templates" },
      { label: "nav.modLog", to: "/admin/modlog" },
      { label: "nav.modSettings", to: "/admin/modsettings" },
    ],
  },
  {
    label: "nav.appearance", icon: createElement(AcpIcon, { name: "palette", size: 18 }), iconName: "palette", key: "appearance",
    children: [
      // Theme Studio is reached from a theme on this page — it edits ONE theme — so
      // it has no nav entry of its own.
      { label: "nav.themes", to: "/admin/themes", within: [
        { to: "/admin/theme-studio", label: "nav.themeStudio" },
      ] },
      // `style-history` retired 2026-08-26: the Style Editor's History tab is the
      // same list, beside the editor the snapshots came from. The route redirects.
      { label: "nav.navigation", to: "/admin/navigation" },
    ],
  },
  {
    label: "nav.extensions", icon: createElement(AcpIcon, { name: "puzzle", size: 18 }), iconName: "puzzle", key: "extensions",
    children: [
      { label: "nav.marketplace", to: "/admin/marketplace" },
      // Uploading a package is a button on Installed (when uploads are allowed), not
      // a page of its own in the list.
      { label: "nav.installed", to: "/admin/installed", within: [
        { to: "/admin/upload", label: "nav.upload" },
      ] },
      { label: "nav.updates", to: "/admin/updates" },
      { label: "nav.license", to: "/admin/license" },
    ],
  },
  {
    // Two small groups in the panel: what you set up, and what the site records.
    label: "nav.system", icon: createElement(AcpIcon, { name: "cog", size: 18 }), iconName: "cog", key: "system",
    children: [
      { label: "nav.settings", to: "/admin/settings", group: "nav.groupSetup" },
      { label: "nav.email", to: "/admin/email", group: "nav.groupSetup" },
      { label: "nav.scheduledTasks", to: "/admin/scheduled-tasks", group: "nav.groupSetup" },
      { label: "nav.about", to: "/admin/about", group: "nav.groupSetup" },
      { label: "nav.activityLog", to: "/admin/activity-log", group: "nav.groupLogs" },
      { label: "nav.errorLog", to: "/admin/error-log", group: "nav.groupLogs" },
      { label: "nav.errorReference", to: "/admin/error-ref", group: "nav.groupLogs" },
      { label: "nav.migrationHistory", to: "/admin/migration-history", group: "nav.groupLogs" },
    ],
  },
];

export interface AcpNavEntry {
  labelKey: string;
  subKey: string;
  icon: AcpIconName;
  to: string;
  /** A page inside another (see `NavChild.within`): breadcrumb only, never in the palette. */
  parentKey?: string;
}

/**
 * Flattened route index derived from ACP_NAV — used by the topbar breadcrumb and
 * the command palette.
 *
 * Derived rather than hand-maintained: the topbar previously kept its own copy,
 * and six routes had already drifted out of it (Pages, Review Cases, Updates,
 * Activity Log, Layout Editor, Email) — each one silently missing its
 * breadcrumb and unreachable from the palette. Adding a nav entry now updates
 * both automatically.
 */
export const ACP_NAV_INDEX: AcpNavEntry[] = ACP_NAV.flatMap((item) => {
  const icon = item.iconName ?? "cog";
  if (item.children?.length) {
    return item.children.flatMap((c) => [
      { labelKey: c.label, subKey: item.label, icon, to: c.to },
      ...(c.within ?? []).map((w) => ({ labelKey: w.label, subKey: item.label, icon, to: w.to, parentKey: c.label })),
    ]);
  }
  // Leaf entries (only the dashboard today) sit under a generic parent crumb.
  return item.to ? [{ labelKey: item.label, subKey: "nav.overview", icon, to: item.to }] : [];
});

/**
 * Section names plugins may register under that are not a core key (any more): the
 * Access control section merged into Members, so a plugin page filed under it, or
 * under the new name, still lands there instead of becoming a section of its own.
 */
const SECTION_ALIASES: Record<string, string> = {
  access: "users", "access control": "users", members: "users",
};

/** Returns the core nav with plugin-registered sections merged in:
 *  "content-area" plugin sections (e.g. Forum) sit between Content and Moderation;
 *  everything else goes after Moderation — matching the original sidebar behavior. */
export function useAcpNav(): NavItem[] {
  const { data: pluginPages = [] } = useQuery<{ section: string; label: string; path: string; pluginId: string }[]>({
    queryKey: ["acp-registered-pages"],
    queryFn: () => api.get("/admin/registered-pages"),
    staleTime: 60_000,
  });

  const pluginSectionMap = pluginPages.reduce<Record<string, NavChild[]>>((acc, page) => {
    // Rendered through t(): a plugin's translation key when it ships one, else its literal label.
    const own = pluginTextKey(`acpPages.${page.path.replace(/^\/admin\//, "")}`);
    (acc[page.section] ??= []).push({ label: own ?? page.label, to: page.path });
    return acc;
  }, {});

  // A plugin page whose `section` matches an existing core section key (e.g.
  // "Users") nests INTO that core group rather than getting its own top-level
  // section. Everything else becomes a standalone plugin section.
  const coreKeys = new Set(ACP_NAV.map((n) => n.key).filter(Boolean) as string[]);
  const mergeIntoCore: Record<string, NavChild[]> = {};
  const standaloneMap: Record<string, NavChild[]> = {};
  for (const [section, children] of Object.entries(pluginSectionMap)) {
    const key = SECTION_ALIASES[section.toLowerCase()] ?? section.toLowerCase();
    if (coreKeys.has(key)) (mergeIntoCore[key] ??= []).push(...children);
    else standaloneMap[section] = children;
  }

  // Core nav with any merged plugin children appended to the matching section.
  const baseNav: NavItem[] = ACP_NAV.map((item) => {
    let children = item.children;
    const added = item.key ? mergeIntoCore[item.key] : undefined;
    if (added && children) {
      // In a grouped section a plugin page joins the FIRST group (System: Setup), so
      // it is never filed under Logs.
      const first = children[0]?.group;
      const tagged = first ? added.map((c) => ({ ...c, group: first })) : added;
      const lastOfFirst = first ? children.reduce((at, c, i) => (c.group === first ? i : at), -1) : children.length - 1;
      children = [...children.slice(0, lastOfFirst + 1), ...tagged, ...children.slice(lastOfFirst + 1)];
    }
    return children === item.children ? item : { ...item, children };
  });

  const toNavItem = (section: string, children: NavChild[]): NavItem => {
    const meta = slotRegistry.getPluginMetaBySectionName(section);
    return {
      label: pluginTextKey(`acpSections.${section}`) ?? section,
      icon: meta?.icon
        ? createElement(FontAwesomeIcon, { icon: meta.icon as never })
        : createElement(FontAwesomeIcon, { icon: faPuzzlePiece }),
      key: `plugin-${section.toLowerCase()}`,
      children,
    };
  };

  const contentAreaSections = Object.entries(standaloneMap)
    .filter(([s]) => slotRegistry.getPluginMetaBySectionName(s)?.acpSectionPosition === "after-content")
    .map(([s, ch]) => toNavItem(s, ch));
  const otherPluginSections = Object.entries(standaloneMap)
    .filter(([s]) => slotRegistry.getPluginMetaBySectionName(s)?.acpSectionPosition !== "after-content")
    .map(([s, ch]) => toNavItem(s, ch));

  const contentIdx = baseNav.findIndex((n) => n.key === "content");
  const moderationIdx = baseNav.findIndex((n) => n.key === "moderation");
  return [
    ...baseNav.slice(0, contentIdx + 1),
    ...contentAreaSections,
    ...baseNav.slice(contentIdx + 1, moderationIdx + 1),
    ...otherPluginSections,
    ...baseNav.slice(moderationIdx + 1),
  ];
}

/**
 * Is this top-level nav item the one the current route belongs to?
 *
 * ⚠ The dashboard is an EXACT match. Every ACP route starts with `/admin`, so
 * `startsWith` on a leaf whose `to` is `/admin` would mark the dashboard active
 * on every page in the panel — and with the rail chrome that means the rail's
 * indicator bar never moves.
 */
export function isNavItemActive(item: NavItem, path: string): boolean {
  if (item.to) return item.to === "/admin" ? path === "/admin" : path.startsWith(item.to);
  return !!item.children?.some((c) => childMatches(c, path));
}

/** The section the current route sits in, falling back to the first one. */
export function activeNavSection(nav: NavItem[], path: string): NavItem | undefined {
  return nav.find((n) => isNavItemActive(n, path)) ?? nav[0];
}

/** Stable identity for a nav item — its key, else its route, else its label. */
export function navItemId(item: NavItem): string {
  return item.key ?? item.to ?? item.label;
}

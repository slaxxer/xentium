import type { ReactNode } from "react";
import { createElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../components/Icon";
import { faPuzzlePiece } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { slotRegistry } from "../../plugins/slotRegistry";
import { AcpIcon, type AcpIconName } from "./pages/acpIcons";
import { useUploadAllowed } from "./hooks/useUploadAllowed";

export interface NavChild { label: string; to: string }
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
    label: "nav.users", icon: createElement(AcpIcon, { name: "user", size: 18 }), iconName: "user", key: "users",
    children: [
      { label: "nav.userList", to: "/admin/users" },
      { label: "nav.groups", to: "/admin/groups" },
      { label: "nav.profileFields", to: "/admin/profile-fields" },
      // Under Users, not Access control: a badge is something a user HOLDS, and
      // beside Progression it would sit next to the other, derived meaning of the word.
      { label: "nav.badges", to: "/admin/badges" },
    ],
  },
  {
    label: "nav.accessControl", icon: createElement(AcpIcon, { name: "layers", size: 18 }), iconName: "layers", key: "access",
    children: [
      { label: "nav.permissions", to: "/admin/permissions" },
      { label: "nav.progression", to: "/admin/progression" },
    ],
  },
  {
    label: "nav.content", icon: createElement(AcpIcon, { name: "file", size: 18 }), iconName: "file", key: "content",
    children: [
      { label: "nav.articles", to: "/admin/articles" },
      { label: "nav.categories", to: "/admin/categories" },
      { label: "nav.pages", to: "/admin/pages" },
    ],
  },
  {
    label: "nav.moderation", icon: createElement(AcpIcon, { name: "shield", size: 18 }), iconName: "shield", key: "moderation",
    children: [
      { label: "nav.reviewCases", to: "/admin/cases" },
      { label: "nav.modLog", to: "/admin/modlog" },
      { label: "nav.modSettings", to: "/admin/modsettings" },
      { label: "nav.modTemplates", to: "/admin/mod-templates" },
    ],
  },
  {
    label: "nav.appearance", icon: createElement(AcpIcon, { name: "palette", size: 18 }), iconName: "palette", key: "appearance",
    children: [
      { label: "nav.styleEditor", to: "/admin/style-editor" },
      { label: "nav.layoutEditor", to: "/admin/layout-editor" },
      { label: "nav.composer", to: "/admin/composer" },
      { label: "nav.themes", to: "/admin/themes" },
      // `style-history` retired 2026-08-26: the Style Editor's History tab is the
      // same list, beside the editor the snapshots came from. The route redirects.
      { label: "nav.navigation", to: "/admin/navigation" },
    ],
  },
  {
    label: "nav.extensions", icon: createElement(AcpIcon, { name: "puzzle", size: 18 }), iconName: "puzzle", key: "extensions",
    children: [
      { label: "nav.marketplace", to: "/admin/marketplace" },
      { label: "nav.installed", to: "/admin/installed" },
      { label: "nav.updates", to: "/admin/updates" },
      { label: "nav.upload", to: "/admin/upload" },
      { label: "nav.license", to: "/admin/license" },
    ],
  },
  {
    label: "nav.system", icon: createElement(AcpIcon, { name: "cog", size: 18 }), iconName: "cog", key: "system",
    children: [
      { label: "nav.settings", to: "/admin/settings" },
      { label: "nav.email", to: "/admin/email" },
      { label: "nav.scheduledTasks", to: "/admin/scheduled-tasks" },
      { label: "nav.errorReference", to: "/admin/error-ref" },
      { label: "nav.errorLog", to: "/admin/error-log" },
      { label: "nav.activityLog", to: "/admin/activity-log" },
      { label: "nav.migrationHistory", to: "/admin/migration-history" },
      { label: "nav.about", to: "/admin/about" },
    ],
  },
];

export interface AcpNavEntry {
  labelKey: string;
  subKey: string;
  icon: AcpIconName;
  to: string;
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
    return item.children.map((c) => ({
      labelKey: c.label, subKey: item.label, icon, to: c.to,
    }));
  }
  // Leaf entries (only the dashboard today) sit under a generic parent crumb.
  return item.to ? [{ labelKey: item.label, subKey: "nav.overview", icon, to: item.to }] : [];
});

/** Returns the core nav with plugin-registered sections merged in:
 *  "content-area" plugin sections (e.g. Forum) sit between Content and Moderation;
 *  everything else goes after Moderation — matching the original sidebar behavior. */
export function useAcpNav(): NavItem[] {
  const { data: pluginPages = [] } = useQuery<{ section: string; label: string; path: string; pluginId: string }[]>({
    queryKey: ["acp-registered-pages"],
    queryFn: () => api.get("/admin/registered-pages"),
    staleTime: 60_000,
  });
  const { data: uploadAllowed } = useUploadAllowed();

  const pluginSectionMap = pluginPages.reduce<Record<string, NavChild[]>>((acc, page) => {
    (acc[page.section] ??= []).push({ label: page.label, to: page.path });
    return acc;
  }, {});

  // A plugin page whose `section` matches an existing core section key (e.g.
  // "Users") nests INTO that core group rather than getting its own top-level
  // section. Everything else becomes a standalone plugin section.
  const coreKeys = new Set(ACP_NAV.map((n) => n.key).filter(Boolean) as string[]);
  const mergeIntoCore: Record<string, NavChild[]> = {};
  const standaloneMap: Record<string, NavChild[]> = {};
  for (const [section, children] of Object.entries(pluginSectionMap)) {
    const key = section.toLowerCase();
    if (coreKeys.has(key)) (mergeIntoCore[key] ??= []).push(...children);
    else standaloneMap[section] = children;
  }

  // Core nav with any merged plugin children appended to the matching section.
  // The Upload item is hidden unless manual uploads are enabled (default off).
  const baseNav: NavItem[] = ACP_NAV.map((item) => {
    let children = item.children;
    if (item.key === "extensions" && uploadAllowed !== true) {
      children = children?.filter((c) => c.to !== "/admin/upload");
    }
    if (item.key && mergeIntoCore[item.key]) {
      children = [...(children ?? []), ...mergeIntoCore[item.key]!];
    }
    return children === item.children ? item : { ...item, children };
  });

  const toNavItem = (section: string, children: NavChild[]): NavItem => {
    const meta = slotRegistry.getPluginMetaBySectionName(section);
    return {
      label: section,
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
  return !!item.children?.some((c) => path.startsWith(c.to));
}

/** The section the current route sits in, falling back to the first one. */
export function activeNavSection(nav: NavItem[], path: string): NavItem | undefined {
  return nav.find((n) => isNavItemActive(n, path)) ?? nav[0];
}

/** Stable identity for a nav item — its key, else its route, else its label. */
export function navItemId(item: NavItem): string {
  return item.key ?? item.to ?? item.label;
}

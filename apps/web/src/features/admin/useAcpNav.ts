import type { ReactNode } from "react";
import { createElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPuzzlePiece } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { slotRegistry } from "../../plugins/slotRegistry";
import { AcpIcon } from "./pages/acpIcons";

export interface NavChild { label: string; to: string }
export interface NavItem {
  label: string;        // `acp` i18n key for core items; literal label for plugin sections
  icon: ReactNode;
  to?: string;          // leaf item (no children)
  key?: string;         // grouping key
  children?: NavChild[];
}

// Core ACP nav. `label` values are `acp` i18n keys (resolved with t() at render).
// Plugin-registered sections supply literal labels — i18next returns the key as-is
// when it's missing, so those pass through untranslated, which is correct.
export const ACP_NAV: NavItem[] = [
  { label: "nav.dashboard", icon: createElement(AcpIcon, { name: "dashboard", size: 18 }), to: "/admin" },
  {
    label: "nav.users", icon: createElement(AcpIcon, { name: "user", size: 18 }), key: "users",
    children: [
      { label: "nav.userList", to: "/admin/users" },
      { label: "nav.groups", to: "/admin/groups" },
      { label: "nav.profileFields", to: "/admin/profile-fields" },
    ],
  },
  {
    label: "nav.accessControl", icon: createElement(AcpIcon, { name: "layers", size: 18 }), key: "access",
    children: [
      { label: "nav.permissions", to: "/admin/permissions" },
      { label: "nav.progression", to: "/admin/progression" },
    ],
  },
  {
    label: "nav.content", icon: createElement(AcpIcon, { name: "file", size: 18 }), key: "content",
    children: [
      { label: "nav.articles", to: "/admin/articles" },
      { label: "nav.categories", to: "/admin/categories" },
    ],
  },
  {
    label: "nav.moderation", icon: createElement(AcpIcon, { name: "shield", size: 18 }), key: "moderation",
    children: [
      { label: "nav.reviewCases", to: "/admin/cases" },
      { label: "nav.modLog", to: "/admin/modlog" },
      { label: "nav.modSettings", to: "/admin/modsettings" },
    ],
  },
  {
    label: "nav.appearance", icon: createElement(AcpIcon, { name: "palette", size: 18 }), key: "appearance",
    children: [
      { label: "nav.styleEditor", to: "/admin/style-editor" },
      { label: "nav.styles", to: "/admin/styles" },
      { label: "nav.styleHistory", to: "/admin/style-history" },
      { label: "nav.navigation", to: "/admin/navigation" },
      { label: "Guest Home", to: "/admin/guest-home" },
    ],
  },
  {
    label: "nav.extensions", icon: createElement(AcpIcon, { name: "puzzle", size: 18 }), key: "extensions",
    children: [
      { label: "nav.marketplace", to: "/admin/marketplace" },
      { label: "nav.installed", to: "/admin/installed" },
      { label: "nav.upload", to: "/admin/upload" },
      { label: "nav.license", to: "/admin/license" },
    ],
  },
  {
    label: "nav.system", icon: createElement(AcpIcon, { name: "cog", size: 18 }), key: "system",
    children: [
      { label: "nav.settings", to: "/admin/settings" },
      { label: "nav.scheduledTasks", to: "/admin/scheduled-tasks" },
      { label: "nav.errorReference", to: "/admin/error-ref" },
      { label: "nav.errorLog", to: "/admin/error-log" },
      { label: "nav.migrationHistory", to: "/admin/migration-history" },
      { label: "nav.about", to: "/admin/about" },
    ],
  },
];

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
    (acc[page.section] ??= []).push({ label: page.label, to: page.path });
    return acc;
  }, {});

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

  const contentAreaSections = Object.entries(pluginSectionMap)
    .filter(([s]) => slotRegistry.getPluginMetaBySectionName(s)?.acpSectionPosition === "after-content")
    .map(([s, ch]) => toNavItem(s, ch));
  const otherPluginSections = Object.entries(pluginSectionMap)
    .filter(([s]) => slotRegistry.getPluginMetaBySectionName(s)?.acpSectionPosition !== "after-content")
    .map(([s, ch]) => toNavItem(s, ch));

  const contentIdx = ACP_NAV.findIndex((n) => n.key === "content");
  const moderationIdx = ACP_NAV.findIndex((n) => n.key === "moderation");
  return [
    ...ACP_NAV.slice(0, contentIdx + 1),
    ...contentAreaSections,
    ...ACP_NAV.slice(contentIdx + 1, moderationIdx + 1),
    ...otherPluginSections,
    ...ACP_NAV.slice(moderationIdx + 1),
  ];
}

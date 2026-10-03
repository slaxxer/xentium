import { describe, it, expect } from "vitest";
import { ACP_NAV, ACP_NAV_INDEX, isNavItemActive, activeNavSection, navItemId } from "./useAcpNav";

/**
 * The topbar breadcrumb and command palette used to keep their own copy of the
 * nav, and six routes had quietly drifted out of it — each one rendering no
 * breadcrumb and unreachable from the palette. The index is derived now; these
 * assert it stays that way.
 */
describe("ACP_NAV_INDEX", () => {
  const navRoutes = ACP_NAV.flatMap((item) =>
    item.children?.length ? item.children.map((c) => c.to) : item.to ? [item.to] : [],
  );

  it("covers every route in the nav", () => {
    const indexed = new Set(ACP_NAV_INDEX.map((e) => e.to));
    const missing = navRoutes.filter((to) => !indexed.has(to));
    expect(missing, `routes absent from the index: ${missing.join(", ")}`).toEqual([]);
  });

  it("indexes nothing the nav does not contain", () => {
    // Pages reached THROUGH a nav entry (`within`) are in the index for the breadcrumb
    // and carry their parent; nothing else may be indexed without a nav entry.
    const navSet = new Set(navRoutes);
    const extra = ACP_NAV_INDEX.filter((e) => !e.parentKey).map((e) => e.to).filter((to) => !navSet.has(to));
    expect(extra, `routes indexed but not in the nav: ${extra.join(", ")}`).toEqual([]);
  });

  it("reaches Theme Studio only through Themes", () => {
    const studio = ACP_NAV_INDEX.filter((e) => e.to === "/admin/theme-studio");
    expect(studio.map((e) => e.parentKey)).toEqual(["nav.themes"]);
    expect(navRoutes).not.toContain("/admin/theme-studio");
    // The two editors it replaced are redirects now, and appear nowhere in the nav.
    expect(ACP_NAV_INDEX.some((e) => e.to === "/admin/style-editor" || e.to === "/admin/layout-editor")).toBe(false);
  });

  it("gives every entry a label, a parent crumb and an icon", () => {
    for (const e of ACP_NAV_INDEX) {
      expect(e.labelKey, e.to).toBeTruthy();
      expect(e.subKey, e.to).toBeTruthy();
      expect(e.icon, e.to).toBeTruthy();
    }
  });

  it("uses i18n keys for labels, not literal text", () => {
    // A literal slipped in once already ("Guest Home"), which then failed to
    // translate in every non-English locale.
    const literals = ACP_NAV_INDEX.filter((e) => !e.labelKey.startsWith("nav."));
    expect(literals.map((e) => e.labelKey)).toEqual([]);
  });

  it("points children at their own section as the parent crumb", () => {
    for (const item of ACP_NAV) {
      for (const child of item.children ?? []) {
        const entry = ACP_NAV_INDEX.find((e) => e.to === child.to);
        expect(entry?.subKey, child.to).toBe(item.label);
      }
    }
  });

  it("has no duplicate routes", () => {
    const seen = ACP_NAV_INDEX.map((e) => e.to);
    expect(seen.length).toBe(new Set(seen).size);
  });
});

/** Mirrors the breadcrumb resolution in AcpTopbar: longest matching `to` wins. */
function resolveCrumb(pathname: string) {
  return ACP_NAV_INDEX
    .filter((n) => pathname === n.to || (n.to !== "/admin" && pathname.startsWith(n.to)))
    .sort((a, b) => b.to.length - a.to.length)[0];
}

describe("breadcrumb resolution", () => {
  it.each([
    ["/admin/email", "nav.email", "nav.system"],
    ["/admin/settings", "nav.settings", "nav.system"],
    ["/admin/legal", "nav.legal", "nav.content"],
    ["/admin/cases", "nav.reviewCases", "nav.moderation"],
    ["/admin/updates", "nav.updates", "nav.extensions"],
    ["/admin/activity-log", "nav.activityLog", "nav.system"],
  ])("%s → %s under %s", (path, labelKey, subKey) => {
    const crumb = resolveCrumb(path);
    expect(crumb, `no breadcrumb for ${path}`).toBeDefined();
    expect(crumb!.labelKey).toBe(labelKey);
    expect(crumb!.subKey).toBe(subKey);
  });

  it("every nav route resolves to a breadcrumb", () => {
    const unresolved = ACP_NAV_INDEX.map((e) => e.to).filter((to) => !resolveCrumb(to));
    expect(unresolved, `no breadcrumb for: ${unresolved.join(", ")}`).toEqual([]);
  });
});

/**
 * The rail draws one cell per section and marks exactly one of them as where
 * you are. Both chromes resolve that from `isNavItemActive`, so a wrong answer
 * here is an indicator bar that never moves.
 */
describe("isNavItemActive", () => {
  const section = (key: string) => ACP_NAV.find((n) => n.key === key)!;
  const dashboard = ACP_NAV.find((n) => n.to === "/admin")!;

  it("matches the dashboard only on its exact route", () => {
    expect(isNavItemActive(dashboard, "/admin")).toBe(true);
    // ⚠ The whole panel lives under /admin. A prefix match here would light
    // the dashboard on every page there is.
    expect(isNavItemActive(dashboard, "/admin/users")).toBe(false);
    expect(isNavItemActive(dashboard, "/admin/settings")).toBe(false);
  });

  it("matches a group through any of its children", () => {
    expect(isNavItemActive(section("users"), "/admin/groups")).toBe(true);
    expect(isNavItemActive(section("users"), "/admin/badges")).toBe(true);
    expect(isNavItemActive(section("users"), "/admin/permissions")).toBe(false);
  });

  it("matches a child's own sub-routes", () => {
    expect(isNavItemActive(section("content"), "/admin/articles/new")).toBe(true);
  });

  it("picks exactly one section for every route in the nav", () => {
    for (const { to } of ACP_NAV_INDEX) {
      const hits = ACP_NAV.filter((n) => isNavItemActive(n, to));
      expect(hits.map(navItemId), `route ${to}`).toHaveLength(1);
    }
  });

  it("falls back to the first section for an unknown route", () => {
    expect(activeNavSection(ACP_NAV, "/admin/nowhere")).toBe(ACP_NAV[0]);
  });
});

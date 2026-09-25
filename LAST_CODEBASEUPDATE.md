# Last codebase update

Three commits, all in `apps/web`. No API, schema or contract changes.

## fix(installer): say what a locked add-on actually needs

`addons.cta_locked` is shown only when an account IS linked and does not hold the licence, but
it read "Link to unlock" — advice the admin has already followed.

- `apps/web/public/locales/*/installer.json` — the one string, in all five languages.

## feat(acp): icon rail + section panel navigation

The "ACP redesign navbar" mock, integrated. The panel wears one of two chromes, chosen per
admin and remembered in `localStorage`.

- `apps/web/src/features/admin/nav/acpChrome.ts` — the preference store (layout, collapsed).
  A module-level store, not context: the rail, the panel, the utility bar and the user menu all
  read it and none is an ancestor of the others.
- `nav/AcpRail.tsx` — the 72px rail. A section click navigates when docked and **peeks** when
  collapsed. `is-here` (the route) and `is-active` (what is lit) are separate classes on
  purpose — they come apart while peeking.
- `nav/AcpPanel.tsx` — the 248px panel; one component for the docked column and the flyout.
  Deliberately does NOT nest a page's own sub-sections: every ACP page owns its secnav, and
  mirroring System Settings' eight here would be two lists that must agree.
- `nav/AcpRailShell.tsx` — the three states. `narrow` is a viewport fact that overrides the
  admin's preference rather than overwriting it.
- `nav/AcpUtilityBar.tsx` — the one 44px line: breadcrumb, plus the palette when the panel is
  collapsed and nothing else names the section.
- `nav/AcpSearch.tsx`, `nav/AcpUserMenu.tsx`, `nav/useDismiss.ts` — lifted out of
  `AcpTopbar.tsx` so both chromes share one palette and one menu. `AcpTopbar.tsx` drops from
  316 lines to 67 and is now only an arrangement.
- `nav/AcpChrome.scss` — layout only, every colour an ACP token. ⚠ Its `.nbsearch` /
  `.nbpal` / `.nbpop` variants use **doubled class names**: `AcpTopbar.scss` is imported
  through `AcpTopbar.tsx`, i.e. after this file, so at equal specificity the base rules won.
  A plain `.nbsearch--compact` lost and the panel's field hung out over the page.
- `useAcpNav.ts` — `isNavItemActive` / `activeNavSection` / `navItemId`, shared by both
  chromes. ⚠ The dashboard is an EXACT match: every ACP route starts with `/admin`, so a
  prefix match lights it everywhere and the rail's indicator never moves.
- `useAcpNav.test.ts` — five tests pinning that, including "exactly one section per route".
- `pages/acpIcons.tsx` — `chevronsLeft` / `chevronsRight` for collapse and dock.
- `AcpLayout.scss` — removed ~200 dead lines (`.acp-sidebar`, `.acp-nav__*`).

## feat(acp): broadcasts as a band, not a modal; no bell in the panel

- `components/AnnouncementBanner.tsx` + `.scss` — the band. Full-bleed, but its contents sit in
  the same column as the page so the two share a left edge; the severity wash exists because
  the stripe would otherwise sit 110px from its own content on a wide screen. Acknowledgement
  is optimistic; a failed write means the notice returns, which is the safe direction.
- `AcpLayout.tsx` — the announcement branch, its query and its rank table come out of
  `useAcpAlerts`. Licence and update dialogs are unchanged, and now reach the admin a visit
  earlier.
- `AcpTopbar.tsx`, `nav/AcpUtilityBar.tsx` — `NotificationBell` and
  `slotRegistry.getHeaderWidgets()` removed from both chromes. The slot itself is untouched;
  it still renders in `layout/blocks/chromeBlocks.tsx`.
- `pages/AnnouncementsPage.scss`, `locales/*/acp.json` — the dialog-only rules and
  `announcements.dialogNote` go with the dialog; `announcements.moreWaiting` arrives.

## Verified

`pnpm backbone:check` green; 768 web tests pass. Both chromes, collapse, flyout, the palette,
the admin menu, the band at all three severities and the acknowledgement round-trip were
checked in Chrome at 1400px, 900px and 680px — three bugs (the overflowing search field, a
second ⌘K listener, the vanishing indicator bar) were found that way and not by the build.

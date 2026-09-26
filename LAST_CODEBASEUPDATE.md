# Last codebase update

Core-update dialog, redone after testing alpha.7's notice locally (unpushed).

- `apps/api/src/config/envProbe.ts` (+ `envProbe.test.ts`): `cliSiteDir()`, the site directory of a CLI install, from `XENTIUM_ENV_FILE`.
- `apps/api/src/jobs/coreUpdateCheck.ts` (+ test): the anchor also moves when the offer's severity changes.
- `apps/api/src/modules/admin/marketplace.service.ts`, `admin.controller.ts`, `admin.routes.ts`: `core.path` (newest first) and `core.siteDir`; `POST /admin/marketplace/updates/core/acknowledge` ("Got it"), counted alongside the Updates-page visit.
- `apps/web/src/components/ReleaseNotes.tsx` (+ scss, test): a small Markdown reader for changelogs that builds React elements, never HTML.
- `apps/web/src/features/admin/components/coreUpdateParts.tsx` (+ `CoreUpdate.scss`, test): the command (named version, CLI first), changelog, warnings and dialog body, shared by the dialog and the card.
- `apps/web/src/features/admin/components/CoreUpdateCard.tsx`: rebuilt from the shared parts.
- `apps/web/src/features/admin/AcpLayout.tsx`: prereleases open the dialog; large panel, calm prerelease badge, "Got it" acknowledges.
- `apps/web/src/lib/dialog.ts`, `components/DialogHost.tsx/.scss`: `large` panel size and `badgeTone: "calm"`.
- Locales ×5: new `coreUpdate.*` keys, `onTheWay` reworded, `dialogBlocked` removed.
- `apps/docs/src/content/docs/admin/updating.md`, `docs/API.md`: the dialog, the command, the endpoint.

ACP chrome fixes (same session):
- `apps/web/src/features/admin/nav/AcpUtilityBar.tsx` deleted; `AcpRailShell.tsx` no longer renders it; `.acp-util` + `$util-h` removed from `AcpChrome.scss`.
- `nav/AcpSearch.tsx`: `variant="rail"`, an icon in the collapsed rail that opens the palette centred; `nav/AcpRail.tsx` mounts it when collapsed.
- `nav/AcpUserMenu.tsx` + `AcpChrome.scss`: the rail menu is `position: fixed`, placed from the avatar (the scrolling rail clipped it); `AcpTopbar.scss`: `.nbpop--user` min-width + max-content so segment labels fit.
- `AcpLayout.tsx`: comment updated.

Core updates as a one-time dialog (same session):
- `features/admin/components/CoreUpdateCard.tsx` deleted; its types moved to `coreUpdateParts.tsx` (+ `PluginUpdateList`); `pages/UpdatesPage.tsx` lists plugins only.
- `AcpLayout.tsx`: every core release opens the dialog once (no patch exception, any close acknowledges); pending plugin updates listed inside it; the plugin dialog doesn't follow it in the same visit.
- `marketplace.service.ts`: core acknowledged only by the dialog mark; core dropped from `getStatusSummary` (badge).
- Locales ×5: `coreUpdate.pluginsTitle`, `dialogPlugins`, `dialogClose`; card strings removed. Docs updated.

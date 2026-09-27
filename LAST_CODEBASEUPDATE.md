# Last codebase update

Composer click fix.

- `apps/web/src/components/composer/Composer.tsx`: a press on the body's empty area puts the caret at
  the end of the text. With `minHeight` the editable element stayed one line tall, so clicks in the rest
  of the box focused nothing. `EditorContent` gets `className="nvc-editor"` so a press on its wrapper
  counts too.
- `CHANGELOG.md`: Fixed entry for the above.

ACP Users redesign (nodevo-redesign/Admin user management redesign):
- `apps/api/src/modules/admin/adminUsers.service.ts` (new, + `adminUsers.test.ts`): the list (status, sort, search by
  name/email/id/IP, counts, last seen from sessions, online from Redis, flags), the member page with an explicit
  select (no password or PIN hash), known IPs/devices, and `patchUserGroups` (add/remove, never replace).
- `admin.service.ts`: `listUsers` / `getUserDetail` / `patchUserGroups` delegate to it.
- `admin.controller.ts` + `admin.routes.ts`: `status` and `sort` on `GET /admin/users` (status was silently dropped),
  `PATCH /admin/users/:id/groups {add, remove}`.
- `apps/web/src/features/admin/pages/UserListPage.tsx`: rebuilt (command bar, segments, table, selection, bulk bar).
- `apps/web/src/features/admin/pages/UserDetailPage.tsx` + `.scss`: tabs, risk banner, membership draft saved as a
  delta, security tiles, event table with device names, ban reason line.
- `apps/web/src/features/admin/pages/users/usersShared.tsx` + `Users.scss` (new): types, role/status/flag pills,
  the ban dialog with presets (one request per member).
- Locales x5: `acp.users.*`.
- `docs/API.md`: `GET /admin/users` query + response, `GET /admin/users/:id`, `PATCH /admin/users/:id/groups`.

Create/edit article redesign (nodevo-redesign/Create article redesign):
- `apps/web/src/features/articles/ArticleEditorPage.tsx` + `.scss`: rebuilt (top bar with save chip, full-width
  canvas, excerpt, the shared Composer as the body, inline publish requirements, Details slide-over). Status is
  Draft/Published (unpublish on switch back); "Review" removed (the API cannot store it). Local autosave only
  when the form differs from the last server save (fixes the false "unsaved draft" prompt after saving).
  New prefix `aed`.
- `apps/web/src/features/admin/pages/PageEditorPage.scss` (moved from `ArticleEditorPage.scss`): the ACP page
  editor keeps the old `aep` styles.
- `apps/web/src/components/composer/Composer.tsx` (+ tests): `initialJson` / `onChangeJson`, `extraExtensions`,
  `mentions`, `getJSON()` on the handle; `setEditable(…, false)` so mounting is not reported as an edit.
- Locales x5: `articles.editor.*` additions.

# Last Codebase Update — 2026-07-19 (session 5)

## Streamed update progress dialog + update-check on install — UNCOMMITTED

User: on the /updates page, hitting Update should show a real-time progress bar in
a dialog (not a toast); remove the success toast. Plus a real gap fixed: install
didn't refresh the update cache.

### Streamed progress (server)
- `admin.controller.ts`: `updateFromMarketplace` now STREAMS newline-delimited JSON.
  Split the old `fetchMarketplaceArtifact` into `downloadAndVerifyArtifact(pluginId,
  version, onProgress?)` — throws `ArtifactError(status)`, STREAMS the download body
  for real byte progress (10..65%), reports authorize/verify/validate. A thin
  `fetchMarketplaceArtifact(res)` wrapper keeps the non-streaming install path
  (translates throws → HTTP error). The stream controller emits each progress event
  + a terminal `{done, ok, ...}`; on error (headers already sent) it emits a terminal
  error event instead of an HTTP error.
- `plugin-engine.ts` `updatePlugin` gains `onProgress?` — emits disabling(80)/
  applying(85)/migrating(90)/enabling(95). `plugin.service.ts` threads it through.

### Progress dialog (client)
- `lib/dialog.ts`: `kind: "progress"` + `DialogProgress` + `openProgressDialog()`
  returning an imperative `ProgressHandle` (update/succeed/fail/close). Non-promise,
  non-dismissible while running; a newer dialog invalidates a stale handle.
- `DialogHost.tsx` + `.scss`: renders the live bar (colored by `--_dlg-c`, green/red
  on success/error), step label + percent; no actions while running, a Close button
  when done; Escape/backdrop disabled while running. Icon reflects the outcome.
- `lib/api.ts`: `apiStream(path, body)` — authed POST returning the raw Response for
  reading `res.body` (Bearer + 401-refresh retry; does not parse/throw).
- `UpdatesPage.tsx`: Update button → `openProgressDialog` + `apiStream`, reads the
  ndjson stream and drives the bar per phase; success invalidates updates/installed/
  status-summary queries. **Success toast removed** (updates.toastUpdated/toastFailed
  deleted from locales); phase + progress labels added ×5 (`updates.phase.*`,
  progressTitle/Done/Failed).

### Update-check on install (fix)
- `admin.controller.ts` `installFromMarketplace` + `plugin.routes.ts` upload route:
  fire-and-forget `processUpdateCheck()` after install so a freshly-installed older
  build surfaces its update on the next ACP entry (not up to a day later).

### Verification
- API + web typecheck; lint 0 errors.
- E2E on the test instance vs live marketplace (mock res capturing the stream):
  shoutbox 1.0.0→1.0.1 emitted `5 authorizing` → ~20 real byte events `10..65
  downloading` → `70 verifying` → `75 validating` → `80 disabling` → `85 applying`
  → `90 migrating` → `95 enabling` → `DONE ok=true → Shoutbox 1.0.1`; plugin updated.
- Demo reset: shoutbox 1.0.0, license +10d, acks cleared → both ACP-entry dialogs
  fire, badge total 2; stream endpoint mounted (401).
- ⚠ No compression middleware + Vite proxy passes streams → streaming is safe here.

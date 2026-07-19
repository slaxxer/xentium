# Last Codebase Update — 2026-07-19 (session 2)

## Per-admin update dialog (via ACP movement log) + update-check on worker boot — UNCOMMITTED

Follow-up to the plugin-updates batch (PR #47). User wanted the ACP-entry update
dialog to stop being silenced by a bare reload / "Later", and to persist until the
admin has actually engaged with the Updates page — anchored on our activity log,
which already records page movements.

### Update-check on worker boot
- `apps/api/src/workerBoot.ts`: after scheduling jobs, runs `processUpdateCheck()` once
  on boot (best-effort, non-blocking, `.catch`-guarded). Gated on the update-check job's
  `enabled` config (getJobConfig), so disabling update-check in ACP → Scheduled Tasks
  silences the boot check too. Surfaces a critical patch immediately after a restart
  instead of waiting for the daily 02:30 run.

### Per-admin, visit-based dialog acknowledgement
- **Log ACP movements** — `apps/web/src/hooks/useActivityLogger.ts`: removed the
  `if (path.startsWith("/admin")) return` skip. ACP navigations now log as `page_visit`
  (the server-side `acpActivityLogger` only logs mutations, so page views must come from
  the client). Gives a real admin movement trail + drives the dialog.
- **Time-anchor the update set** — `apps/api/src/jobs/updateCheck.ts`: the cache now
  carries `setSince` = when the current pending set first appeared. Computed by comparing
  the new set hash (`pluginId@latestVersion` sorted) to the stored one; carried forward
  unchanged across daily re-checks that don't change the set (unlike `checkedAt`, which
  moves every run). Robust to the Json column holding either a string or parsed object.
- **`acknowledged` in the updates response** — `apps/api/src/modules/admin/admin.controller.ts`
  `getMarketplaceUpdates`: returns `acknowledged` = has THIS admin (`req.userId`) a
  `page_visit` to `/admin/updates` since `setSince`. Missing `setSince` (pre-anchor cache)
  → unacknowledged (still nudge). No pending updates / no cache → acknowledged true.
- **`activityService.hasVisitedSince(userId, path, since)`** —
  `apps/api/src/modules/activity/activity.service.ts`: indexed `findFirst` on the
  page_visit log. The single acknowledgement primitive.
- **Dialog reads the server flag** — `apps/web/src/features/admin/AcpLayout.tsx`:
  dropped `localStorage` (`nv-acp-updates-seen`) entirely. Shows the dialog while
  `!acknowledged`; a `useRef` guards against a double-fire on refetch within one ACP
  session. Later/Escape persist nothing (only the Updates-page VISIT acknowledges);
  View → `/admin/updates` (which logs the visit). New set → new anchor → fires again.

### Verification
- Both apps typecheck; lint 0 errors (pre-existing warnings only).
- Service-level E2E on the test instance — 6 invariants all pass: setSince stamped;
  not-acknowledged before visit; acknowledged after visit; setSince PRESERVED on an
  unchanged re-check (checkedAt advances, anchor holds); still acknowledged after
  re-check; a moved anchor invalidates an older visit (dialog re-fires).
- Worker-boot check verified separately: running the worker advanced the cache
  `checkedAt` (hit the live marketplace) — see session-1 notes.
- Test instance reset to demo state: shoutbox 1.0.0 + `marketplace.updates` seeded 1.0.1
  critical pending WITH setSince; one clean API + web restarted; `/activity/visit` route
  live (204). Ready for browser click-through.
- ⚠ Note: logging all ACP movements adds page_visit rows (user-approved scope). Consider
  activity-log retention/pruning if volume grows.

Both changes committed together (this + worker-boot).

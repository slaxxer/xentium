# Last Codebase Update — 2026-07-26 (admin-created scheduled tasks)

The ACP Scheduled Tasks page used to answer only "when do the built-in jobs run?".
An admin could not create a recurring job of their own — every piece of periodic
maintenance had to ship as code. This adds admin-composed tasks: a name, an action
from a fixed core catalogue, validated params and a schedule.

**The security shape is deliberate.** A scheduler that can execute admin-supplied
code turns any admin-session compromise into server compromise, so there is no
arbitrary-code path: core runs only handlers registered in the action registry.
Plugin cron jobs stay out of the registry too — a plugin owns its schedules end to
end (it calls `upsertJobScheduler` itself in `onEnable`), so a task can never point
at a handler that vanishes when a plugin is disabled. Plugins get only the cron
maths, via `host.utils.cron`.

## A — Schema (2 new tables, 51 core tables total)

- `prisma/schema.prisma` + `prisma/migrations/20260726010000_scheduled_tasks/` —
  `ncf_scheduled_tasks` (name, `action_key`, `params` JSONB, `schedule` JSONB,
  enabled, `dry_run`, denormalized `last_run_at`/`last_status` so the ACP list
  needs no per-row subquery) and `ncf_scheduled_task_runs` (per-run history,
  `status` = running|ok|error|skipped, duration, summary, error; FK cascade).

## A2 — Session leak (the reason the retention job grew)

`ncf_sessions` had no cleanup path at all and is the fastest-growing table in the
schema: the refresh token rotates on every use and a rotation REVOKES the old row
and INSERTS a new one (`auth.tokens.ts`) rather than updating in place. With a
15-minute access token that is ~96 rows per continuously-active user per day, and
no `prisma.session.delete` existed anywhere in the codebase.

- `apps/api/src/jobs/logRetention.ts` — `retention.sessions_days` (30) prunes rows
  that can no longer authenticate anything (`revokedAt` set OR past `expiresAt`)
  and whose last activity is outside the window. Verified safe: all four readers
  of the table already filter to `revokedAt: null, expiresAt > now`, and the
  security scanners correlate device/IP through `ncf_login_events`, not here.
  `retention.auth_tokens_days` (7) clears spent `ncf_password_reset_tokens` /
  `ncf_email_change_tokens`, both minutes-lived.
- `prisma/schema.prisma` + `migrations/20260726020000_session_retention_index/` —
  `@@index([lastUsedAt])` on `ncf_sessions`; without it the daily prune is a seq
  scan of the biggest table in the schema.

Deliberately code-owned rather than a catalogue action: pruning dead sessions is
not a judgment call an admin should be able to forget to make.

## B — Action registry + the first actions

- `apps/api/src/jobs/scheduled-actions/action-registry.ts` — `ScheduledActionDef`
  (`key`, `label`, `description`, `domain`, Zod `params`, `minIntervalSec`,
  `destructive?`, `run(params, ctx)`). Core-internal, NOT exposed via the plugin
  SDK. `ActionRunCtx.dryRun` is a contract: the action must report, never write.
- `apps/api/src/jobs/scheduled-actions/recomputeCounters.ts` — the first action,
  `system.recompute-counters`. Repairs drift in 9 denormalized counters
  (`users.article_count/comment_count/like_count_received/follower_count/
  following_count`, `articles.comment_count/like_count/dislike_count`,
  `profile_comments.like_count`) by recomputing each from its source rows.
  Idempotent; dry-run counts the same predicate the UPDATE would use, so the
  reported number is exactly what a real run would write. Floor 1h (full-table
  scans). Deliberately does NOT touch forum `post_count`/`thread_count` (forum-
  owned — recomputing here would zero them) or article `view_count` (telemetry,
  not derivable). Documented semantic caveat: `article_count` is recomputed as
  "currently published and not deleted", the only derivable reading — it can fall
  on sites that deleted published articles, and can delay (never undo) a promotion.
- `apps/api/src/jobs/scheduled-actions/purgeOrphanedUploads.ts` — the second
  action, `system.purge-orphaned-uploads` (destructive, 6h floor). Nothing in the
  codebase deletes an upload except the appearance logo swap, so replaced avatars
  and group icons and the whole upload directory of a hard-deleted article or page
  stay on disk forever. Three guards, each protecting against a way this could
  destroy live data:
  1. **Body JSON counts as a reference.** Inline page images (`pages/<id>/img-*`)
     live only inside the ProseMirror body, never in a column — a scan of
     `featured_image` alone would delete every inline image on the site. Bodies are
     scanned for `/uploads/...` via SQL `regexp_matches` so large bodies are never
     loaded into memory.
  2. **Soft-deleted rows still count**, so a restored article keeps its image.
  3. **A grace period on file mtime** (`graceHours`, default 24) so an upload whose
     owning row is still being written is never swept out from under the request.
  Plugin upload folders (`forum-attachments/`, `plugins/`, `shoutbox-smileys/` on
  a dev box) are siblings of the core folders in `UPLOAD_DIR` and are NEVER
  touched — `ROOTS` is an allowlist of core folders, not a scan of the directory.
  Core cannot know what references a plugin's files; sweeping them would delete
  every forum attachment on the site.
- `apps/api/src/jobs/scheduled-actions/purgeDeletedContent.ts` —
  `system.purge-deleted-content` (destructive, 12h floor; params `days`, `scope`).
  Hard-deletes articles / article comments / profile comments soft-deleted longer
  ago than the window. **The reply hazard:** `ArticleComment.parent` is
  `onDelete: Cascade`, so purging one soft-deleted comment also deletes its
  replies — a moderator hides one spam comment, three people had already answered
  it, and a naive purge destroys all three. The rule is therefore stricter than
  "old enough": a recursive CTE keeps only roots whose ENTIRE reply subtree is
  also soft-deleted past the same cutoff (`bool_and`), and anything with a living
  descendant at any depth is skipped and reported. The skipped count is surfaced
  in the summary so it never looks like the purge silently did nothing. Counters
  are unaffected — every counter in recompute-counters already filters
  `deleted_at IS NULL`. Uploads are left to the orphan sweep rather than deleted
  here, so each action has one job.
- `apps/api/src/jobs/scheduled-actions/trimArticleRevisions.ts` —
  `system.trim-article-revisions` (params `keep`, default 20). Every save stores a
  full copy of the ProseMirror body and nothing removes one, so a daily-edited
  article carries 365 copies of itself a year in. One window function over all
  articles rather than a query per article. The live article is not a revision,
  so even `keep: 1` cannot lose current content.
- `apps/api/src/jobs/scheduled-actions/pruneNotifications.ts` —
  `system.prune-notifications` (params `readDays` 30, `unreadDays` 90). Read and
  unread age out on separate clocks: a read notification has done its job, an
  unread one still owes the user something. Either at 0 keeps that half forever.
  A catalogue action rather than a log-retention window because notifications are
  user-facing content — whether they are a transient feed or a scrollback archive
  is a decision about the community, not about disk.

## C — Runner, queue, reconcile

- `apps/api/src/jobs/scheduledTask.ts` — one `scheduled-task` queue serves every
  task; the scheduler id (`task:<id>`) carries the task id and the payload is just
  `{ taskId }`, so editing params or the dry-run flag never touches Redis. The row
  is resolved at RUN time. Params are re-validated on every run — a task can
  outlive a schema change, and that must fail loudly on one run rather than
  silently do the wrong thing. Expected failures (missing row, unknown action, bad
  params) are recorded as `error`, not dead-lettered; retrying would fail
  identically. A missing row also removes its own scheduler, so it self-heals.
  `reconcileScheduledTasks()` converges Redis with Postgres on boot: drops
  schedulers with no enabled row (a task deleted while the worker was down keeps
  firing otherwise) and re-asserts every enabled task (survives a Redis flush).
- `apps/api/src/infrastructure/queue.ts` — the `scheduledTask` queue.
- `apps/api/src/workerBoot.ts` — starts the worker and runs the reconcile AFTER
  plugin init, for the same reason the other boot jobs do: a half-initialized
  process draws wrong conclusions about what should exist.

## D — ACP API + permission

- `apps/api/src/modules/scheduled-tasks/` — routes/controller/service/validation.
  Mounted at `/api/admin/tasks` so `acpActivityLogger` audits every mutation, but
  gated on the new `system.tasks.manage` rather than plain `admin.access`: these
  run unattended and some actions destroy data, so the capability can be withheld
  from an admin who should not automate it. Create/update push the schedule into
  BullMQ only after validating the resolved cron, and roll the row back if Redis
  rejects it — Postgres and Redis never disagree. Delete removes the scheduler
  first (a surviving scheduler with no row fires forever; a row with no scheduler
  is merely inert). "Run now" carries a one-off `dryRun` in the payload so a manual
  test cannot race a scheduled run.
- `packages/contracts/src/permissions.ts` — `SYSTEM_TASKS_MANAGE`. Auto-seeded by
  `registerCorePermissions` on boot; admin already grants everything.
- The effective floor is the stricter of a global 5 min and the action's own
  `minIntervalSec`, so "prune 2M rows" and "send a digest" don't share a minimum.
- `GET /admin/tasks/actions` also publishes each action's params contract as JSON
  Schema (`z.toJSONSchema`, Zod 4), derived from the SAME Zod schema the server
  validates with — a hand-written field list would drift the moment an action
  gained a parameter. Unrepresentable schemas return null rather than throwing.

## E — Cron maths shared with plugins

- `apps/api/src/jobs/scheduledJobs.ts` — `resolveCron` split into
  `resolveCronPattern(cfg, fallbackCron)` so admin-created tasks (which have no
  code-owned default) can reuse it. Behaviour for the built-in jobs is unchanged.
- `packages/plugin-sdk/src/index.ts` + `plugin-context.ts` — `host.utils.cron`
  (`resolveCron`, `previewRuns`). Core does not manage, display or own a plugin's
  schedules; this only stops every plugin re-implementing cron parsing and its
  guardrails.

## F — Run-history retention

- `apps/api/src/jobs/logRetention.ts` + `admin.service.ts` SETTING_DEFAULTS —
  `retention.task_runs_days` (default 90). A task on a 5-minute schedule writes
  ~105k rows a year, so the history is pruned by the existing log-retention job
  rather than owning a cleanup path of its own. The most recent run also lives
  denormalized on the task row, so pruning never blanks the ACP summary line.

## G — ACP UI + i18n

- `apps/web/src/features/admin/pages/CustomTasksSection.tsx` — renders as a right-
  hand **aside** on the Scheduled Tasks page: "New task", then compact task cards
  (action, cron, timezone, next run, last-run status), dry-run/run/edit/delete/
  toggle, and collapsible run history. Create and edit use an explicit-Save entity
  modal, not autosave — a half-typed name must not create a task; the modal is
  `position: fixed` so it centres on the viewport rather than inside the aside.
  Destructive actions show a warning and push dry-run first. Toasts and dialogs
  use the core primitives (`lib/toast`, `lib/dialog`), not the swal shim. The
  section hides itself on 403 only, so a network blip cannot make a configured
  task list silently disappear. `ParamsFields` renders the action's parameters
  from the published JSON Schema — number (with min/max), text, enum select and
  checkbox, using `title`/`description` where the Zod schema sets `.meta()` and a
  prettified key otherwise. Unsupported field types are skipped rather than
  guessed at. Switching action resets params to the new action's defaults;
  carrying the old ones over would 422 on every field.
- `apps/web/src/features/admin/pages/ScheduledJobsPage.{tsx,scss}` — two-column
  layout (`.sched-layout`): code-owned jobs left, custom tasks aside right. Both
  answer "what runs on a schedule here?", so splitting them across two nav entries
  would hide half the answer — but stacking the tasks *below* the jobs put "New
  task" behind a scroll past every built-in job. The aside is sticky with its own
  scroll so a long task list cannot push it out of the viewport it is pinned to,
  and collapses to a normal block below 1080px, where it has no room to be an
  aside. Page max-width 860 → 1260 to make room.
- `apps/web/public/locales/{en,de,es,fr,pt}/acp.json` — the `tasks` block.

## Verification

`pnpm backbone:check` green (typecheck 19/19, lint 0 errors, 52 tests, build 14/14).
Runtime-checked against the dev stack: create → scheduler lands in Redis → sub-floor
interval rejected with the schedule rolled back → dry run records `ok` and writes
nothing → real run records → `lastStatus` denormalized → unknown action recorded as
an error run rather than crashing → reconcile drops an orphaned scheduler and keeps
the live one → delete removes scheduler and cascades history. Counter repair checked
against deliberate drift: dry run reports "would repair 1", leaves the value alone;
the real run fixes it; the next run is a no-op.

Driven in the browser at the ACP: aside renders right of the jobs, create dialog
centres over the page, a created task shows cron/next-run in the narrow column, a
dry run round-trips through the real queue and lands as `ok … 18 ms DRY` with its
summary in the history, and delete confirms and clears back to the empty state.

Session/token prune checked against the four corners (old+revoked and old+expired
deleted; old-but-live and recent-revoked kept) plus expired vs in-window tokens,
and the planner uses the new index for the prune predicate.

Params contract checked end to end: the schema published for the purge action
carries title/description/min/max/default/enum, non-default params survive
create → read → run (a `scope: avatars` task reported "in avatars"), an
out-of-range value is refused at SAVE time with a field-level message, and an
unknown key never reaches storage.

The form itself was then driven in the ACP: it renders the number field with its
default and the enum select with exactly the six schema values, switching to the
paramless action removes both fields AND the destructive banner, switching back
restores defaults rather than stale values, a task saved with `graceHours: 72,
scope: avatars` stored exactly that, the edit dialog reads those values back, and
the run reported "No orphaned uploads in avatars" — the scope param honoured at
run time, driven entirely through the UI.

Orphan purge checked against a fixture covering every branch: a referenced avatar,
an orphan, a file inside the grace period, an image referenced ONLY from a page
body, an unreferenced page image, and a file outside a narrowed scope. All kept /
deleted correctly, second run a no-op. Run for real against the dev upload
directory it reclaimed 39 genuinely orphaned files (7.6 MB) — leftover avatars and
one replaced group icon; both group icons the DB points at survived, and the
plugin folders were untouched.

The three newest actions checked against a fixture built around the cascade
hazard: a soft-deleted comment with a LIVE reply, one whose whole subtree is dead,
a leaf, one inside the window, plus a soft-deleted article and profile comment.
The live reply survived, its parent was held back and reported as skipped, the
fully-dead subtree went, and the parent was released on the next run once its last
reply was deleted too. Revision trim keeps exactly the newest N per article;
notification prune honours the two separate clocks and treats 0/0 as a no-op.
A first pass reported "4 article comment(s)" where only 3 rows were deleted —
nested subtrees were counted once per root — fixed with `COUNT(DISTINCT node)`,
since the dry-run summary is what an admin reads to decide whether to proceed.

## Not done

- `docs/v1-spec.md` has no section for this yet.
- The three newest actions were verified against fixtures, not driven through the
  ACP form — the automation browser's session belonged to an account since
  deleted from the dev DB. They render from the same JSON Schema path already
  driven in the UI for the purge action.

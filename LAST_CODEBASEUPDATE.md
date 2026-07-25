# Last Codebase Update — 2026-07-26 (progression core/plugin split, §38)

Progression stops being forum-flavoured. Core keeps thresholds and limits for the
content core actually owns (articles + article comments); forum posts/threads move
into the forum plugin, which contributes its promotion checks through a new
`registerProgressionCriteria` primitive. Disabling the forum removes its
thresholds from promotion instead of blocking everyone on a rung forever.

## A — `registerProgressionCriteria` server primitive

- `packages/plugin-sdk/src/index.ts` — new `ProgressionCriteria`
  (`{ id, evaluate(userId, groupId) => boolean[], metrics?() => ProgressionMetric[] }`)
  and `ProgressionMetric` (`{ key, label, have, need }`). `evaluate` is the single
  source of truth for promotion; `metrics` is display-only for the progress bar.
  `PluginContext.registerProgressionCriteria` + new `PluginHost.progression`
  (`getEffectiveGroupId`) so a plugin can resolve the rung governing a user.
  **Breaking for plugins:** `host.middleware.enforcePostLength` is gone — it read
  a core column that no longer describes plugin content.
- `apps/api/src/core/progression-registry/progression-criteria-registry.ts` — new
  registry (mirrors stat-/search-registry): `register` / `deregister` /
  `evaluate` / `describe`. A criteria source that throws is skipped, so a bad
  plugin can never block or break promotion.
- `apps/api/src/core/plugin-engine/plugin-context.ts` — wires the primitive and
  the `progression` host service; `plugin-engine.ts` deregisters on disable.

## B — Core progression = articles + comments

- `prisma/schema.prisma` + 3 migrations:
  - `20260725120000_progression_article_comment` — drop `min_posts`,
    `min_threads`, `max_post_length`, `max_daily_posts`; add `min_articles`,
    `min_comments`, `max_comment_length`, `max_daily_comments`, and
    `ncf_users.comment_count`.
  - `20260725130000_progression_article_limits` — add `max_article_length` +
    `max_daily_articles`. The dropped `max_post_length`/`max_daily_posts` were
    enforced on ARTICLES in core (the forum merely reused the middleware), so
    comment limits alone would have silently dropped that enforcement.
  - `20260725140000_backfill_user_comment_count` — backfill `comment_count` from
    existing published, non-deleted comments.
- `apps/api/src/jobs/checkPromotion.ts` — core checks are now articles/comments;
  plugin criteria are appended before the AND/OR fold.
- `apps/api/src/modules/progression/progression.{service,validation}.ts` —
  new fields; `getUserProgression` merges plugin metrics so the progress bar
  reflects what promotion actually gates on.
- `apps/api/src/shared/middleware/contentLimits.ts` — split into
  `enforceArticleLength` / `enforceDailyArticleLimit` / `enforceCommentLength` /
  `enforceDailyCommentLimit`, plus `getEffectiveProgressionGroupId` for plugins.
- `apps/api/src/modules/articles/comment.service.ts` — comment limits enforced on
  create + edit; maintains `user.commentCount` (the `min_comments` counter) and
  now only adjusts counters for **published** comments on delete (a pending
  comment previously decremented a count it never incremented).
- `apps/api/src/modules/moderation/moderation.service.ts` —
  `moderatorDeleteArticleComment` maintains the same counters as the author-facing
  delete; it previously maintained none.
- `apps/api/src/workerBoot.ts` — BullMQ workers are constructed **after**
  `initializeEnabledPlugins()`. They used to start consuming at module scope, so a
  check-promotion job landing during boot could read an empty criteria registry
  and promote someone who had not met a plugin's thresholds (same race also hit
  security-analysis plugin scans).
- ACP: `ProgressionPage.tsx`, `GroupsPage.tsx` — article + comment threshold and
  limit fields, updated summaries.
- i18n: `{en,de,es,fr,pt}/acp.json` keys renamed/added; new
  `progression.metric.*` map in `home.json` so the member-facing progress caption
  is localized instead of interpolating a raw machine key (`HomePage.tsx`).

## C — Forum plugin (git-ignored, not in this PR)

- `migrations/017_forum_group_progression` (+ manifest entry) — `min_posts`,
  `min_threads`, `max_post_length`, `max_daily_posts` on `forum_group_config`.
- `server/forum.service.ts` — group config read/write extended (PATCH semantics,
  camelCase shape); `forumThresholds()` is the one helper behind both
  `evaluateProgression` and `progressionMetrics`, so the booleans core promotes on
  and the numbers it displays cannot drift; plugin-owned
  `enforceForumPostLength` / `enforceForumDailyPostLimit`.
- `server/index.ts` — `ctx.registerProgressionCriteria({ id: "forum", … })`.
- `server/forum.router.ts` — uses the plugin's own limits; the
  `/admin/group-config/:groupId` endpoints now require `admin.access` — they were
  `requireAuth`-only, so any logged-in member could read and rewrite group forum
  config (and, after this change, their own promotion thresholds).
- `web/acp/ForumGroupProgression.tsx` — "Forum" tab in the core Group settings
  dialog via the `groupConfigPanel` slot; locales in all 5 languages.

## Verification

`pnpm typecheck` / `lint` / `test` (52 passed) / `build` all green. Core migrations
applied to the dev DB and columns verified. The forum migration could not be
dry-run: the forum plugin is not installed in this dev DB, so `forum_group_config`
does not exist yet.

## Follow-ups

- Any `min_posts` / `min_threads` an admin had configured is **gone** (pre-alpha,
  no data migration) — forum thresholds must be re-entered in the new Forum tab.
- Forum plugin reset to **1.0.0** (nothing is published yet). The 1.0.1/1.0.2/1.0.3
  changelog entries were folded into `changelog/v1.0.0.md` and their files removed;
  `plugins/packaged/nodevo-forum-1.0.3.nvplugin` replaced by a fresh 1.0.0 build.
- Pending → published comment approval still has no code path, so
  `require_comment_approval` comments never reach the counters.

---

# Registration wizard — username/email checked at step 1

The wizard collected every step before uniqueness was ever tested: a taken
username only surfaced on the final `POST /auth/register`, after the user had
filled in password, PIN, terms and a verified email code. Identity is now
settled before step 1 is allowed to advance.

## API

- `auth.validation.ts` — `checkAvailabilitySchema` (`email?` / `username?`, at
  least one required; same format rules as `registerSchema`).
- `auth.service.ts` — `checkAvailability()`; mirrors the lookups `register()`
  performs (email exact, username case-insensitive) so the probe matches the
  eventual outcome. `register()` stays authoritative.
- `auth.controller.ts` / `auth.routes.ts` — `POST /auth/register/check-availability`,
  public, behind a new `auth-avail` limiter (30/min in prod, loose in dev) —
  the endpoint is polled as the user types.

## Web

- `RegisterPage.tsx` — debounced (450 ms) availability probes for email and
  username; inline "checking / available / taken" feedback under each field,
  `rw-input--error` styling, Continue disabled while either reads taken.
  `validateStep1()` is now async and re-checks authoritatively before advancing,
  so a stale or skipped probe cannot let a taken value through. A failed probe
  (offline, rate limited) does not block — the server still rejects.
  Late `NEC-AUTH-2001/2002` bounces back to step 1 now mark the offending field.
- `RegisterPage.scss` — `.rw-avail` (+ `--free`), tokens only.
- `public/locales/{en,de,es,fr,pt}/auth.json` — `register.checking`,
  `register.emailAvailable`, `register.usernameAvailable`.

## Verification

`typecheck` (web + api) and `lint` clean (warnings pre-existing); auth tests
12/12. Runtime-checked against the dev instance: taken email + `RooT` (case
variant of `root`) both flagged inline with Continue disabled; free values show
"available" and advance to step 2.

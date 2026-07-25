# Changelog

## Progression is no longer forum-flavoured (§38 core/plugin split)

Core's promotion ladder was built around forum posts and threads — columns core
itself could never populate once the forum became an optional plugin. Core now
keeps thresholds and limits for the content it actually owns (articles and article
comments); the forum owns its own and hands core the verdict.

- **New plugin primitive `registerProgressionCriteria`** — a plugin declares
  `evaluate(userId, groupId) => boolean[]` for the thresholds it owns, plus an
  optional display-only `metrics()` so the member-facing progress bar shows what
  promotion actually gates on. Core never reads plugin tables. A criteria source
  that throws is skipped, so a misbehaving plugin can neither block nor break
  promotion — and disabling a plugin drops its thresholds from the ladder instead
  of stranding members on a rung they can no longer clear. Plugins resolve the
  governing rung through the new `host.progression.getEffectiveGroupId`.
- **Core thresholds are now articles + comments** — `min_posts` / `min_threads`
  become `min_articles` / `min_comments`, backed by a new `ncf_users.comment_count`
  that create/delete keep in step (backfilled from existing published comments).
- **Content limits split by content type** — `max_article_length`,
  `max_daily_articles`, `max_comment_length`, `max_daily_comments`. The old
  `max_post_length` / `max_daily_posts` were enforced on *articles* in core (the
  forum merely borrowed the middleware), so article limits are preserved rather
  than quietly dropped; comment limits are new and enforced on create and edit.
- **Promotion could fire against a half-loaded worker** — BullMQ workers were
  constructed at module scope, before `initializeEnabledPlugins()`. A
  check-promotion job landing in that window read an empty criteria registry and
  could promote someone who had not met a plugin's thresholds. Workers now start
  after plugin initialization, which closes the same race for plugin security
  scans.
- **Comment counters were wrong in two places** — deleting a *pending* comment
  decremented an `article.commentCount` it had never incremented, and the
  moderator-side comment delete maintained no counters at all.
- ACP → Progression and ACP → Groups expose the new threshold and limit fields;
  the progress caption is now localized through `progression.metric.*` instead of
  interpolating a raw machine key. Strings updated across en/de/es/fr/pt.

> **Upgrade note:** any `min_posts` / `min_threads` configured before this change
> is dropped — there is no data migration (pre-alpha). Re-enter forum thresholds
> under ACP → Groups → Forum.

## Registration — username & email availability checked at step 1

The register wizard only tested uniqueness on the final `POST /auth/register`, so a
taken username surfaced *after* the user had filled in password, PIN and terms and
verified an email code — then bounced them back to step 1 with the rest of the form
still to redo. Identity is now settled before step 1 is allowed to advance.

- **New public endpoint `POST /auth/register/check-availability`** — takes `email`
  and/or `username` (same format rules as registration), returns which of them are
  free. Behind its own `auth-avail` rate limiter (30/min in production), since the
  wizard polls it as the user types. `checkAvailability()` mirrors the lookups
  `register()` performs — email exact, username case-insensitive — so the probe's
  answer matches the eventual outcome; `register()` remains authoritative.
- **Register step 1 gives live feedback** — debounced (450 ms) probes for email and
  username, inline *checking / available / taken* messages under each field, error
  styling on the input, and **Continue disabled** while either reads taken.
  `validateStep1()` re-checks authoritatively before advancing, so an in-flight or
  skipped probe cannot let a taken value through. A failed probe (offline, rate
  limited) does not block — the server still rejects.
- A late `NEC-AUTH-2001` / `NEC-AUTH-2002` that bounces the wizard back to step 1
  now marks the offending field instead of only firing a toast.
- New strings (`checking`, `emailAvailable`, `usernameAvailable`) across
  en/de/es/fr/pt; the new `.rw-avail` styles use existing tokens only.

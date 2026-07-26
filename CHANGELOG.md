# Changelog

## Scheduled tasks admins can compose themselves

The ACP's Scheduled Tasks page could only answer *when* the built-in jobs run.
Every piece of periodic maintenance had to ship as code. Admins can now build
their own task: a name, an action from a fixed catalogue, its parameters, and a
schedule.

- **A fixed action catalogue, never arbitrary code** — core runs only handlers
  registered in its own action registry. A scheduler that could execute
  admin-supplied code would turn any admin-session compromise into server
  compromise, so that path does not exist. Plugin cron jobs stay outside the
  catalogue as well: a plugin owns its schedules end to end, so a task can never
  point at a handler that disappears when a plugin is disabled. Plugins get the
  cron maths only, through the new `host.utils.cron`.
- **Five actions to start with** — *Recompute counters* repairs drift in nine
  denormalised counters; *Purge orphaned uploads* reclaims files no record points
  at; *Purge deleted content* hard-deletes what has sat in the trash past a
  window; *Trim article revisions* keeps the newest N per article; *Prune
  notifications* ages out the feed on separate read/unread clocks.
- **Destructive actions default to explaining themselves** — every one supports a
  dry run that reports exactly what it would change and writes nothing, and the
  ACP pushes you to use it first. *Purge deleted content* refuses to remove a
  soft-deleted comment whose replies are still alive (the reply relation cascades,
  so a naive purge would take live answers with it) and reports how many it held
  back. *Purge orphaned uploads* treats images referenced from page and article
  bodies as live, keeps files belonging to soft-deleted records, honours a grace
  period on file age, and never touches plugin upload folders.
- **A separate permission, `system.tasks.manage`** — deliberately not plain
  `admin.access`, because these run unattended and some of them destroy data, so
  the capability can be withheld from an admin who should not automate it. Every
  mutation is audited through the existing ACP activity log.
- **Schedules survive restarts and Redis** — a boot reconcile converges the
  scheduler with the database: it drops schedules whose task was deleted while the
  worker was down (which would otherwise fire forever) and re-asserts every
  enabled task. A schedule that fails validation is rejected before it reaches
  Redis, so the two stores cannot disagree.
- **Parameter forms are generated from each action's own validation schema**, so
  an action that gains a parameter needs no frontend change, and the form cannot
  post a shape the server would reject.
- Custom tasks appear as a panel beside the built-in jobs rather than below them —
  both answer "what runs on a schedule here?", and stacking them put *New task*
  behind a scroll past every built-in job.

## Dead login sessions were never cleaned up

`ncf_sessions` had no cleanup path at all, and it is the fastest-growing table in
the schema: the refresh token rotates on every use, and each rotation revokes the
old row and inserts a new one rather than updating in place. At a 15-minute access
token that is roughly 96 rows per continuously-active user per day, kept forever.

- Dead sessions — revoked, or past their own expiry — are now pruned once they
  fall outside `retention.sessions_days` (default 30). Live sessions are never
  touched regardless of the window, and login history is unaffected: the security
  scanners correlate device and IP through login events, not through this table.
- Spent password-reset and email-change tokens are cleared on their own window,
  `retention.auth_tokens_days` (default 7). Both are minutes-lived, so anything
  days past expiry is already unusable.
- Scheduled-task run history is pruned on `retention.task_runs_days` (default 90).
  A task on a five-minute schedule writes about 105,000 rows a year; the most
  recent run is kept on the task row itself, so the ACP summary never goes blank.
- As with the existing retention settings, `0` keeps a table forever.

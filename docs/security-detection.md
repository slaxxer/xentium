# Security Detection — the §15 Anti-Abuse Foundation

How Xentium core detects suspicious account activity and turns it into moderator
review cases, and how plugins extend or replace that detection.

**Last verified:** 2026-07-11 against `apps/api/src/core/security/` and
`apps/api/src/jobs/securityAnalysis.ts`.

---

## Hard rules (spec §15)

- Detection is **informational only** — core never auto-bans, never acts on a
  single shared signal (an IP alone), and never issues automated ban waves.
  Every case is reviewed by a human.
- No browser hardware fingerprinting. Telemetry is limited to auth events,
  IP/user-agent metadata, and an optional first-party device cookie.

## Pipeline

```
xcf_login_events  ──▶  security-analysis job (BullMQ, every 30 min, runs in the WORKER)
                         ├─ runCorePatterns()        core baselines (minus claimed ones)
                         └─ securityScanRegistry.runAll()   plugin-registered scans
                                   │
                                   ▼
                    createModerationCase()  →  xcf_moderation_cases (open)
                    24h dedup (same type + linked users)
                    notifies every holder of moderation.cases.manage (mod.new_case)
```

Review surfaces (core): **ACP → Moderation → Review Cases** (`/admin/cases`)
and the **ModCanvas → Cases** tab. Case actions: allow (grants a signal
exception), ban-all, mod notes, revoke exception.

## The four baseline patterns (core, free)

`apps/api/src/core/security/patterns.ts` — fixed spec thresholds:

| Pattern (case `type`) | Trigger | Severity |
|---|---|---|
| `rapid_login_attempts` | 3+ failed logins from one IP in 10 min | medium |
| `multi_account_suspicion` | 2+ accounts sharing one device cookie (cookie-only signal) | high |
| `registration_burst` | 5+ registrations from one IP in 24 h | medium |
| `ban_evasion_suspicion` | new account registered ≤10 min after a ban, from an IP the banned user had used | high |

Notes:

- **Per-pattern toggles**: `security.pattern.<type>` settings (default on),
  editable in **ACP → Moderation → Settings → Detection Patterns**.
- **Bounded scanning**: the multi-account query only examines device cookies
  with successful-login activity in the last 24 h, so cost does not grow with
  the full `xcf_login_events` history; the 24 h case dedup absorbs repeats.
- **Exception whitelist**: "Allow" on a case writes the signal (device cookie
  or IP) to `xcf_reviewed_security_signals` with the cleared user ids. Patterns
  skip whitelisted signals — but still open a case if a **new** account appears
  beyond the granted exception.
- Each pattern runs isolated: a throw is logged and never aborts the others.

## Plugin extension points

Two SDK calls (see the plugin development guide in the README):

- `ctx.registerSecurityScan(fn)` — run `fn` on the same 30-min cadence, after
  the core baselines. Open cases via `ctx.host.security.createCase(...)` —
  identical dedup + notification behaviour as core patterns.
- `ctx.claimSecurityPatterns([types])` — declare that the plugin **replaces**
  the named core baselines (usually with an enhanced variant registered as a
  scan). Core skips a claimed pattern while the claiming plugin is enabled;
  claims are released on disable, so **the free baseline resumes
  automatically** — detection never has a gap or a double.

The official *Advanced Moderation* marketplace plugin uses exactly this: it
claims all four baselines and replaces them with enhanced variants (tunable
thresholds, severity grading, corroboration/scoring), and registers additional
scans (e.g. impossible travel). Its internals are documented with the plugin,
not here.

## Operational notes

- **The job runs in the worker.** `workerBoot.ts` calls
  `initializeEnabledPlugins()` — without a worker restart after
  installing/replacing a plugin, the worker's scan registry and pattern claims
  are stale (worst case: core baselines run instead of the plugin's enhanced
  versions; the case dedup absorbs most duplicates, but restart anyway).
- **Registries are in-memory, rebuilt at startup from the DB.** If plugin rows
  are changed underneath a running process (manual deletion, dev DB reset), the
  process serves stale registrations — including ghost ACP menu entries for
  plugins that no longer exist — until restarted. The plugin lifecycle
  endpoints (enable/disable/uninstall) keep memory and DB in sync; direct DB
  edits do not.
- The cron is defined in `jobs/scheduledJobs.ts` (key `security-analysis`,
  default `*/30 * * * *`, admin-tunable in ACP → System → Scheduled Tasks with
  a 5-min floor). Settings are read fresh each run (15 s TTL cache), so toggle
  and threshold changes apply on the next tick without restarts.

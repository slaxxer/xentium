# Last codebase update — 2026-09-11

Seven pieces, all verified in a running browser rather than only under test:
**badges** (catalogue, rewards, notifications), the **profile redesign at 1:1**,
**recent visitors**, **cover uploads**, **one rank component**, and a set of
**layout fixes** that came out of looking at the result.

`pnpm backbone:check` green — typecheck 30/30, lint 0 errors, API **378** tests,
web **681**, build clean.

⚠ Five migrations, applied by hand and NOT by `prisma migrate dev` — plugin tables
live outside the Prisma schema, so `migrate dev` reads drift and offers to reset the
database. Write the SQL, then `prisma migrate deploy`.

---

## Badges (ADR-0009)

`ncf_badges` + `ncf_user_badges`, keyed on the pair. Catalogue CRUD under
`badge.manage`, granting under `badge.assign`.

| Area | Note |
| --- | --- |
| `modules/badges/` | service, controller, routes; public batch + catalogue reads |
| `core/badge-registry/` | the extension point — plugins add metrics, core compares |
| `jobs/scheduled-actions/awardBadges.ts` | the sweep; `system.award-badges`, 15-min floor |
| `components/UserBadges.tsx` | the ONE renderer, a host global so plugins adopt it in one line |
| `lib/userBadges.ts` | microtask batching — a page of cards is one request |
| `lib/badgeIcons.ts` | ⚠ explicit imports; `import * as` would pull the whole pack |
| `BadgesPage.tsx` | ACP → Users → Badges: the catalogue only |
| `UserDetailPage.tsx` | where an admin actually grants one |

**Rewards.** `autoAward` + `criteria` (JSON, because the keys are extensible). ALL
thresholds must be met.

⚠ Two ways to over-grant, both closed and both tested: **empty criteria** (`[].every()`
is true) and criteria whose keys **all** belong to absent plugins. Either would have put
a badge on every member of the site.

⚠ `User` has **no `deletedAt`** — the sweep filters on `isActive` alone. A mocked test
asserting `deletedAt: null` agreed with the bug all the way to a failed job.

**Notifications.** `badge.earned` (sweep) and `badge.granted` (by hand), both matched by
the `badge.*` preference pattern.

⚠ A type absent from `slotRegistry.coreSystemPrefixes` draws a `UserAvatar` built from
its **title string**. A sender-less notification would have rendered initials cut out of
a sentence — nothing in the suite covers that path.

**Glyphs only.** Uploads were removed after the fact: column, routes, `BADGE_ICON`
limits, **both** upload-dir allowlists, and the purge job's knowledge of the folder.

⚠ `--badge-mark` sizes the mark instead of `font-size`. A glyph is an SVG measured in
`em`, so `--locked`'s type rules for its "+N" pill were shrinking every padlock next to
an earned badge.

## Profile — the redesign, visitors, covers

⚠ The comparison against the mock-up found three real bugs: `.profile-page` capped at
900px from before it had a rail; bio and stats nested inside the identity column so
they never reached the card's edge; the badges card missing from the shared rail-card
rule and so drawing no panel.

- **Visitors** — `ncf_profile_views` (named, pruned) and `profile_view_count`
  (all-time, guests included). ⚠ A write on a read path: self-views skipped, guests
  write no row, a 15-minute Redis window keeps a reload out of Postgres, and the call
  swallows its own errors.
- **Covers** — `profileImageLimits.ts` is the one chokepoint for BOTH the avatar and
  the cover. ⚠ `shared/middleware/imageDimensions.ts` enforces a DIMENSION ceiling a
  byte limit cannot express; `image-size` is a new API dependency. ⚠ `maxProfileImageBytes` / `allowedProfileImageTypes` had been dead since
  Phase 7: no UI set them, no route read them. An empty type list means NO per-rank
  restriction, not "nothing allowed".

## One rank component

⚠ Two endpoints whose shapes had drifted; `/me/progression` delegates to the profile
composer now. `features/progression/rank.tsx` is the single implementation, and its
STYLES travel with it — in `ProfilePage.scss` they matched nothing on the home rail.
The ladder is retired entirely.

## Layout fixes

- ⚠ **Style-stream leak.** Every document opened one, nothing closed it, and the
  editor's preview re-opens one per template switch. At six the browser stops talking
  to the origin and the editor looks frozen. Preview opens none; the rest close on
  `pagehide` and reopen from bfcache.
- ⚠ **One fixed gap** — `.app-main { padding-block }`. Padding, not margin: the gap
  carries `--content-bg`, where a margin would show the layout background (ADR-0003).
- Rail cards space themselves with `gap`, because `display: contents` wrappers mean a
  silent block must contribute none.
- Editor sample data, gated on the editor flag AND the viewer being staff — the
  preview flag is a URL parameter anyone can type.

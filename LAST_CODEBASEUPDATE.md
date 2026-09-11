# Last codebase update — 2026-09-11

Six pieces, all verified in a running browser rather than only under test:
**badges**, the **profile redesign at 1:1**, **recent visitors**, **cover uploads**,
**one rank component**, and a set of **layout fixes** that came out of looking at the
result.

`pnpm backbone:check` green — typecheck 30/30, lint 0 errors, API **355** tests,
web **681**, build clean.

⚠ Three migrations, applied by hand and NOT by `prisma migrate dev` — plugin tables
live outside the Prisma schema, so `migrate dev` reads drift and offers to reset the
database. Write the SQL, then `prisma migrate deploy`.

---

## Badges (ADR-0009)

`ncf_badges` + `ncf_user_badges`, keyed on the pair. Catalogue CRUD under
`badge.manage`, granting under `badge.assign`.

| Area | Note |
| --- | --- |
| `modules/badges/` | service, controller, routes; public batch + catalogue reads |
| `shared/middleware/imageDimensions.ts` | ⚠ 32×32 is a DIMENSION rule; `image-size` is a new API dep |
| `components/UserBadges.tsx` | the ONE renderer, a host global so plugins adopt it in one line |
| `lib/userBadges.ts` | microtask batching — a page of cards is one request |
| `lib/badgeIcons.ts` | ⚠ explicit imports; `import * as` would pull the whole pack |
| `BadgesPage.tsx` | ACP → Users → Badges |
| purge job | ⚠ teaches the sweep about `badges/`, or every icon is an orphan |

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
  the cover. ⚠ `maxProfileImageBytes` / `allowedProfileImageTypes` had been dead since
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

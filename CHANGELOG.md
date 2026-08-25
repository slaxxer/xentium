# Changelog

## The maintenance screen, redesigned — and a real editor behind it

The maintenance screen was a split panel: a coloured half carrying a headline and
a percentage, and a permanent login form filling the other half. It told visitors
almost nothing and asked them to log in. It is now a centred status card that
answers the questions people actually have — how long, what is being done, what
is affected — and keeps staff sign-in behind a discreet link that opens a dialog.

ACP → System → Settings → **Maintenance mode** grew the editor to match.

### Added
- **A live countdown** to the ETA (hours / minutes / seconds), with the "back
  online around HH:MM" time under it. Off by a toggle when a deadline would be a
  promise you cannot keep.
- **Named progress steps.** "Step 3 of 4 — Rebuilding search index" reads better
  on a long job than a percentage does. The percentage bar is still there: the
  new **How progress is shown** control picks Steps, Bar, or Hidden.
- **Affected services** with an offline / degraded / operational status each.
- **Where to follow updates** — footer icon links (Discord, X, GitHub, Mastodon,
  Telegram, YouTube, a status page, email, or a plain link).
- **Two backgrounds** — Aurora and Solid — both mixed from the site's own accent
  colours rather than a fixed palette, and previewed in the picker.
- **Auto-refresh when back**: visitors land on the site the moment maintenance
  ends, no reload. With it off, the poll stops and the visitor reloads when they
  choose to.
- **Staff sign-in link** toggle, for admins who would rather staff went to
  `/login` directly.

### Changed
- The maintenance settings section renders its own body instead of the generic
  label/description/control rows — the editors (steps, services, links) do not
  fit one. It still writes into the Settings page's single draft, so it autosaves
  with everything else and reports into the one SaveChip.
- The card head carries a **site is live / site offline · staff only** pill.
- The screen names the site from site config instead of the literal "Nodevo".
- Every colour is a `--c-*` token, so the screen renders in both themes and
  follows the Style Editor's accent. The design was drawn in dark only.

### Notes
- `maintenance.progress_mode` defaults to `bar`, so installs that predate the
  modes look exactly as they did: a bar that appears only above 0%.
- The status endpoint is public and its settings are free-form JSON, so the
  service re-checks everything it returns — bounded lists, a fixed icon
  vocabulary, and `http(s)`-only link URLs (a `javascript:` URL in a setting
  never reaches an anchor).
- A locked-out account is always offered the sign-in link, even with the footer
  link hidden — otherwise it has no way back in.

## The licence page, redesigned

ACP → Extensions → License used to be three stacked cards that each answered a
different question and never referred to each other: a marketplace-account box, a
list of what you own, and a technical dump of the active licence. Whether the
install was actually licensed — the one thing the page exists to say — was
somewhere in the middle, in body text.

It now opens with that answer, and puts everything the account owns into one
table beside it.

### Added
- A **status hero**: licensed-until, a state badge, and a hint when there is
  something to do about it. Five states — active, expiring, expired, marketplace
  unreachable, and not connected — each derived from real licence data rather
  than a generic "active/inactive".
- **Licences and entitlements are one table.** What the account bought and what
  this install may run are different facts, and the columns now say both:
  seats, updates window, and whether the licence is live here.
- **Technical details collapse.** Licence key, site ID, activation and next-check
  dates moved into a drawer, each with a copy button — support information, not
  the headline.
- A right rail carrying the marketplace connection and a short entitlement
  summary: signed-until, grant count, and when the automatic check next runs.
- Install progress renders **in the row being installed**, rather than in a modal
  over the page you are reading.

### Fixed
- **A licence could show "Active" next to an Install button.** The marketplace
  reports `activeHere` as soon as a seat binds to an install, which happens
  before any files exist locally. The row now requires both the activation and
  an installed version before it claims to be live, and the "active here" count
  in the rail counts the same thing.
- The hero, the table and the rail read a single fetch. Previously each asked
  separately, so "marketplace unreachable" could be true for the table and false
  for the panel directly above it.

### Notes
- Every colour in the page comes from a semantic token, so it renders in both ACP
  themes. The design was drawn in light mode only.
- Refreshing entitlements now also re-asks for owned licences — that is the one
  moment a just-bought licence appears, which is the whole reason to press it.

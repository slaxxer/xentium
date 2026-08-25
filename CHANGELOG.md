# Changelog

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

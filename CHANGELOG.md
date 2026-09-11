# Changelog

## Badges you award, a profile rebuilt to its design, and rails that breathe

### Added

- **Badges.** A catalogue in `ACP → Users → Badges`, granted on a member's own page
  in Users, with two permissions so handing out a badge can be delegated without
  handing over the catalogue. A badge is **held, not accumulated**: granting it twice
  is the same badge. Its mark is a curated glyph, tinted by the badge's colour.
- **Badges you earn.** A badge can carry thresholds — articles, comments, likes,
  followers — and a scheduled sweep grants it to whoever meets **all** of them. Off by
  default: a badge an admin creates is a badge an admin hands out. The metrics are a
  registry a plugin extends, which is how the forum offers posts and threads **only
  while it is installed**; a threshold belonging to a disabled plugin is skipped and
  starts counting again when it comes back. Nothing is ever taken away.
- **Badges tell you.** Earning one, or being given one, arrives in the notification
  bell under a single "Badges" preference. Quiet when there is nothing to say: a
  re-grant that only corrects the reason, or an admin granting one to themselves.
- **One component draws badges everywhere.** The profile, the article author card and
  the forum's post card all use it; a plugin adopts awards with one line and no query
  change. Requests are batched, so a thread of twenty cards asks once.
- **Recent visitors.** Who has looked at a profile lately, with an all-time view total
  that counts guests. Pruned on a schedule, because a record of who looked at whom is
  a longer memory than the feature needs.
- **Member cover images**, with the rank gate the design calls for — "Unlocked at
  Contributor" is real, and "animated covers" is a file type a rank grants.
- **Sample data in the layout editor**, so a rail can be arranged on a site where
  nobody has followers or a rank yet.

### Changed

- **The profile page matches its design 1:1** — the cover band, an overlapped
  squircle avatar, the name and its pills on one row, stat tiles, pill tabs and
  article cards with a thumbnail, a read-time chip and an excerpt.
- **Rank progress is one component**, shared by the profile and the home rail. Home
  gains the rung chips and the "next rank unlocks" list it never had, and the two
  endpoints that had drifted apart now answer with the same shape.
- **The rank ladder is retired.** Rank progress is the one rank block, and it can be
  placed on any page rather than only the profile.
- **Per-rank profile image limits are enforced.** They had been stored since Phase 7,
  settable in no UI and read by no upload route.

### Fixed

- **The layout editor appeared to freeze.** Every document opened a style-sync stream
  and nothing closed it; the editor's preview re-opens one on every template switch,
  and once six were open the browser could not talk to the origin at all, so every
  request queued forever.
- **One fixed gap around every page.** The space under the header came from a placed
  block, the space above the footer from nothing, and each page added its own on top —
  so the seam measured 64, 88 or 96 depending on the route.
- **Rail cards had no gap between them** and read as one tall card with rules across it.
- The profile body was capped narrower than the cards inside it; its bio and stats
  were indented by the avatar column instead of spanning the card.

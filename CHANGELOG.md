# Changelog

## Moderation you can work with, readable text, and a Style Editor that reaches everything

### Changed

- **Text on the site is bigger and follows your browser.** Nothing is smaller than 12px any
  more, everyday text moved up a step, and articles and messages are set at 17px for
  reading. Text sizes are relative to the browser's own setting, so a visitor who asked their
  browser for larger text gets it. On phones, form fields are at least 16px, so tapping one no
  longer zooms the page.
- **One control sets the size of all text on the site.** Style Editor → Typography now shows
  the text size as a percentage, and every text size follows it, headings and captions
  included. The ACP keeps its own sizes.
- **The Style Editor reaches every design token.** New sections for tints and states,
  typography, spacing, corners, shadows, page layout and the base palette cover everything
  the site is built from, so colours like the accent tint behind selected rows can be changed
  without custom CSS. Every row starts from the site's real default, and colour pickers show
  values written as `rgba()` or built from other colours.
- **ModCanvas is a slide-over panel with one tab row**: Reports, Cases, Users and Audit log,
  with the counts on the tabs.
- **Reports are a list and a detail view.** Reports about the same thing are one row, and
  acting on it closes all of them. The detail shows what was reported as it was at the time,
  every reporter and their reason, and the author's standing, including when the next warning
  would trigger a ban.
- **Every action starts from a premade text.** Warn, ban, remove or dismiss offers texts with
  the member's name, the place and the ban length filled in, suggests one based on the report's
  reason, and lets you edit it before sending. You can choose not to notify the member, claim a
  report, resolve or dismiss several at once, and undo a dismissal.
- **ACP → Moderation → Templates** is where admins write those texts, or keep the default set.
  Restore defaults brings back any default text that was deleted, without touching ones you
  changed.
- **ACP → Review Cases is redesigned**: filters by status, pattern and severity, a detail pane
  with the evidence and each linked account's sign-ins and status, a note that saves as you
  type, assigning a case to a moderator, and a preview of exactly who a ban would affect.
- **ACP → Mod Settings is redesigned** into Warnings, Bans and Detection, and every setting on
  it now takes effect: warnings expire on schedule, the escalation ladder is editable (warn,
  temporary ban, permanent ban or just notify, each once), bans outside the allowed length
  are refused unless moderators may override, and the warning count can restart after a ban.
  Ban dialogs open at the default length you set.
- **Climbing a rank shows a one-time "Level up" dialog** with what the new rank unlocks and
  the next goal. It follows the "notify on promote" setting.
- **Only the most recent Xentium announcement is shown**, and one already read never comes
  back. An unread announcement lights the navbar gear's red dot.

### Fixed

- **A site with a theme no longer flashes the default look on every load.** The theme's
  colours and page layouts now arrive with the page instead of after it.
- **Mod Settings did nothing.** Its settings were saved and never read: warnings never expired,
  the ban range was never checked, and the warning thresholds on the page were not the ones
  that ran.
- **A warning ladder step fires once.** The temporary ban for the third warning used to fire
  again on the fourth.
- **Bans issued from ModCanvas and automatic bans sign the member out**, like every other ban.
- **Each review case shows its own accounts' IP addresses.** Every case used to show the same
  list for the whole page.
- **Banning everyone in a case signs them out and records the reason you typed.**
- **Reports on articles and comments record who wrote them and what they said**, so the
  author can be warned or banned from the report.

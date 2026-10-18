# Changelog

## Moderating articles

### Added

- **Delete and report comments.** Every comment has Report, and Delete for your own. Members
  with "Delete anyone's article comments" can remove any comment; they give a reason, which
  goes to the moderation log. A deleted comment leaves the thread without a placeholder, and
  a top-level comment takes its replies with it.
- **Close comments.** Mod tools → Close comments stops new comments and replies on an
  article. Members with the new "Comment where comments are closed" permission can still
  post, so your team can answer.
- **Hide an article.** Mod tools → Hide article takes it out of every list, search, feed
  and count without deleting it. Its author and members with "Hide articles and see hidden
  ones" can still open it, and see that it is hidden. Show it again whenever you like.
- **Three new permissions** under Moderation: close and reopen article comments, comment
  where comments are closed, and hide articles. Moderators, supermods and admins get them
  on new sites.

### Fixed

- **Deleting your own comment checks your permission.** Taking "Delete own article
  comments" away from a group now actually stops it.
- **Profile article covers.** The Articles tab on a profile shows each article's cover
  image again.

## Admin panel

### Changed

- **A new member page.** Who the member is, their signals (failed sign-ins, email, known
  addresses, sessions) and the account actions stay beside you in a sidebar, and the rest is
  one page you scroll through: Account, Access, Content and Security, with a section bar
  that follows you.
- **Edit a member's username and email** from that page. Changes go through the save bar.
  A new email address starts unverified, the old username goes into the member's name
  history, and the change is written to the moderation log. Your own account and other
  administrators' accounts can't be changed from here.
- **Known addresses and devices say when they were last seen**, and devices name the
  browser and system they belong to.
- **The dashboard's Platform card** moved into the right column, under "Needs attention".

### Added

- **Demo mode.** Set `DEMO_MODE=true` to run a public demo with a shared admin account. It
  refuses what a reset can't undo: installing or switching plugins, the marketplace and the
  licence, sending mail, changing the shared account's password, email or sign-in methods,
  and settings that would lock other visitors out.

## Profiles

### Changed

- **Badges show as icons.** The badge card on a profile lists each badge as its icon, with
  the name on hover, and packs them from the left.

## For plugin developers

### Added

- **`host.groups.add` / `host.groups.remove`** put a member in a group or take them out,
  and clear their cached permissions. Groups that grant admin access are refused.
- **`host.utils.encryptSecret` / `host.utils.decryptSecret`** store a secret (an API key, a
  client secret) encrypted at rest with the site's key.

# Changelog

## A new admin panel navigation, and a quieter way to hear from us

### Added

- **The admin panel has an icon rail and a section panel.** A 72px rail of section icons and a
  248px panel listing that section's pages run down the left, and the old top bar is folded
  into them. Collapse the panel and the rail is left on its own; clicking a section then opens
  it as a flyout over the page **without navigating**, so you can look into a section you are
  not in and change your mind.
- **The previous layout is still there.** Both chromes live side by side and each admin picks
  one in their own menu, under the light/dark toggle. The choice is per browser, like the
  theme — it is how you drive the panel, not part of anyone's site design.
- **The panel gets out of the way on a narrow window.** Below 1100px it cannot dock, so it
  behaves as a flyout regardless of the preference — and the preference comes back untouched
  when there is room for it again.

### Changed

- **Broadcasts from the Xentium team are a band across the top of the panel, not a dialog.** A
  dialog is the right shape for something that must be answered before anything else can
  happen, and a notice from us is not that: it arrives on its own schedule, it is rare, and it
  has nothing to be done about. What the modal actually did was stand between an admin and the
  job they opened the panel for, which is how a channel teaches people to dismiss it without
  reading. The band is still unmissable and still has to be answered — OK is the
  acknowledgement, recorded for your account — but you pick the moment.
- **A licence warning or a waiting update now arrives on the visit it applies to.** They used
  to queue behind a broadcast for one more, because only one dialog can open per visit and the
  broadcast went first. It is no longer in that queue.
- **The command palette and the admin menu are one component each**, arranged twice, instead of
  a copy per layout.

### Removed

- **The notification bell and plugin header widgets are gone from the admin panel.**
  Notifications and private messages are things that happen to you as a member, and the place
  to read them is the site; in here every unread count was a reason to leave the job you came
  in to do. Plugins keep the slot — it still renders in the site's own header.
- About 200 lines of styling for a sidebar that nothing had rendered since the horizontal
  navigation landed.

### Fixed

- **The installer no longer tells you to link an account you have already linked.** A paid
  add-on your account does not hold said "Link to unlock"; it now says what is actually
  missing.

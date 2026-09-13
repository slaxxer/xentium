# Changelog

## One editor everywhere, settings you can see, and a badge page organised by how a badge is earned

### Added

- **The Composer — one editor for every surface.** Article comments, the profile wall,
  private messages, forum threads and replies were two different editors with two
  toolbars, two sets of glyphs, and mentions on only one of them. They are now one
  component in three shapes: `inline` (a single row until you need it), `panel` (a page
  whose job is writing) and `dock` (one row, Enter sends).
- **The toolbar sits at the bottom**, docked beside the button it serves — the chrome is
  where your hands already are, and on a phone it rides above the keyboard.
- **A block picker** (Text / H1 / H2 / H3 / Quote / Code / Divider) that shows what you
  are in, replacing seven separate buttons, and an **overflow tray** grouped Marks /
  Blocks / Align / Insert.
- **A link popover** instead of the browser's prompt box — it can show the current
  address, offer "open in new tab", and it works in the browsers that suppress prompts
  entirely, where the link button used to do nothing at all.
- **An emoji picker**, no dependency, and **mentions on every surface** — threads,
  replies and private messages have them now, not just comments.
- **Quoting is a context strip you can dismiss**, not markup pasted into your reply, so
  what you type stays yours to edit.
- **`Appearance → Composer` in the admin panel.** One row per tool with Bar / Tray /
  Off, a live preview of the bar in your own order, and a site-wide mentions switch.
  It autosaves, and every open editor restyles the moment it saves.
- **Account settings, rebuilt.** A sticky rail — settings search plus five sections,
  each carrying one live fact ("PIN off", "6 on") — beside cards that are always open.
  Profile now shows a **live preview of your public profile** as you type, Security
  opens on a status strip where every value is real, Notifications is one event ×
  channel matrix, and Privacy answers every visibility question in a single list.
- **A holders drawer on every badge** — who holds it, how they came by it, when, and
  revoke — plus the catalogue's totals in the header and search over name *and* key.
- **`docs/plugin-registries.md`** — every extension point a plugin has, with the rules
  that keep disabling one safe.

### Changed

- **Badges are grouped by how they are earned** — a rule configured once, or a decision
  made per member — because that is the job an admin arrives with. Filter by kind, sort
  by order, name or holders.
- **The badge editor is a live preview beside three tabs** (Details, Appearance, Reward
  system), and its glyph half is the shared icon picker, so a site with its own icon kit
  can use anything the kit draws.
- **Deleting a badge asks first.** It cascades every award that was handed out.
- **Every accordion is gone from account settings.** Saving follows the control: a save
  bar where values are typed, instant where a switch takes effect on click, and a button
  per card in Security, where each action has consequences beyond the page.
- **Your session list says "This device"** instead of offering to sign you out of the
  session you are reading it from.
- **Mention rows name the member's group**, ordered the way every other group read is.
- Shipped plugins get the new editor **with no rebuild** — the old editors are now thin
  adapters over the Composer with the same props.

### Fixed

- A composer configured by an admin who had never opened the new page came up with an
  empty toolbar: a missing setting is now told apart from a bar an admin emptied on
  purpose.
- Mention avatars were broken by a doubled `/uploads/` prefix on a URL the search
  endpoint had already resolved.
- TipTap warned about duplicate `link` and `underline` extensions — the editor's starter
  kit already bundles both.
- On a site running an icon kit, an icon selector matched the wrong element: a field
  glyph escaped its input and every navigation label was shoved right.
- A device name called every iPhone "macOS" (an iOS browser says "like Mac OS X"), and
  every Edge and Opera "Chrome".
- A badge's threshold input ate its whole row and squeezed every metric label down to a
  single letter.
- At phone width the badge editor grew past the screen and clipped its own Cancel and
  Save off the bottom.

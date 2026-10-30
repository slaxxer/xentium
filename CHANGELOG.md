## 1.0.0-rc.1

The first release candidate for 1.0.0. From here on we fix what you find and change no more
than that before 1.0.0. It also moves the Xentium store, so please update: older versions
can no longer reach it (see Upgrading).

### Security

- **Two-factor sign-in.** Turn it on in Account → Security with an authenticator app
  (Google Authenticator, 1Password, Authy and others): scan the code, confirm it, and keep
  the ten recovery codes somewhere safe. While it's on, every sign-in except a passkey asks
  for a code, and it replaces the login PIN.
- **You choose who must use it.** The install wizard asks which groups must use
  two-factor sign-in (Administrators are ticked to start with), and ACP → Settings → Login
  changes it per group later. Members of those groups are asked to turn it on, and the
  ACP stays closed to them until they do. Everyone else can turn it on if they like.
- **Sensitive changes ask for a fresh code:** handing out permissions and groups, changing
  someone's account, installing, enabling or deleting add-ons, store connections, core
  updates and sign-in providers. One code covers five minutes.
- Ten wrong codes lock an account's codes for 15 minutes. You get an email when
  two-factor is turned on or off, a recovery code is used or new codes are made, and
  admins are told when an account that must use it turns it off. ACP → Users can reset
  someone's two-factor, and `xentium reset-2fa <email or username>` works on the server.

### Added

- **The Xentium store moved to app.xentium.org/store.** Your site connects to it there,
  and the links in the ACP (a plugin's page, your licences) open it there.
- **Dropdowns in the navbar.** In ACP → Navigation, "Show under" puts a link under another
  one. The navbar opens it on hover or from the arrow, and the phone menu lists it under
  its parent.
- **Per-page design.** In Theme Studio → Colours & type, choose "Only this page" to give a
  page its own colours, from the header to the footer.
- **A page's banner in the site header.** A page can put its own band (a title, buttons,
  numbers) inside the site's masthead, arranged in Theme Studio with the rest of the page.
- **New blocks:** buttons (one or two links side by side), and a line of text under a
  heading. Columns can line up at the top, the centre or the bottom.
- **Reset theme** in Theme Studio puts the whole theme (layouts, colours, fonts, custom CSS
  and frame) back to what it ships, as a draft you can look at before you publish.
- **For add-ons:** account tabs, user menu items, navbar dropdowns, headings in their ACP
  section, their own group (created once with the permissions it needs, then yours to
  change), profile tabs, account tabs and menu items only for the members they're about, a
  count beside their ACP pages, a page band in the header, and a fresh-code check before
  sensitive actions.

### Fixed

- **Navbar dropdowns couldn't be clicked**, and the arrow sat outside the link. The whole
  link is one button now, and the menu stays open while you move to it.
- **In the ACP menu**, a section's overview and one of its pages could both look selected.
  Only the page you're on is marked now.
- **ACP → About showed made-up system health.** CPU, memory, queue, request rate and
  latency are measured on your server now, and uptime no longer shows long decimals.
- **New installs can update from the ACP.** When you let the installer set up the
  services, it now sets up the updater too (before, that needed `xentium install-service`).
- **Error messages in your language.** Sign-in, two-factor, invite, add-on, licence, store
  and email errors were shown in English; they're translated into all five languages now,
  and so are the default "Yes", "Cancel" and "Error" texts in dialogs.

## Upgrading

- Older versions talk to the store at its old address, which is gone. Update to rc.1 to
  install, update and license add-ons again.
- If your `.env` sets `LICENSE_SERVER_URL` to `https://plugins.xentium.org/api/v1`, remove
  the line (or set it to `https://app.xentium.org/api/p/xentium-store/v1`).
- Two-factor sign-in is optional for everyone after updating. To require it for your team,
  turn it on yourself first (Account → Security), then pick the groups in ACP → Settings → Login.
- One database migration for two-factor sign-in. It runs with the update.
- `DEMO_MODE` is gone. It existed for our own demo site; if your `.env` sets it, remove it.

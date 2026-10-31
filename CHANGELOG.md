## 1.0.0-rc.3

The third release candidate for 1.0.0: fixes only. If your admins use two-factor
sign-in, installing from the store did not work in rc.2, so please update.

### Fixed

- **Installing and updating from the store asks for your authenticator code.** With
  two-factor sign-in on, every add-on install or update started from the store,
  ACP → License or the updates page failed with "http_403", because those requests
  never asked for the code. They now ask, try again after a wrong code, and show the
  server's own message when something is refused.
- **The top ACP menu shows what add-ons have waiting.** When an add-on puts a count
  beside one of its pages (an order waiting for a payment check, say), the top menu now
  shows it too: a dot on the section, and the number beside the page in its dropdown
  and tabs. Before, only the side menu did, so the dot on the site's gear pointed
  nowhere you could see.
- **ACP → License shows each product's own icon**, in its colour, when the store sends
  one, and the Install button no longer covers the status beside it.

### For plugin developers

- New guide: telling admins something is waiting with an ACP badge
  (`slotRegistry.registerAcpBadge`): what admins see, the rules that keep a badge worth
  trusting, and which hook to use for admins, moderators and members.

## Upgrading

- Update from the ACP or run `npx xentium update 1.0.0-rc.3` in your site's folder.
  No database changes.

# Changelog

## Connecting an install to a marketplace account, in one click — and a licence gate that tells the truth

### Added

- **One-click account linking.** The admin panel's Connect button now opens the
  marketplace, the account holder approves the install by name, and the panel picks it up —
  no code copied between two browser tabs.

  It is shaped like the OAuth **device grant**, and for the same reason: a Nodevo install
  cannot receive a browser redirect it can prove came from the marketplace — it has no
  registered origin, and most installs are on hostnames the marketplace has never seen. So
  nothing is redirected back; the install **polls**. That removes the `redirect_uri` surface
  entirely, because there is no URL for anyone to substitute.

  Three things carry it. **Nothing redeemable is stored** — approval records only *which
  account said yes*, and the account token is minted when the install claims the request, so
  reading the table yields no credential. **Both calls are signed with the key being
  registered**, verified against the key carried in the request itself, since there is
  nothing registered yet to look it up against. And **a code is shown on both screens**: an
  approval link is a link, and links can be mailed to people, so the account holder gets
  something concrete to compare before saying yes. The approval screen leads with that
  comparison rather than being a lone button.

  The typed connect code still works and is now the fallback under "Or paste a connect
  code" — an install whose admin cannot open a browser tab from that machine has no other
  way in.

### Changed

- **`ncf_licenses` is now `ncf_entitlements`, and `license_key` is `license_ref`.** The name
  was the bug's habitat. The row holds the *signed entitlement document* the marketplace
  issues on every activation — including for an account that owns nothing — and calling it a
  licence is what made its mere existence read as proof of one. The column was worse: it
  holds a display reference like `NVL-account`, and the raw licence key never reaches an
  install at all, so `licenseKey` was wrong twice over. The ACP field label said "License
  key" too; it now says "Licence reference".

  Migrated with `ALTER TABLE … RENAME`, not drop-and-recreate: this row is an install's proof
  of what it may run, and re-issuing one requires reaching the marketplace, so emptying the
  table would leave every install unlicensed until its next successful refresh — and offline
  ones indefinitely. The constraint and index names are renamed too, which the earlier
  `ncf_` prefix migration did not do; that omission is why they were still called
  `licenses_pkey` five migrations later.

  The *page* is still called License, and the route is still `/admin/license`. Admins think
  in licences, and that word is right where a person is reading; it is the storage that was
  lying.

### Fixed

- **The Entitlements panel appeared before there were any entitlements.** "Signed until /
  Grants 0 / Next check" is the document's own metadata, and shown to an account that had
  just linked and bought nothing it read as though a licence were in force. An empty card is
  not neutral there — it is a claim. It appears only once the document actually grants
  something.

- **Connecting an account made an install claim it was licensed.** Registering and linking is
  not buying, but the panel greeted a brand-new account with a green **"Licensed until
  <date> · Active"** — directly above a table reading "this account doesn't own anything yet"
  and a grant count of zero.

  The cause is a conflation worth naming: `/account/activate` issues a *signed statement of
  what you own*, and it issues one even when the answer is nothing. The install stored that
  document in a table called `licenses` and the panel treated its existence as proof of a
  licence. The hero now reads the **grants**, not the document, and says
  "Connected — no licences yet" until there is something in it.

- **Every connected install carried a permanent red "licence expiring" badge.** Same root
  cause, worse blast radius — this one hit paying customers too. The admin-attention rule
  asked whether the entitlement expires within 30 days, but the entitlement is *issued* with
  a 30-day life and refreshed every 7, so it sits 23–30 days out at all times and the answer
  was always yes. The gear badge showed a red 1 from the moment an account connected, forever,
  and the ACP-entry dialog nagged about it.

  A warning that is always on is not a warning. The rule now lives in `licenseAttention.ts`
  with the reasoning written down, ignores an entitlement that grants nothing, and triggers
  only when the document is within **7** days of expiry — which, given a 7-day refresh
  cadence, means refreshing has genuinely been failing for about three weeks. That is worth
  a badge; "your paperwork is 29 days from renewal" is not.

- **There was no way to sign out of the marketplace.** `logout()` had been on the auth
  context since the beginning and nothing in the storefront called it — on a site that sells
  things and gets used on shared machines. It went unnoticed because the account chip was a
  plain link to /account, so the header looked finished.

  The chip is a menu now (Overview · Licences · Downloads · Sign out) rather than a bare
  sign-out button in the header: sign-out sitting loose beside a cart icon is a misclick that
  costs somebody their session, and the menu earns its place by putting the three account
  panes one click from every page. It closes on outside click, Escape and navigation — that
  last one because without it the menu survives its own links and hangs over the page it just
  opened.

- **Buttons were three different sizes depending on which stylesheet loaded last.**
  `.btn-sm` was defined three times — in the ACP with `!important` on every property, and
  again in the account and profile stylesheets with two other sets of values. All three were
  global class names in one cascade. `.btn-ghost` carried one step less horizontal padding
  and a lighter weight than `.btn-primary`, and `.btn-ghost-danger` had no vertical padding
  at all, so its height was whatever its content happened to be.

  Size is now a set of tokens (`--btn-pad-y`, `--btn-pad-x`, `--btn-fs`, `--btn-fw`,
  `--btn-gap`) that every button class reads and none of them overrides. A size modifier
  redefines those tokens *on the element* rather than fighting the padding, which is what
  removed the need for `!important` — and with it the one place that had to work around it
  (the Scheduled Jobs panel's full-width button, which set `padding: … !important` to undo
  a letterbox). Primary, ghost and danger are now the same height by construction rather
  than by three authors agreeing.

  Connect marketplace account is a full-size button, not a small one.

- **A plugin the marketplace started selling this morning was free to enable until
  tomorrow.** The set that decides whether an id needs a licence at all was written from
  exactly two places — a plugin upload, and the once-daily heartbeat — and neither happens
  when an operator lists a paid plugin and someone buys it ten minutes later. The gate now
  re-syncs that set itself, on a 15-minute TTL, so a new listing takes effect while the
  operator is still watching.

- **A plugin bought a minute ago could not be enabled.** The gate read the stored
  entitlement and never asked the marketplace, so a genuine purchase was refused until the
  next daily sync. It now asks once before refusing, which is what makes "buy it, then turn
  it on" one continuous action.

- **Every refusal gave the same advice, and for two of the three reasons it was wrong.**
  "Activate a license in ACP → Extensions → License" was printed to admins whose licence was
  already active and whose real problem was that all their seats were in use on other
  installs — there was nothing to activate, so the advice sent them in a circle. A refusal
  now names the actual reason: not owned (with where to buy it), no free seat (with the
  seat count and where to free one), or an expired licence. The marketplace already reported
  seats, seat usage and whether the licence was bound here — the instance simply never asked.

- **The panel pointed at a page that does not exist.** The hint under the connect field read
  "marketplace → Account → **Installs** → Generate code". There is no Installs pane; the card
  is on Account → Overview. It never named the marketplace's address either, though the
  install knows it, so the one instruction a new customer has to follow was both wrong and
  unfollowable. It is corrected in all five languages and is now a link to the marketplace
  this install is actually pointed at.

- **A disconnected install still counted as a connected one.** Uncoupling an account from
  ACP → License released the seats and revoked the install's token, but left its row on the
  marketplace untouched — so the operator console listed a site that had walked away exactly
  like a live one, and nothing anywhere recorded that it had ever left. Support reading that
  page could not tell "this customer moved their licence" from "this customer runs two
  sites".

  The row is **kept and flagged** now, not deleted: deleting it is the tempting version and
  it destroys the history that makes the next connection readable. Installs are tagged
  ACTIVE or INACTIVE, an uncoupled one is dimmed and dated, and every couple/uncouple is
  appended to a per-install log shown beside it. A reconnect reclaims the same row rather
  than opening a second one, so the whole story of one site stays on one line — even across
  a reinstall with a fresh keypair. Existing installs that uncoupled before any of this
  existed are backfilled from the fingerprint the old code left behind: every account token
  revoked, none live.

  Two smaller things fell out of it. A repeated deactivate no longer moves the disconnect
  timestamp, so "left three weeks ago" cannot quietly become "left just now". And the daily
  heartbeat now stamps `lastSeenAt` — rotation is the one call every live install makes on a
  schedule, and without it "seen" only ever meant "connected or activated", which aged every
  healthy site into looking abandoned.

### Notes

- `docs/marketplace-protocol.md` gained the handshake and a section on the enable gate. That
  document exists because the two halves of this protocol once drifted with nothing to
  disagree with, so it is updated in the same commit as the code, not after it.
- `MARKETPLACE_WEB_URL` is new and optional: the storefront's address, defaulting to
  `LICENSE_SERVER_URL` minus its `/api/vN` suffix. That default is right in production, where
  nginx serves the SPA and the API from one origin, and wrong in development, where they are
  two ports.

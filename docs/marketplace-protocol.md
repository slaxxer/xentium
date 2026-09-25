# The marketplace protocol (v1)

How a Xentium install talks to a marketplace. This page covers the **outgoing** side;
the ACP routes in front of it are in [`API.md`](./API.md).

Everything here is a **published contract**. The marketplace does the signing and every
install out there does the verifying, so the two sides can only change together. We wrote
this page because they once didn't. The marketplace signed entitlement grants as objects
while the instance compared them as plain strings, and nothing errored:
`getEntitlementStatus` just reported `missing` for plugins the site owned, and they
refused to enable without any explanation on either side. Typecheck, lint, build and the
whole test suite were green the entire time. **If the two sides drift apart, nothing will
tell you. Write the change down on both sides before you make it.**

- **Instance side:** `apps/api/src/core/license-engine/protocol-client.ts` (transport),
  `marketplace-source.ts` (the conversations), `site-identity.ts` (who am I).
- **Base URL:** `env.LICENSE_SERVER_URL`, **including the version prefix**
  (`https://plugins.xentium.org/api/v1`). It's part of what every signature covers.
- **One marketplace.** `plugins.xentium.org` is it. Core talks to a `MarketplaceSource`
  interface rather than reaching for a host directly, but that's a test seam — it's what
  lets the licence engine be exercised without the network — not an invitation to point an
  instance somewhere else. `LICENSE_SERVER_URL` exists so a developer can run against a
  local marketplace; identity claims (announcements, package signatures) are checked
  against the bundled key regardless of where it points.

---

## The decision everything else depends on

**A licence belongs to an INSTALL (`siteId`), never to a hostname.**

Domains change with rebrands, server moves and staging being promoted, and if licences
were tied to hostnames, each of those would be a support ticket. Installs still *report*
their hostname, and the marketplace stores it so an operator can recognize a site, but it
doesn't restrict anything.

That only works because requests are **signed**. Without signatures, `siteId` is just a
string in a JSON body, and anyone with a leaked token could claim to be any install. The
two decisions go together: signing without dropping hostname binding would cost us both
and gain little.

---

## Two credentials, two questions

| | Answers | Sent as |
|---|---|---|
| **Account token** | *who* is calling | `Authorization: Bearer <token>` |
| **Ed25519 signature** | *proof* the caller is that install | `X-Xentium-Signature` |

The install generates its keypair **itself**, once, when it connects. The private key
never leaves the install and is encrypted at rest; the marketplace only ever has the
public key. Losing it costs you a reconnect, not a licence, which is why we never keep a
copy. A reinstall legitimately creates a new keypair for the same `siteId`, and connecting
accepts that.

### What gets signed

```
{METHOD}\n{pathname}\n{timestamp}\n{sha256hex(body bytes)}
```

| Header | Value |
|---|---|
| `X-Xentium-Site` | the install's `siteId` |
| `X-Xentium-Timestamp` | unix time in **seconds**, ±300 s tolerance |
| `X-Xentium-Signature` | base64 Ed25519 signature over the string above |

(The marketplace still accepts the old `X-Nodevo-*` names, for installs from before the
rename.)

Four things are easy to get wrong here, and each one only shows up on the happy path. A
bad signature fails for the wrong reason and still looks right:

1. **`pathname` includes the base path.** The server rebuilds it as
   `req.baseUrl + req.path`, which inside a router mounted at `/api/v1` gives
   `/api/v1/account/activate`. Take it from the request URL, never from the path relative
   to the route.
2. **Query strings are left out.** The server's version has no query.
3. **Serialize the body ONCE** and send exactly those bytes. Serializing the parsed object
   again gives different bytes and a hash the server can't match. The marketplace keeps
   the `rawBody` for the same reason.
4. **A request without a body hashes the empty string**, `sha256("")`, which is what the
   server computes from an empty buffer.

We register the public key as **base64 of the SPKI DER**, not PEM:

```ts
publicKey.export({ type: "spki", format: "der" }).toString("base64")
```

---

## Endpoints

`✍` = needs the token **and** a signature. `✎` = signed, but **no token**. The two linking
calls happen before the install has an account, so we check the signature against the
public key sent in the request itself.

| | Method | Path | Notes |
|---|---|---|---|
| | POST | `/account/connect` | **The only call that's neither signed nor authenticated**, because the install has no registered identity until it succeeds. Body `{authCode, siteId, publicKey, domain?, environment}` → `{token, expiresAt, accountRef}`. `accountRef` is a masked email to display. |
| ✎ | POST | `/account/link/start` | Opens a one-click link request. Body `{siteId, publicKey, domain?, environment}` → `{linkId, userCode, pollSecret, expiresAt, pollInterval}`. See [The linking handshake](#the-linking-handshake). |
| ✎ | POST | `/account/link/poll` | Body `{linkId, pollSecret, publicKey}` → `{status}`, plus `{token, expiresAt, accountRef}` once `status` is `approved`. |
| ✍ | POST | `/account/activate` | Binds licences and issues the first entitlement. **Idempotent:** activating an install that already has activations returns the current entitlement instead of using a second seat. `siteId` is in the body *and* signed; if they don't match, we refuse, because one install speaking for another is exactly what binding has to prevent. |
| ✍ | POST | `/account/deactivate` | Frees the seats and revokes the tokens. Because licences belong to installs, this is how a customer **moves a licence to another site**: deactivate here, activate there, no support ticket. `204`. |
| ✍ | GET | `/account/licenses` | What the account owns: seats, `seatsUsed`, `activeHere`, `updatesUntil`, the latest published version. It answers "what am I entitled to", which the entitlement JWT can't, since the JWT lists grants, not licences. |
| | GET | `/catalog` | Public and paginated (`kind`, `category`, `q`, `sort`, `page`, `limit`). Not signed, but **send the token if you have one**: that's what makes each listing include `owned`. |
| ✍ | POST | `/downloads/authorize` | **Where ownership is decided.** Checks the signature, then the account, the licence and the **updates window**, then issues a fresh entitlement and a single-use download URL. It does **not** check seats: a seat is used at `activate`, when the licence is bound, not when something is downloaded. |
| | GET | `/downloads/:token` | The bytes. It can't be signed, because a plain streaming HTTP client fetches it, not the protocol client. That's why the grant is single-use and expires after about 5 minutes. |
| ✍ | POST | `/updates/check` | The heartbeat. Reports what's installed, returns available updates and advisories, **and rotates the account token**. |

### The linking handshake

This replaced copying a connect code between two browser tabs, and it's been the default
in the ACP since 2026-08-28. It's modelled on the **OAuth device flow**, for the same
reason: an install can't receive a browser redirect it could prove came from the
marketplace. It has no registered origin, and most installs run on hostnames the
marketplace has never seen. So nothing is redirected back. The install **polls**, which
removes the whole `redirect_uri` problem: an attacker can't swap in a URL, because there
isn't one.

```
instance                     marketplace                    the account holder
   │  POST /account/link/start ─────►│
   │  ◄── linkId, userCode, secret   │
   │                                 │◄──── opens /link/:linkId, compares
   │                                 │      the code, approves
   │  POST /account/link/poll ──────►│
   │  ◄── status: approved + token   │
```

Three properties make it safe:

1. **Nothing that can be redeemed is stored.** Approving only records *which account said
   yes*. We create the account token when the install claims the request, so reading
   `mkt_link_requests` gives you no credential. Approving and claiming are separate steps
   on purpose; merging them would mean a live token sitting in a table row until the
   install's next poll.
2. **Both calls are signed with the key being registered.** That key isn't in the
   database yet, so we verify the signature against the key in the request itself
   (`assertSignedWith`, which we split out of `requireSignature` for exactly this). It
   only proves the caller holds the private key, but at this point that's the whole
   claim. `poll` sends `publicKey` again and the server compares it with the stored row;
   otherwise someone could present a *different* key at claim time and get the wrong one
   registered.
3. **Both screens show a `userCode`.** An approval link is a link, and links can be sent to
   people. The code is how an account holder tells their own request apart from one
   someone else asked them to approve. That's the classic device-flow phishing attack,
   and it's why the approval screen leads with the code comparison instead of a single
   button.

On top of that: one live request per `siteId` (starting a second replaces the first, so an
admin who clicks twice only has one thing to approve), a ten-minute expiry, and each
request can be claimed exactly once, through a conditional `updateMany`, so two polls
arriving at the same time can't both get a token.

`pending`, `denied` and `expired` are **answers with a 200**, not errors. This gets called
on a timer while someone is still reading a screen, and turning "not yet" into a 4xx would
make the normal case look like a failure in every log.

The instance keeps the poll secret **in memory only** (`linkSecrets` in
`admin/marketplace.service.ts`), and the browser never sees it. The ACP gets the id, the
code and the URL, and polls through its own API. If the server restarts mid-handshake, it
costs the admin one more click.

### Token rotation happens on the heartbeat

The new token comes back in the `/updates/check` response and **must be stored**. We tied
rotation to the one call that happens regularly, so there's no second path that could hand
out a credential nobody saves. The marketplace keeps the previous token valid for a short
overlap, so a crash between receiving the response and writing the token costs one retry,
not a disconnected install.

**Don't let two heartbeats run at the same time.** Two rotations mean two new tokens, and
only the last one gets saved; the other is lost. The instance prevents this with a
single-flight Redis lock, because the worker sends a heartbeat when it starts and the
scheduler runs its missed job in the same millisecond.

### Why downloads take two steps

`/downloads/authorize` decides ownership; `/downloads/:token` hands over the bytes. They're
separate because the client that fetches the file is a plain streamer without a signing
key, so **the URL is the credential**, and it behaves like one: unguessable, single-use and
short-lived. A permanent download URL that leaks once is a paid plugin given away for good.

The grant is used up when the download **starts**, not when it finishes, because a URL you
can resume is a URL you can share. An interrupted download costs one more
`/downloads/authorize`, which the install can do anyway. Always check the downloaded bytes
against the `sha256` from the *authorize* response, never against a checksum that comes
with the bytes it describes.

### Refusals

Ownership failures return **404**, the same for "no such release" and "you don't own it".
If they were different, you could use the endpoint to discover unpublished releases.

The **updates window** is the exception, on purpose. A release published after
`updatesUntil` is refused with a **403 that names the date and the version**, because the
customer *does* own the product, and "renew to get 3.2" is something they can act on. Both
sides use XEC codes, so the instance prefers the code the marketplace sent over one guessed
from the status, but only codes it knows, so a newer marketplace can't inject one the
instance doesn't understand.

---

## The entitlement JWT

RS256. The key that verifies it ships in `@xentium/sdk`; `LICENSE_PUBLIC_KEY` overrides it,
which is how a local dev instance verifies against a local marketplace's dev keypair.

```ts
interface EntitlementClaims {
  siteId:       string;             // what the licence is bound to, NOT the hostname
  licenseRef:   string;             // a reference to display, never the key
  domain?:      string;             // reported when issued; for display and audit only
  environment:  "production" | "staging" | "development";
  entitlements: EntitlementGrant[];
  issuedAt:     number;             // unix seconds
  expiresAt:    number;             // +30 days
  refreshAfter: number;             // +7 days
}

interface EntitlementGrant {
  id:            string;   // namespaced: `plugin.<id>` or `theme.<id>`
  updatesUntil?: number;   // unix seconds; missing = forever
  maxVersion?:   string;   // e.g. "3.x"; missing = no limit
}
```

**A grant is an object, not a plain id string**, and that matters: `updatesUntil` is what
tells a licence whose updates ran out apart from a dead one. The install keeps running what
it has but can't fetch anything newer. One global expiry date couldn't express that per
product. Match grants with `e.id === "plugin.<id>"`, exactly. Anything looser turns a cheap
plugin's id into a licence for an expensive one.

`packages/contracts/src/entitlement.ts` publishes `EntitlementGrant` for exactly this
reason, and `apps/api/src/core/license-engine/entitlement-claims.test.ts` builds a JWT the
way the marketplace does. That test is the alarm if the two sides drift apart again.

### Grace, and never breaking a site

If verification fails or the marketplace can't be reached, the install goes into `grace`
for **30 days** after the last successful refresh, instead of refusing. Plugins that are
running never stop because of an outage. The price is that revoking a licence can take up
to `refreshAfter` + grace, about 37 days.

Only `production` uses a seat, and only at **`/account/activate`**. The download check
doesn't look at seats again, because binding is what uses one. `staging` and `development`
have no limit, so local work, CI and previews stay painless.

Account tokens live for **30 days** and rotate on the heartbeat, so an install that doesn't
check in for a month has to reconnect.

---

## Local development

Point the instance at a local marketplace and pair the keys, or **every entitlement fails
to verify** with a bare `JWSSignatureVerificationFailed`:

```bash
# .env (instance)
LICENSE_SERVER_URL=http://localhost:4200/api/v1
# the PUBLIC half of the marketplace's ENTITLEMENT_PRIVATE_KEY, newlines escaped as \n
LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n…"
```

```bash
openssl rsa -in marketplace-dev-private.pem -pubout
```

### The enable check isn't part of the protocol

It's worth knowing anyway, because it *uses* the protocol without adding to it. When an
admin enables a paid plugin, `assertPluginEnableAllowed` refreshes the list of paid plugin
ids from `/catalog`, and if the stored entitlement doesn't cover the plugin, it calls
`/account/activate` once before refusing. A plugin bought a minute ago really is owned, but
it isn't in the stored JWT yet, and the check used to refuse it until the next daily
heartbeat.

If it still has to refuse, it asks `/account/licenses` why. That response already has
`seats`, `seatsUsed` and `activeHere`, so we could tell "you never bought it" apart from
"you bought it, but every seat is on another install" without changing the protocol.
Those two used to end up as the same message, which told the admin to activate a licence
that was already active.

`activate` **silently skips** a licence with no free seat, which is why the instance has to
ask a second question instead of reading the answer off the activation response. If that
ever changes, the instance's explanation is where you'll notice.

An install without an `xcf_installs` row can't connect at all. `getSiteId()` throws
(XEC-LICENSE-9010) instead of falling back to a shared identity, because a shared `siteId`
would lump every affected install together on the marketplace, and with licences bound to
installs, that would be a way around licensing.

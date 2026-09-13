# The marketplace protocol (v1)

How a Xentium install talks to a marketplace. This is the **outbound** contract — the
inbound ACP routes that sit in front of it are in [`API.md`](./API.md).

Everything here is a **published contract**. The signing half lives in the marketplace and
the verifying half is compiled into every install in the field, so the two can only move
together. This document exists because they once did not: the marketplace signed
entitlement grants as objects while the instance compared them as bare strings, and the
result was not an error — `getEntitlementStatus` simply reported `missing` for plugins the
site owned, and they refused to enable with no explanation on either end. Typecheck, lint,
build and the full suite were green the whole time. **A drift here does not announce
itself. Write changes down on both sides before making them.**

- **Instance side:** `apps/api/src/core/license-engine/protocol-client.ts` (transport),
  `marketplace-source.ts` (the conversations), `site-identity.ts` (who am I).
- **Base URL:** `env.LICENSE_SERVER_URL`, which **includes the version prefix**
  (`https://plugins.xentium.org/api/v1`). It is part of what every signature covers.
- **Implementing another marketplace?** Core talks to a `MarketplaceSource` interface and
  never hardcodes a host. A community or self-hosted source may implement the same
  interface and return free, no-op entitlements.

---

## The decision everything hangs off

**A licence binds to an INSTALL (`siteId`), never to a hostname.**

Domains change on rebrands, migrations and staging promotions, and under hostname binding
each of those is a support ticket. Hostnames are still *reported*, and the marketplace
records them so an operator can recognise a site — but they gate nothing.

This is only defensible because of **request signing**. Without it, `siteId` is just a
string in a JSON body and anyone holding a leaked token could claim any install. The two
decisions are a package: taking the signing without dropping hostname binding pays for both
and gains little.

---

## Two credentials, two different questions

| | Answers | Sent as |
|---|---|---|
| **Account token** | *Who* is calling | `Authorization: Bearer <token>` |
| **Ed25519 signature** | *Proof* the caller is that install | `X-Nodevo-Signature` |

The keypair is generated **on the instance**, once, at connect. The private half never
leaves it and is encrypted at rest; the marketplace only ever holds the public half. Losing
it costs a reconnect, not a licence — which is why it is never escrowed. A reinstall
legitimately produces a new keypair for the same `siteId`, and connect accepts that.

### The canonical string

```
{METHOD}\n{pathname}\n{timestamp}\n{sha256hex(body bytes)}
```

| Header | Value |
|---|---|
| `X-Nodevo-Site` | the install's `siteId` |
| `X-Nodevo-Timestamp` | unix **seconds**, ±300s tolerance |
| `X-Nodevo-Signature` | base64 Ed25519 over the canonical string |

Four things that are easy to get wrong, and each fails only on the happy path — a bad
signature fails for the wrong reason and still looks right:

1. **`pathname` includes the base path.** The server rebuilds it as `req.baseUrl + req.path`,
   which inside a router mounted at `/api/v1` reads `/api/v1/account/activate`. Take it from
   the request URL, never from the route-relative path.
2. **Query strings are excluded.** The server's reconstruction has no query.
3. **The body is serialized ONCE** and those exact bytes are sent. Re-serializing the parsed
   object produces different bytes and a hash the server cannot match. The marketplace keeps
   `rawBody` for the same reason.
4. **A body-less request hashes the empty string** — `sha256("")`, which is what the server
   computes from a zero-length buffer.

The public key is registered as **base64 of SPKI DER**, not PEM:

```ts
publicKey.export({ type: "spki", format: "der" }).toString("base64")
```

---

## Endpoints

`✍` = requires token **and** signature. `✎` = signed, but **no token** — the two
linking calls happen before the install has an account, so the signature is checked against
the public key carried in the request itself.

| | Method | Path | Notes |
|---|---|---|---|
| | POST | `/account/connect` | **The only unsigned, unauthenticated call** — the install has no registered identity until it succeeds. Body `{authCode, siteId, publicKey, domain?, environment}` → `{token, expiresAt, accountRef}`. `accountRef` is a masked email for display. |
| ✎ | POST | `/account/link/start` | Opens a one-click link request. Body `{siteId, publicKey, domain?, environment}` → `{linkId, userCode, pollSecret, expiresAt, pollInterval}`. See **The linking handshake**. |
| ✎ | POST | `/account/link/poll` | Body `{linkId, pollSecret, publicKey}` → `{status}`, plus `{token, expiresAt, accountRef}` once `status` is `approved`. |
| ✍ | POST | `/account/activate` | Binds licences and issues the first entitlement. **Idempotent** — re-activating an install that already holds activations returns the current entitlement rather than consuming a second seat. `siteId` is sent in the body *and* signed for; a mismatch is refused, because one install speaking for another is exactly what binding must prevent. |
| ✍ | POST | `/account/deactivate` | Releases seats and revokes tokens. With install binding this is the ordinary way a customer **moves a licence between sites** — deactivate here, activate there, no support ticket. `204`. |
| ✍ | GET | `/account/licenses` | What the account owns: seats, `seatsUsed`, `activeHere`, `updatesUntil`, latest published version. Answers "what am I entitled to", which the entitlement JWT cannot — it lists grants, not licences. |
| | GET | `/catalog` | Public, paginated (`kind`, `category`, `q`, `sort`, `page`, `limit`). Unsigned, but **send the token if you hold one**: that is what makes each listing carry `owned`. |
| ✍ | POST | `/downloads/authorize` | **The chokepoint.** Checks signature → account → licence → **updates window**, then issues a fresh entitlement and a single-use artifact URL. Note it does **not** check seats: a seat is consumed at `activate`, which is the binding event; downloading is not. |
| | GET | `/downloads/:token` | The bytes. Unsigned **by necessity** — fetched by a streaming HTTP client, not the protocol client — which is why the grant is single-use and expires in ~5 minutes. |
| ✍ | POST | `/updates/check` | The heartbeat. Reports the installed inventory, returns available updates and advisories, **and rotates the account token**. |

### The linking handshake

The alternative to an admin copying a connect code between two browser tabs, and the
default path in the ACP since 2026-08-28. Shaped like the **OAuth device grant**, and for
the same reason: a Xentium install cannot receive a browser redirect it can prove came from
the marketplace — it has no registered origin, and most of them are on hostnames the
marketplace has never seen. So nothing is redirected back. The install **polls**, which
removes the `redirect_uri` surface entirely: there is no URL for an attacker to substitute,
because there is no URL.

```
instance                     marketplace                    the account holder
   │  POST /account/link/start ─────►│
   │  ◄── linkId, userCode, secret   │
   │                                 │◄──── opens /link/:linkId, compares
   │                                 │      the code, approves
   │  POST /account/link/poll ──────►│
   │  ◄── status: approved + token   │
```

Three properties carry it:

1. **Nothing redeemable is stored.** Approval records only *which account said yes*. The
   account token is minted when the install claims the request, so reading
   `mkt_link_requests` yields no credential. Approval and claim are separate events on
   purpose — collapsing them would mean parking a live token in a row for as long as it
   takes the install's next poll to arrive.
2. **Both calls are signed with the key being registered.** That key is not in the database
   yet, so the signature is verified against the key in the request itself (`assertSignedWith`,
   split out of `requireSignature` for exactly this). It proves possession of the private
   half and nothing more — but possession is the whole claim at this point. `poll` repeats
   `publicKey` and the server compares it to the row: presenting a *different* key at claim
   time would otherwise register the wrong one.
3. **A `userCode` is shown on both screens.** An approval link is a link, and links can be
   mailed to people; the code is what lets an account holder tell their own request apart
   from one somebody asked them to approve. This is the device-flow phishing case, and it is
   why the approval screen leads with the comparison instead of being a lone button.

Beyond that: one live request per `siteId` (starting a second supersedes the first, so an
admin who clicks twice has one thing to approve); ten-minute expiry; claimed exactly once,
via a conditional `updateMany` so two simultaneous polls cannot both reach the token mint.

`pending`, `denied` and `expired` are **answers with a 200**, not errors. This is called on
a timer while a person is still reading a screen, and turning "not yet" into a 4xx makes the
normal case look like a failure in every log it touches.

The instance keeps the poll secret **in memory only** (`linkSecrets` in
`admin/marketplace.service.ts`) and the browser never sees it: the ACP is handed the id, the
code and the URL, and polls through its own API. A restart mid-handshake costs one click.

### Rotation rides the heartbeat

The token comes back in the `/updates/check` response and **must be stored**. Rotation is
deliberately attached to the one recurring call so there is no second path that could hand
out a credential nobody persists. The marketplace keeps the previous token alive for a short
overlap, so a crash between "response received" and "token written" costs one retry rather
than a disconnected install.

⚠ **Do not let two heartbeats run at once.** Two rotations mean two tokens minted and only
the last one written; the other is stranded. The instance guards this with a single-flight
Redis lock, because the worker fires one heartbeat on boot and the scheduler fires its
missed run in the same millisecond.

### Downloads are a two-step for a reason

`/downloads/authorize` is where ownership is decided; `/downloads/:token` is where bytes
change hands. They are separate because the fetching client is a plain streamer with no
signing key — so **the URL is the credential**, and it behaves like one: unguessable,
single-use, short-lived. A durable artifact URL that leaks once is a paid plugin published
for good.

The grant burns when the stream **starts**, not when it finishes: a resumable URL is a
shareable URL. An interrupted download costs one more `/downloads/authorize`, which the
install can already make. Always verify the fetched bytes against the `sha256` from the
*authorize* response — never against a digest that travels with the bytes it describes.

### Refusals

Ownership failures return **404**, identical for "no such release" and "you do not own it";
separating them turns the endpoint into a way to enumerate unpublished releases.

The **updates window** is the deliberate exception. A release published after
`updatesUntil` is refused with a **403 naming the date and version**, because the customer
*does* own the product and "renew to get 3.2" is something they can act on. Both halves
speak XEC codes, so the instance prefers the code the marketplace named over one guessed
from the status — but only codes it recognises, so a newer marketplace cannot inject an
unknown one.

---

## The entitlement JWT

RS256. The verifying key ships in `@xentium/sdk`; `LICENSE_PUBLIC_KEY` overrides it, which is
how a local dev instance verifies against a local marketplace's dev keypair.

```ts
interface EntitlementClaims {
  siteId:       string;             // the binding — NOT the hostname
  licenseRef:   string;             // display reference, never the key
  domain?:      string;             // reported at issue; display and audit only
  environment:  "production" | "staging" | "development";
  entitlements: EntitlementGrant[];
  issuedAt:     number;             // unix seconds
  expiresAt:    number;             // +30d
  refreshAfter: number;             // +7d
}

interface EntitlementGrant {
  id:            string;   // namespaced: `plugin.<id>` or `theme.<id>`
  updatesUntil?: number;   // unix seconds; absent = perpetual
  maxVersion?:   string;   // e.g. "3.x"; absent = no ceiling
}
```

⚠ **A grant is an OBJECT, not a bare id string**, and that is load-bearing: `updatesUntil`
is what makes a lapsed-updates licence distinguishable from a dead one — the install keeps
running what it has but may not fetch something newer. A single global expiry cannot express
that per product. Match grants by `e.id === "plugin.<id>"`, exact equality: anything looser
turns a cheap plugin id into a licence for an expensive one.

`packages/contracts/src/entitlement.ts` publishes `EntitlementGrant` for exactly this
reason. `apps/api/src/core/license-engine/entitlement-claims.test.ts` builds a JWT the way
the marketplace builds one and is the alarm if the pairing breaks again.

### Grace, and never bricking

Verification failure or an unreachable marketplace resolves to `grace` for **30 days** past
the last good refresh, not to a refusal (§11). Running plugins are never bricked by an
outage. Worst-case revocation latency is `refreshAfter` + grace ≈ 37 days, which is the
price of that guarantee.

Only `production` consumes a seat, and only at **`/account/activate`** — the download gate
does not re-check seats, because binding is what spends one. `staging` and `development`
are uncapped, which is what keeps local work, CI and previews painless.

Account tokens live **30 days** and rotate on the heartbeat, so an install that never checks
in for a month must reconnect.

---

## Local development

Point the instance at a local marketplace and pair the keys, or **every entitlement fails to
verify** with a bare `JWSSignatureVerificationFailed`:

```bash
# .env (instance)
LICENSE_SERVER_URL=http://localhost:4200/api/v1
# the PUBLIC half of the marketplace's ENTITLEMENT_PRIVATE_KEY, newlines escaped as \n
LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n…"
```

```bash
openssl rsa -in marketplace-dev-private.pem -pubout
```

### The enable gate is not part of the wire

Worth knowing because it *uses* this protocol without extending it. When an admin enables a
paid plugin, `assertPluginEnableAllowed` re-syncs the paid-id set from `/catalog`, and — if
the stored entitlement does not cover the plugin — calls `/account/activate` once before
refusing. A plugin bought a minute ago is genuinely owned but is not in the stored JWT yet,
and the gate used to refuse it until the next daily heartbeat.

When it still has to refuse, it asks `/account/licenses` for the reason. That endpoint
already carries `seats`, `seatsUsed` and `activeHere`, so no protocol change was needed to
tell "you never bought it" apart from "you bought it and every seat is on another install" —
two states that had been collapsing into one message telling the admin to activate a licence
that was already active.

⚠ `activate` **silently skips** a licence with no free seat (`continue`), which is why the
instance has to ask a second question rather than read it off the activation response. If
that ever changes, the instance's explanation is where it will show up.

An install with no `xcf_installs` row cannot connect at all — `getSiteId()` throws
(XEC-LICENSE-9010) rather than falling back to a shared identity, because a shared `siteId`
collapses every affected install into one bucket on the marketplace and, under install
binding, becomes a licence bypass.

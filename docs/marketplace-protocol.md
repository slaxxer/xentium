# The marketplace protocol (v1)

How a Nodevo install talks to a marketplace. This is the **outbound** contract — the
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
  (`https://marketplace.nodelab.codes/api/v1`). It is part of what every signature covers.
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

`✍` = requires token **and** signature.

| | Method | Path | Notes |
|---|---|---|---|
| | POST | `/account/connect` | **The only unsigned, unauthenticated call** — the install has no registered identity until it succeeds. Body `{authCode, siteId, publicKey, domain?, environment}` → `{token, expiresAt, accountRef}`. `accountRef` is a masked email for display. |
| ✍ | POST | `/account/activate` | Binds licences and issues the first entitlement. **Idempotent** — re-activating an install that already holds activations returns the current entitlement rather than consuming a second seat. `siteId` is sent in the body *and* signed for; a mismatch is refused, because one install speaking for another is exactly what binding must prevent. |
| ✍ | POST | `/account/deactivate` | Releases seats and revokes tokens. With install binding this is the ordinary way a customer **moves a licence between sites** — deactivate here, activate there, no support ticket. `204`. |
| ✍ | GET | `/account/licenses` | What the account owns: seats, `seatsUsed`, `activeHere`, `updatesUntil`, latest published version. Answers "what am I entitled to", which the entitlement JWT cannot — it lists grants, not licences. |
| | GET | `/catalog` | Public, paginated (`kind`, `category`, `q`, `sort`, `page`, `limit`). Unsigned, but **send the token if you hold one**: that is what makes each listing carry `owned`. |
| ✍ | POST | `/downloads/authorize` | **The chokepoint.** Checks signature → account → licence → **updates window**, then issues a fresh entitlement and a single-use artifact URL. Note it does **not** check seats: a seat is consumed at `activate`, which is the binding event; downloading is not. |
| | GET | `/downloads/:token` | The bytes. Unsigned **by necessity** — fetched by a streaming HTTP client, not the protocol client — which is why the grant is single-use and expires in ~5 minutes. |
| ✍ | POST | `/updates/check` | The heartbeat. Reports the installed inventory, returns available updates and advisories, **and rotates the account token**. |

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
speak NEC codes, so the instance prefers the code the marketplace named over one guessed
from the status — but only codes it recognises, so a newer marketplace cannot inject an
unknown one.

---

## The entitlement JWT

RS256. The verifying key ships in `@nodevo/sdk`; `LICENSE_PUBLIC_KEY` overrides it, which is
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

An install with no `ncf_installs` row cannot connect at all — `getSiteId()` throws
(NEC-LICENSE-9010) rather than falling back to a shared identity, because a shared `siteId`
collapses every affected install into one bucket on the marketplace and, under install
binding, becomes a licence bypass.

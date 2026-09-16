# Last codebase update — 2026-09-17

Two repos. The CMS change is small; the marketplace gains a listing editor, the
ability to correct a release's bytes, a forgot-password flow, and account
controls on the customer page.

## xentium (this repo)

| File | Why |
|---|---|
| `modules/invite/invite.service.ts` | Invite codes mint `XEN-INV-…`, not `NDVO-…`. |
| `core/license-engine/license-engine.ts` | Doc comment: a display reference reads `XEN-`. |
| 3 test files | The prefix assertions — the only place it was ever checked. |

Forward-only: nothing validates the prefix, so references already issued keep
working and no data migration is needed.

## xentium-marketplace

**Licence prefix.** `commerce.service.ts` (licence key, its display reference,
order reference) and `portal.service.ts` (connect code) mint `XEN-`.

**Replacing a release's bytes** — `ingest.service.ts`, `ops/actions.service.ts`,
`ops/ops.routes.ts`. `createRelease` refuses to overwrite a published version and
is right to: an install pins a version and verifies a checksum. But a catalogue
is stocked *before* it has customers, where the same refusal turns "the packager
forgot the screenshots" into a version bump that lies about what changed. The new
path is an ops action, keeps the row, records both checksums in the audit log,
and **refuses outright once a release has been downloaded** unless the operator
acknowledges the count in writing. `deriveListingFromArtifact` was factored out of
`createRelease` so replacing bytes refreshes the storefront the same way
publishing does.

**Listing editor** — `ops/ListingFields.tsx` (shared with the create page),
`ops/OpsListing.tsx`, route `/ops/catalog/:id`, catalog rows now open it and the
table gained a price column. Price, tags, icon, accent, trust tier, state and the
rest were reachable by nothing after creation.

**Forgot password** — `portal/password-reset.service.ts`, two portal endpoints, a
per-IP limiter in `app.ts`, the `password.reset` template, and `Forgot`/`Reset`
pages with a link from the sign-in form. One hour rather than twenty-four,
consuming it revokes every session, and it verifies the address as a side effect.
Both endpoints answer the same thing whatever happened — an honest answer is an
account oracle.

**Customer controls** — `ops/OpsCustomer.tsx` plus four ops actions: rank (refuses
to remove the last staff account), send a reset link (staff never *set* a
password), sign out everywhere, and ban (closes the door only — licences, orders
and connected sites keep working). `Account.bannedAt`/`banReason` and a
`PasswordReset` table, migration `20260916193820`.

**`scripts/ingest-official.ts`** gained `--replace` and `--price <cents>`, which
is how the five first-party listings were re-stocked with their screenshots and
priced.

Tests: 216 marketplace (19 files), 388 API, 762 web. Typecheck and lint clean.

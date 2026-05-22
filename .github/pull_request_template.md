# Pull Request

## What & why
<!-- One or two sentences. Link the phase/task this belongs to. -->
- **Phase / task:**
- **Summary:**

## How tested
<!-- Commands run, manual steps, what you actually verified. -->

---

## Author checklist

### Quality gates — all must pass
- [ ] `pnpm turbo run typecheck lint test build` is green locally
- [ ] New or changed behavior has tests; existing tests still pass
- [ ] No secrets committed — `.env` is not staged, no keys/tokens in the diff
- [ ] PR is scoped to one coherent change (no unrelated drto-by edits)
- [ ] Branch is up to date with `development`

### Architecture & boundaries
- [ ] Stays a modular monolith; each module keeps its routes / controller / service / repository / validation / types / tests shape
- [ ] Core platform engines (plugin / license / installer / permission registry) are not blurred with business modules
- [ ] Official add-ons live in a **plugin**, not in core
- [ ] Shared types, DTOs, and permission keys live in `packages/contracts`

### Security — enforced on the backend
- [ ] All input validated with Zod (body, params, query, env/config, plugin manifests)
- [ ] Permission and license checks run on the backend, not just hidden in the UI
- [ ] Passwords hashed with argon2; cookies/sessions configured securely
- [ ] Plugin/package handling extracts to a temp dir first and guards against path traversal / zip-slip
- [ ] Relevant admin/moderation/auth actions write audit-log or security-events telemetry

### Data
- [ ] Prisma schema changes ship with a migration in the same PR
- [ ] Migration applies cleanly on a fresh DB

### Frozen decisions respected — no drift
- [ ] PostgreSQL + Prisma, REST API, modular monolith, open-source core all unchanged
- [ ] **Core remains usable without any premium plugin** — nothing essential moved behind a license

### Docs
- [ ] Updated `docs/` or an ADR if an architectural decision or public contract changed
- [ ] Updated setup/scaffold scripts if the bootstrap or tooling changed

---

## Reviewer checklist
- [ ] Diff matches the description; scope is genuinely contained
- [ ] The security and boundary items above actually hold — not just ticked
- [ ] No core feature gated behind a license; license only gates official premium plugins
- [ ] Permission keys, contracts, and naming follow existing patterns

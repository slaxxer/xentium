# Changelog

## Security dependency updates, round 2 (remaining dependabot alerts)

- **multer 2.1.1 → 2.2.0** — the runtime upload middleware: fixes a high
  (denial of service via deeply nested multipart field names) and a medium
  (incomplete cleanup of aborted uploads).
- **vitest 3.2.4 → 3.2.7** — fixes a critical advisory in the Vitest UI server
  (arbitrary file read/execute while listening); dev-only tooling. Its
  transitive vite copy stays at the patched 7.3.6, now without needing the
  override from the previous round (removed — it had the side effect of
  rewriting `@vitejs/plugin-react`'s vite peer range and masking its vite-8
  support).
- **shell-quote → 1.10.0** (critical + high) and **form-data → 4.0.6** (high) —
  transitive dev dependencies (concurrently, superagent/supertest), raised via
  scoped security-floor overrides in `pnpm-workspace.yaml` since their parents'
  lockfile entries don't move on their own.

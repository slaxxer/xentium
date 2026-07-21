# Changelog

## Security dependency updates, round 3 (clearing the remaining high alerts)

- **vite 8.0.14 → 8.1.5** — moves the app's own vite past the `server.fs.deny`
  Windows bypass (fixed in 8.0.16).
- **hono → 4.12.31** — transitive under `@hono/node-server` (pulled in by
  Prisma's query tooling); fixes the CORS middleware reflecting any origin with
  credentials when `origin` defaults to the wildcard.
- **brace-expansion → 1.1.16 / 5.0.7** and **js-yaml → 4.3.0** — transitive
  build/dev dependencies; exponential-expansion and quadratic-CPU DoS fixes.
- The three stuck transitives are raised via bounded security-floor overrides in
  `pnpm-workspace.yaml` (each capped below the next major, so a floor can never
  silently jump a dependency across a breaking release).

# Last codebase update

Small fixes for 1.0.0-alpha.11:

- `packages/cli/src/site.ts`: `compareSemver` compares prerelease identifiers one by one, numeric ones as
  numbers (SemVer §11). `xentium update 1.0.0-alpha.10` from alpha.9 was refused as a downgrade. Cases added
  in `packages/cli/src/cli.test.ts`.
- `apps/web/src/features/admin/pages/AboutPage.tsx`: resource links point at doc.xentium.org,
  github.com/slaxxer/xentium, its releases page, and plugins.xentium.org (were `xentium.org/docs`,
  `github.com/nodevo/nodevo`, `xentium.org/changelog`, `xentium.org/plugins`).
- `CHANGELOG.md`: started over for the next release.

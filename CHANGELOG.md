# Changelog

## Security dependency updates (dependabot)

- **adm-zip 0.5.17 → 0.6.0** — fixes CVE-2026-39244 (high): a crafted archive
  declaring a huge uncompressed size could force an unbounded allocation and OOM
  the process. Directly relevant to Nodevo since plugin/theme packages are
  untrusted zips. 0.6.0 also hardens entry-name lookups against `__proto__`
  object injection and ships built-in TypeScript types, so the separate
  `@types/adm-zip` stub is removed. Our extraction paths (`getEntries`,
  `getEntry`/`getData`, `extractAllTo`) are unaffected by the 0.6.0
  `extractEntryTo` behavior change; verified against real `.nvplugin` artifacts.
- **nodemailer 8.0.8 → 9.0.1** — fixes a high-severity advisory (message-level
  `raw` option bypassing file/URL access restrictions) plus two mediums
  (List-* header CRLF injection, jsonTransport access bypass). Our usage is a
  plain `createTransport` + `sendMail`, untouched by the v9 breaking changes.
- **vite (transitive) 7.3.3 → 7.3.6** — the vitest-internal vite copy moves past
  the flagged Windows dev-server issues via a scoped `vite@<8` override in
  `pnpm-workspace.yaml`; the app's own vite 8 is unchanged.

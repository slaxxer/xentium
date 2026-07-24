# Changelog

## ACP Error Reference fully localized (i18n)

- **NEC error catalog is translatable** — the Error Reference page
  (ACP → System → Error Reference) previously rendered its 54-code catalog
  (message / description / cause / fix per code) in hardcoded English regardless
  of the admin's language. The human-readable text now lives in the `acp` locale
  bundle (`errorRef.codes.<CODE>`) and is resolved per language; the page keeps
  only structural metadata (severity + domain) in code. Translated into all five
  bundled languages (en/de/es/fr/pt).
- **Severity and domain labels localized too** — the severity badges
  (Critical/Error/Warning/Info) and domain tags (API, Auth, Permissions, …) now
  display in the active language, while filtering still keys off the stable
  identifier. Search also matches the localized domain name. Plugin-registered
  NEC codes are unaffected — they arrive fully-formed from the server and merge
  in as before.
- **Stray ACP aria-labels externalized** — the number-stepper's
  Decrease/Increase controls (`common.actions.*`) and the ACP topbar breadcrumb
  (`acp.topbar.breadcrumb`), across all five languages.

English text was carried over byte-for-byte from the previous hardcoded catalog
(no wording change); this is a pure externalization.

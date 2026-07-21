# Changelog

## Marketplace logic extracted into its own service

- All marketplace/update/license-status business logic moved out of the admin
  controller into a new `marketplace.service.ts` (admin module): artifact
  download + sha256 verification, update-cache reconciliation, the navbar
  status-summary aggregation, account connect/disconnect, direct install, and
  update-in-place orchestration. The controller now only parses input, maps
  errors to HTTP responses, and owns the NDJSON progress-stream plumbing.
- Every dynamic `await import(...)` in the admin controller (24 of them) is gone —
  dependencies are now regular top-level imports, so import failures surface at
  boot instead of at request time.
- No behavior change: endpoints, response shapes, and error statuses are
  identical; verified by the full check pipeline plus a live boot smoke test.

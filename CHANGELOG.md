# Changelog

## Registration — username & email availability checked at step 1

The register wizard only tested uniqueness on the final `POST /auth/register`, so a
taken username surfaced *after* the user had filled in password, PIN and terms and
verified an email code — then bounced them back to step 1 with the rest of the form
still to redo. Identity is now settled before step 1 is allowed to advance.

- **New public endpoint `POST /auth/register/check-availability`** — takes `email`
  and/or `username` (same format rules as registration), returns which of them are
  free. Behind its own `auth-avail` rate limiter (30/min in production), since the
  wizard polls it as the user types. `checkAvailability()` mirrors the lookups
  `register()` performs — email exact, username case-insensitive — so the probe's
  answer matches the eventual outcome; `register()` remains authoritative.
- **Register step 1 gives live feedback** — debounced (450 ms) probes for email and
  username, inline *checking / available / taken* messages under each field, error
  styling on the input, and **Continue disabled** while either reads taken.
  `validateStep1()` re-checks authoritatively before advancing, so an in-flight or
  skipped probe cannot let a taken value through. A failed probe (offline, rate
  limited) does not block — the server still rejects.
- A late `NEC-AUTH-2001` / `NEC-AUTH-2002` that bounces the wizard back to step 1
  now marks the offending field instead of only firing a toast.
- New strings (`checking`, `emailAvailable`, `usernameAvailable`) across
  en/de/es/fr/pt; the new `.rw-avail` styles use existing tokens only.

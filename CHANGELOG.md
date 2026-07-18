# Changelog

## Fix: global API rate limiter no longer starves guests behind a shared IP

- The global limiter kept **one counter per IP** while allowing 200/min with a Bearer
  header and 60/min without — so an authenticated ACP session's traffic pushed the shared
  count past 60 and every unauthenticated request from the same IP (guest tabs, and
  `auth/refresh` itself, which carries no Bearer) started answering `NEC-API-4290`.
  Localhost testing and any NAT'd audience hit this constantly.
- Now: **authenticated requests count per session** (hashed token key, own 200/min
  budget), unauthenticated requests count per IP with the ceiling raised to **120/min**
  (§26 adjusted — the SPA's polling widgets made 60 unrealistically tight).

# Changelog

## Navbar ACP badge: an at-a-glance signal that something needs attention

- The admin (gear) icon in the site navbar now shows a small count badge when
  there's something waiting in the admin panel — pending plugin updates, or a
  license that's about to expire (within 30 days) or has expired. Admins browsing
  the frontend see it without opening the ACP.
- It **persists until the work is done**: an update stays counted until it's
  applied, and the license keeps contributing while it's expiring/expired. The
  badge turns **red** when anything is urgent (a critical update or a license
  issue) and is neutral otherwise.
- Backed by a single aggregated endpoint, so more "needs attention" signals can be
  folded in later without touching the navbar.

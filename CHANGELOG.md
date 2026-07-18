# Changelog

## License: domain-bound coupling enforced end-to-end

The license model is now enforced the way it is sold: **1 license = 1 instance**, bound to
the domain the plugins were purchased for.

- **Connecting your marketplace account from the wrong domain now fails with a clear
  error** (`NEC-LICENSE-9003`) naming the domain the license is bound to. The license only
  moves to another domain through marketplace support — self-service moving (and with it,
  key resale) is deliberately impossible. Dev/staging instances are unaffected: they never
  consume the production domain slot.
- **The domain used for licensing is the canonical site URL** (ACP → `site.url`) — the same
  URL served in canonical/OG meta — no longer the deploy-environment `APP_URL`.
- **Disconnecting the marketplace account now deactivates account-activated licenses**
  (they could never refresh again anyway — the raw key never reaches the instance) and
  revokes the instance token server-side. Manually entered keys are untouched: they remain
  the offline fallback. A license Refresh on an instance that disconnected earlier converges
  it to the same state instead of letting a 30-day grace zombie linger.

## UX: own toast + dialog system (sweetalert2 removed)

- **`lib/toast.ts` + `<ToastHost/>`** — Nodevo's own toast stack (top-right): categories
  success / info / warning / error with per-category durations (errors persist 10 s with an
  explicit dismiss), stacking (max 4 + queue), duplicate collapsing with a ×N counter,
  hover-pause, optional action button, `aria-live` semantics, and `prefers-reduced-motion`
  support. Colours are tokens (`--toast-*` → semantic feedback palette), so the **Style
  Editor → Feedback** section themes toasts live — it gained the missing **Info** colour row
  and a "Preview toasts" button that fires live samples.
- **`lib/dialog.ts` + `<DialogHost/>`** — promise-based confirm/alert dialogs (Escape
  cancels, Enter confirms), Hearth-styled on tokens.
- **Plugin extension points**: `registerToastCategory({id, color, icon, duration})` for
  custom categories and `onToast(listener)` to observe the stream; exposed as host globals
  (`webToast`, `webDialog`).
- `lib/swal.ts` stays as a compatibility facade (`swalToast`/`swalConfirm`/`swalError`), so
  every existing call site and plugin works unchanged — but **sweetalert2 is removed** from
  the dependency tree. 7 unit tests on the toast store.

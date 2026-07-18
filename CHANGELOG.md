# Changelog

## License: the marketplace account is now the license — manual keys removed

- **ACP → Extensions → License is account-only.** The manual license-key input (and its
  `POST /admin/license/activate` endpoint) is gone: connect your nodevo.io account and the
  license from your purchase activates automatically for this site's domain. The page now
  centers on the account connection; with an account connected but no license yet, an
  "Activate from account" button triggers the activation on the spot.
- The standalone Deactivate button is gone too — with account-driven licensing it was a
  trap (the next refresh would immediately re-activate). Disconnecting the account is the
  one lever, and it deactivates the license with it.
- Licenses activated with a manual key before this change keep refreshing and working
  unchanged; only NEW manual activations are impossible.
- All five locales updated.

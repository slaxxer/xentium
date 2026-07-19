# Changelog

## Plugins: marketplace-first installs, and paywall enforced by plugin identity

- **Manual plugin uploads are now off by default.** The marketplace is the sanctioned
  install channel; an admin can re-enable manual `.nvplugin` uploads from ACP →
  Extensions → Installed. When off, the Upload page is hidden and the upload endpoint
  is blocked. Installing from the marketplace is never affected.
- **Paid plugins are enforced by their identity, not a self-declared flag.** A plugin
  now requires a license only if the marketplace actually sells that plugin id as paid —
  regardless of what the uploaded package's manifest claims. This closes the "repackage a
  paid plugin as free and sideload it" loophole. Genuine third-party plugins (ids the
  marketplace doesn't sell) install and run freely, so the community ecosystem is
  unaffected.

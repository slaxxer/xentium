# Changelog

## Marketplace: direct plugin install from the ACP

- **Install button on ACP → Marketplace**: for plugins the connected account is
  entitled to, the server fetches the `.nvplugin` from the marketplace itself
  (120 s timeout, 50 MB cap), verifies the artifact's **sha256** against the
  download authorization, confirms the manifest id matches the requested
  plugin, and then runs the exact same intake as a manual upload. The plugin
  lands **installed but disabled** — enabling stays an explicit step.
- New endpoint `POST /admin/marketplace/install` (admin-gated, rate-limited);
  `AuthorizedDownload` contract gains `sha256?` (the marketplace now returns
  the release hash alongside the signed download URL). A mismatched hash or
  manifest aborts before any install step — nothing half-installed.
- Manual upload under Extensions → Upload is unchanged and remains the offline
  path.

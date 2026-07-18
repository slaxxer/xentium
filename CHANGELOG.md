# Changelog

## Fonts: the Style Editor font is now truly site-wide — with a clear three-tier model

- **The bug**: the per-user font hook applied its own default (Nunito) as an inline
  override for every visitor on every load — the admin's Style Editor font never actually
  reached anyone. And headings were hardcoded to Poppins app-wide.
- **The model now**: the admin's Style Editor font applies to the whole frontend — body
  AND headings. Users can override it personally in Profile → Preferences (new
  "Site default" option = follow the admin's choice; a personal pick sets both fonts for
  that user). **The ACP always stays Poppins**, regardless of site or user font — it's
  pinned at body level so dialogs and toasts follow the context they appear in.
- Style Editor live preview updated to preview headings and to punch through the ACP's
  Poppins pin while editing.
- **Poppins is now the base font everywhere** (was Nunito for body text): an untouched
  install is uniformly Poppins until the admin picks a site font or a user picks a
  personal one. Base body weight adjusted 600 → 500 (600 was Nunito-specific; both remain
  admin-tunable in the Style Editor).
- **Font set trimmed to five**: Poppins, Nunito, Montserrat, Open Sans, Ubuntu — in the
  Style Editor, the user preferences picker, and the served-CSS stacks alike. Raleway,
  Roboto (and the unused Playfair Display package) removed from the bundle; anyone who
  had picked a removed font falls back gracefully to the site default.

## Cleanup: update dialog is the single update surface

- Removed the "Plugin updates available" banner from ACP → Marketplace and the `update`
  toast category — toasts are back to success / info / warning / error. The Style
  Editor's Feedback "Update" slot stays: `--c-update` themes the update panel dialog.
- Notification surfaces (dialogs + toasts) explicitly follow the active font context.

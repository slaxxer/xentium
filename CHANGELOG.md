# Changelog

## i18n: Groups ACP page translated (part 4)

- The **Groups** admin page — the last hardcoded ACP page — is now fully translated
  across all five bundled locales. This covers every surface of the page: the create
  and edit group modals (identity, badge, icon, team-page toggle), the username-glow
  editor, the permissions picker, and the progression modal (ladder position, promotion
  thresholds, content limits), plus the group list, reorder controls, member/permission
  counts, and all confirmations and toasts.
- With this, the entire ACP frontend is internationalized. The only remaining English
  strings are the per-token labels from the shared `@nodevo/contracts` token registry,
  which are a separate registry-level pass.

# Changelog

## Live progress dialog when updating a plugin

- Updating a plugin from **Extensions → Updates** now shows a **real-time progress
  dialog** instead of a toast. The server streams each step as it happens —
  authorizing, downloading (with real byte progress), verifying, installing files,
  running migrations, enabling — and the dialog's bar and label follow along, then
  show success or the failure reason. The success toast has been removed; the
  dialog is the whole feedback surface.
- Installing or uploading a plugin now refreshes the update check immediately, so a
  just-installed older build shows its available update on the next ACP entry
  rather than waiting for the daily job.

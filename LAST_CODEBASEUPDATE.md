# Last codebase update

Core update notifications on the instance (steps 4 and 5 of the core releases plan), plus the
release pipeline that publishes the packages those notifications point at.

## New

| Path | Purpose |
|---|---|
| `.github/workflows/release.yml` | The Release workflow. Triggered by a `v*` tag or by hand (dry run by default). Installs, typechecks, lints, publishes through `publish-release.mjs`, uploads the tarballs, attaches them to a GitHub release. Actions are pinned by commit SHA; `NPM_TOKEN` is the only secret. |
| `scripts/publish-release.mjs` | One script for a whole release: framework packages, `@xentium/server`, `xentium`, `create-xentium`. Resolves the version and dist-tag from the repo, refuses a tag that disagrees with it, skips what is already published, prints the marketplace announcement that still has to be made. |
| `apps/docs/src/content/docs/admin/updating.md` | Wiki page for server admins: how a site finds out about a release, what the urgency means, and every step and flag of `xentium update`. |
| `apps/api/src/jobs/coreUpdateCheck.ts` | The anonymous core check and the `core.update` cache. Sibling of the plugin heartbeat, not part of it. |
| `apps/api/src/modules/admin/coreCompat.ts` | Whether each installed plugin's declared version window contains the release being offered. |
| `apps/web/src/features/admin/components/CoreUpdateCard.tsx` | The core card on Extensions → Updates. |

## Changed

| Path | Change |
|---|---|
| `scripts/release-framework.mjs` | Gained `--provenance` and `--skip-published`, so CI can drive it and a half-finished release can be re-run. Header points at `publish-release.mjs` for a full release. |
| `package.json` | `release` and `release:dry` scripts. |
| `apps/api/src/jobs/updateCheck.ts` | The marketplace sync runs the core check as a third step, whatever the other two do. |
| `apps/api/src/workerBoot.ts` | The boot check runs the core check too, not only the plugin half. |
| `apps/web/src/features/admin/AcpLayout.tsx` | The ACP-entry dialog includes core, with its own anchor and the patch-only restraint. |
| `apps/api/src/modules/admin/marketplace.service.ts` | `getUpdates` returns core; `getStatusSummary` ORs it into the gear badge. |
| `apps/web/public/locales/*/acp.json` | Strings for the card and dialog, all five locales. |

# Last Codebase Update — 2026-07-25 (groupConfigPanel slot)

Core support for plugin-contributed per-group config, rendered as tabs in the ACP
Groups dialog. This is the core half of the shoutbox → progression integration
(Phase 2); the shoutbox plugin (1.2.0, git-ignored) consumes it.

## Core (this PR)

- `apps/web/src/plugins/slotRegistry.ts` — new `GroupConfigPanelSlot`
  (`{ id, label, component: ({groupId, groupName}) => …, order? }`), plus
  `registerGroupConfigPanel` / `getGroupConfigPanels` / deregister filter. Reaches
  plugins through the existing `webSlotRegistry` host global (no host-globals edit
  needed — it re-exports the module).
- `apps/web/src/features/admin/pages/GroupsPage.tsx` — `ProgressionModal` is now
  tabbed: a core "Progression" tab + one tab per `getGroupConfigPanels()` entry.
  The tab bar only renders when ≥1 plugin panel exists; the plugin panel is
  rendered as `<panel.component groupId groupName />` and owns its own save.
- `apps/web/public/locales/{en,de,es,fr,pt}/acp.json` — `groups.tabProgression`.

## Plugin side (nodevo-shoutbox 1.2.0 — git-ignored, NOT in this PR)

- New `web/acp/ShoutboxGroupLimits.tsx` panel (per-group numeric limits via the
  existing `/admin/capabilities` API); `registerGroupConfigPanel` in web/index.tsx;
  retired the standalone Capabilities tab from the Shoutbox ACP; `caps.saving` ×5.
  No schema change. Repackaged `plugins/packaged/nodevo-shoutbox-1.2.0.nvplugin`.

## Verification

- web typecheck + build green; plugin typecheck + build green.
- Live verification pending (visual — the Shoutbox tab in the Groups dialog).

# Changelog

## Per-group plugin config panels — `groupConfigPanel` slot + tabbed Group dialog

Core support for plugins to contribute **per-group settings** into the ACP Groups
editor, as tabs, so the dialog stays compact no matter how many plugins add config.

- **New `groupConfigPanel` web slot** (`slotRegistry`): a plugin registers
  `{ id, label, component }`; the component receives `{ groupId, groupName }` and
  owns its own data (reads/writes via the plugin's own API) — core never learns
  the plugin's schema. Auto-exposed to plugins via the existing host global;
  deregistered on plugin disable.
- **The Group settings dialog (ACP → Groups → Progression) is now tabbed** — a
  core "Progression" tab plus one tab per registered plugin panel. Tabs only
  appear when a plugin contributes one, so nothing changes on a site without such
  plugins. `groups.tabProgression` localized across en/de/es/fr/pt.

This is the core half of the shoutbox capabilities → progression integration: the
shoutbox (plugin, 1.2.0) uses this slot to move its per-group numeric limits out of
a standalone matrix and into the Groups dialog, next to the group's progression
config. Boolean shoutbox caps already became core permissions in the plugin's 1.1.0.

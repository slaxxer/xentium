# Changelog

## Plugin developer docs: migrations & database conventions

Follow-up to the plugin table-naming validator (NEC-PLUGIN-2013). Documents the
full set of migration/database rules plugin authors must follow, so the newly
enforced conventions are discoverable rather than surprising at install time.

- **README → "Migrations & database conventions"** — a new subsection in the
  Plugin development guide consolidating the rules the host enforces: DDL-only
  (2010), paired up/down (2011), table naming + `tablePrefix` + reserved
  namespaces (2013), immutable applied migrations / checksums (2012),
  forward-only updates matched by name, and the no-cross-boundary-FK rule. Each
  rule cites its `NEC-PLUGIN-*` code.
- The manifest example already carries `tablePrefix`; `@nodevo/plugin-sdk`'s
  `PluginManifest` authoring type documents the field.

The four official `.nvplugin` artifacts were repackaged so their bundled
manifests now include their real `tablePrefix` (`forum_`, `pm_`, `amod_`, `sb_`)
— local artifacts only; `plugins/` is git-ignored.

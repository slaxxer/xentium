# Versions and what they promise

From 1.0.0 on, Xentium follows [Semantic Versioning](https://semver.org/). A version is
`MAJOR.MINOR.PATCH`, and the number that changes tells you what to expect:

- **Patch** (`1.0.1`): fixes only, security fixes included. Nothing you built stops working.
- **Minor** (`1.1.0`): new features. Everything you built keeps working.
- **Major** (`2.0.0`): something you may rely on changes or goes away. The changelog lists
  each change and what to do about it.

Each number counts on its own; they are not decimals. After `1.9.0` comes `1.10.0`, and
`2.0.0` only comes when something breaks.

## How often we release

- **Patches** whenever a fix is ready. A security fix goes out as soon as it is ready, as a
  patch on the newest release, so you can take it without taking new features along.
- **Minor releases** when a set of features is done, roughly every four to six weeks.
- **Major releases** rarely, and only after what they remove has been deprecated in a minor
  release first (see below).

For example: `1.0.0`, then `1.0.1` with fixes, `1.1.0` with new features, `1.1.1` with a
security fix, `1.2.0` with more features.

## What the promise covers

These are Xentium's public interfaces. Within a major version we don't break them:

- **The REST API**: every endpoint in [the API reference](./API.md), the fields of its
  requests and responses, and its error codes. We may add endpoints, fields and error
  codes in a minor release; your code should ignore fields it doesn't know.
- **The plugin interface**: `@xentium/plugin-sdk` and `@xentium/contracts`, everything a
  plugin is handed (`ctx`, `ctx.host`, the registries in
  [the plugin guides](./plugin-registries.md)), the browser host
  (`window.__XENTIUM_HOST__`, the block and edge registries) and the plugin manifest.
- **Theme packages** (`.xttheme`, see [theme packages](./theme-packages.md)) and the
  layout documents inside them. A theme made for 1.x installs on every 1.x.
- **The CLI and the site layout**: the `xentium` commands and the folders of an installed
  site (`releases/`, `shared/` with `.env`, `uploads/`, `backups/`).
- **Style tokens**: the CSS variables themes set (see [the style system](./style-system.md)).

## What it doesn't cover

- **The database schema.** Core's tables can change in any release, and an update migrates
  them. A plugin should use what `ctx.host` offers rather than read core tables directly;
  when we change a table plugins commonly read, the changelog says so.
- **Undocumented endpoints**, internal modules and anything not exported from the
  packages above.
- **The look**: the ACP and the site's markup and CSS class names may change in a minor
  release. Style a site through tokens, layouts and themes, not by targeting class names.

## Deprecations

When we plan to remove something covered above, we mark it deprecated in a minor release
and the changelog says what to use instead. It keeps working until the next major release.

## Pre-releases

Release candidates (`1.0.0-rc.1`, `-rc.2`, …) come before a release. They are complete
and get fixes only: no new features between the first candidate and the release. On npm
they are published under the `rc` tag; `latest` always points to the newest release.

## Security fixes

We fix security problems in the newest release only, and say in the changelog when a
release contains one. See [the security policy](../SECURITY.md) for keeping a site safe.

## Plugins and versions

A plugin names the core it needs with `minXentiumVersion` (and, if it must,
`maxXentiumVersion`) in its manifest:

- `"1.0.0"` means any 1.x release, its release candidates included. Xentium begins at
  1.0.0, so this is the lowest version there is and the one to use unless you need
  something newer.
- `"1.2.0"` means 1.2.0 or newer. Use it when your plugin needs something 1.2 added.
- A version with a pre-release part (`"1.0.0-rc.2"`) means exactly that pre-release or
  newer.

A plugin made for 1.x keeps working on every 1.x release.

### A plugin's own version

A plugin's `version` follows the same three rules: a fix raises the patch (`1.0.1`), a new
feature the minor (`1.1.0`), and a change that breaks a site's existing setup or data the
major (`2.0.0`). Every release gets a new version. Once a version is published, its
package never changes: a site that installed `1.2.0` has exactly what `1.2.0` was, and an
update notice only appears when there is something newer. Our own plugins work the same
way.

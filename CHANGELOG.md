# Changelog

## Block layouts — page structure becomes a document, not markup

Admins could always change how a site looks. They could never change where things are:
page structure was compiled into React components, so every layout variation had to ship
as core code. It is a layout **document** now — blocks per region per template, stored in
`ncf_layouts`, edited in ACP → Appearance → Layout Editor.

The rule that makes it safe: **themes are data, plugins are code.** A `.nvtheme` ships
layout documents and tokens, never `.tsx`, so installing one can never execute a stranger's
JavaScript in your admin session. Plugins register blocks; unknown block types are skipped
and kept, so disabling a plugin never deletes an admin's arrangement.

- **All 8 core templates render** through the system — six pages plus the navbar and
  footer. Auth and the ACP are excluded permanently.
- **Nesting.** `section`, `columns` and `column` compose; plugins may register their own
  containers. Depth is capped at 5 and every save is validated as a tree.
- **Per-page layouts.** A variant key (a page slug) gives one page its own arrangement,
  resolved in exactly two steps — variant, then template default. No cascade.
- **Audiences.** A block can be narrowed to guests, members or specific groups. It is
  presentation, not access control: the block's own permission gate still runs.
- **Style variants.** `surface` / `muted` / `accent` / `plain` are named token buckets, not
  per-block colours, so a variant follows the site palette and both themes for free.
- **Undo/redo** with a 50-step history, and a way to discard a draft without losing the
  published layout.

## Theme packages

`.nvtheme` is a real package: manifest, a full scoped token set, layout documents, custom
CSS and assets. Export copies referenced images in and rewrites paths package-relative;
import unpacks them magic-byte-checked and rewrites again. Validation is all-or-nothing —
a package that fails leaves the site exactly as it was.

A theme is a **layer under** the admin's own changes, not an overwrite. Tokens merge per
token; layouts merge per template, so a customised page is kept rather than replaced.
Resetting your own edits does not throw away the theme.

`.nvstyle` is absorbed: a style pack was a strict subset of a theme, so it is imported
through the theme path now and produced by exporting with `tokensOnly`. **ACP → Appearance
→ Styles and ACP → Appearance → Guest Home are both retired** — guest hero copy and section
toggles are block props now, carried over automatically on first boot.

## Plugin-registered layout templates

A plugin can open one of its own pages to the layout editor. The template set is a runtime
registry: core seeds it through the same call a plugin uses. Registration fails loudly
rather than half-succeeding — a core key, another plugin's key, or a default document that
would not survive a save all refuse the enable. Disabling a plugin deregisters its
templates but **keeps the rows**, so re-enabling restores the arrangement.

Reference implementation: nodevo-forum 1.1.0 (`forum.index`).

## Scheduled tasks admins can compose themselves

The Scheduled Tasks page could only answer *when* the built-in jobs run. Admins can now
build their own recurring tasks from composable actions, with the same cron guardrails.

## Licensing — install identity and one marketplace conversation

- **An install with no identity can no longer talk to the licence server.** `getSiteId()`
  used to fall back to the literal string `"dev-site"`, which is a shared identity —
  activations, per-domain caps and audit trails from every affected install collapsed into
  one bucket. It now fails with `NEC-LICENSE-9010`. Disconnecting still works regardless.
- **The daily marketplace call is spread across the day, per install.** Every install
  shipped the same `0 2 * * *`, so every Nodevo instance in the world contacted the
  marketplace inside the same minute. The default time is now derived from the install's
  own id. A time you set yourself is never changed.
- **License refresh and the update check are one job**, "Marketplace sync". They were two,
  thirty minutes apart, for what is a single exchange with the same server.

## Fixes

- The API test suite no longer truncates the development database — it runs against a
  disposable `_test` database, and refuses to run against anything not named that way.
- The client shows a real crash screen instead of the router's developer default.
- Dependency updates closing 8 Dependabot advisories.

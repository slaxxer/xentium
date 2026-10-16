---
title: Switching from WordPress
description: What you gain and what you give up when you move a WordPress site to Xentium, what our migration tool brings over, and how the switch works.
sidebar:
  order: 2
---

WordPress is the most widely used way to publish on the web, and if your site is mostly
a blog or a business site, it is probably still the right tool. Xentium is worth a look
when your site is really a **community**: members, discussions, moderation, with
articles alongside. On WordPress that usually means bbPress, BuddyPress and a stack of
plugins on top; on Xentium it's one platform.

Checked on 15 October 2026. See [Xentium compared](/switch/compare/) for the full matrix.

## What you gain

- **A community platform from the ground up.** Profiles, follows and blocks, profile
  walls, notifications, progression ranks and moderation (reports, warnings, bans,
  review cases) are part of core, not separate plugins that each work their own way.
- **A forum that belongs to the site.** The forum is an official Xentium plugin. It uses
  the same members, permissions, editor and notifications as your articles.
- **Design without code.** Theme Studio changes colours, fonts and every page's layout
  in a live preview. Like the WordPress Site Editor, you arrange blocks; unlike a
  WordPress theme, a Xentium theme is data only and can't run code on your server.
- **Sign-in built in:** passkeys, sign-in links by email, and Google, GitHub and Discord,
  without a plugin.
- **Fewer moving parts to update.** Core and a few official plugins, instead of a long
  plugin list from many authors.

## What you give up

- **The ecosystem.** WordPress has tens of thousands of plugins and themes: SEO, shops,
  forms, page builders, newsletters. Xentium has a handful. If your site depends on a
  particular plugin, check for an equivalent first; usually there isn't one yet.
- **Shared hosting.** WordPress runs almost anywhere. Xentium needs a server with
  Node.js, PostgreSQL and Redis (a small VPS is enough). There's no hosted plan.
- **Maturity.** WordPress has been in production since 2003. Xentium is an alpha.
- **Your members reset their password once.** A WordPress export doesn't contain
  password hashes, so we can't carry passwords over.

## What our migration tool moves over

`@xentium/migrate-wp` reads a **WXR export file** (wp-admin → Tools → Export). You don't
need database access or a running WordPress.

| Moves over | Doesn't move over |
|---|---|
| Users, display names, join dates, admins and moderators mapped to Xentium groups | Passwords (members reset once) |
| Categories with their hierarchy | Themes, styling and plugins |
| Blog posts as articles: headings, lists, quotes, code, images and links | Pages and every other content type, including bbPress forums (counted in the report) |
| Tags | Media files (we link to them by URL, we don't download them yet) |
| Member comments, threaded one level deep | Guest comments (comments on Xentium need an account) |

Accounts that match an existing Xentium user by email are merged into that user. The
migration report lists everything we skipped and why.

## How to switch

1. **Export** your site in WordPress: Tools → Export → All content.
2. **Install Xentium** on your server and finish the installer
   ([Installing Xentium on a server](/admin/installing/)).
3. **Do a dry run.** It reads, converts and reports, and writes nothing:
   ```bash
   pnpm --filter @xentium/migrate-wp migrate -- \
     --file my-export.xml --db "postgresql://…" --dry-run
   ```
4. **Read the report**, then run it for real (the same command without `--dry-run`).
   You can watch it under ACP → System → Migration History, and an interrupted run
   continues where it stopped.
5. **Recreate your pages.** Static pages (About, Contact and so on) aren't imported;
   rebuild them as articles, and use Xentium's legal pages for an imprint or privacy
   policy.
6. **Keep your media reachable.** Imported articles link to images on the old site, so
   leave those files online (or copy them over and adjust the links).
7. **Keep your old links working:** add `--redirects <folder>` to the real run and put
   the nginx file it writes into your web server. Your permalinks (taken from the
   export), `?p=` links and author pages then go to their new pages.
8. **Tell your members** to use "Forgot password" on their first visit.

The full reference is [Migrating from another platform](/guides/migrating/).

## Sources

- What `@xentium/migrate-wp` imports: [Migrating from another platform](/guides/migrating/)
- bbPress: [wordpress.org/plugins/bbpress](https://wordpress.org/plugins/bbpress/)
- WordPress plugin directory: [wordpress.org/plugins](https://wordpress.org/plugins/)

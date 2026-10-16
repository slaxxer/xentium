---
title: Switching from XenForo
description: What you gain and what you give up when you move a XenForo forum to Xentium, what our migration tool brings over, and how the switch works.
sidebar:
  order: 4
---

XenForo is a polished, mature forum with a big add-on scene and an optional hosted
version. Honestly, as a pure forum it is ahead of Xentium today. Xentium is worth a look
if you want an open-source core, articles and a forum as one site, and a layout you can
rearrange freely.

Checked on 15 October 2026. See [Xentium compared](/switch/compare/) for the full matrix.

## What you gain

- **An open-source core.** Xentium's core is MIT licensed and on GitHub. XenForo is
  proprietary, with a paid licence and paid renewals for updates.
- **Articles in core.** XenForo is a forum first; articles and pages need add-ons.
- **Whole pages by drag and drop.** Theme Studio's layout editor arranges every page
  (and the header and footer) in a live preview, beyond XenForo's widget positions.
- **Themes that are data.** A Xentium theme ships colours, fonts and layouts, never code.
- **Moderation with review cases** and abuse detection (rapid logins, multi-accounts,
  registration bursts, ban evasion) that opens a case for a human.
- **Five languages bundled:** English, German, Spanish, French and Portuguese.

## What you give up

- **Maturity and polish.** XenForo has been in production since 2010. Xentium is an alpha.
- **Add-ons.** XenForo's add-on and style directory is large. Xentium has a handful of
  plugins, so check for anything your forum depends on.
- **Official extras.** XenForo Media Gallery and Resource Manager have no Xentium
  equivalent yet.
- **Hosting choice.** XenForo runs on shared PHP hosting and has a hosted cloud version.
  Xentium needs a server with Node.js, PostgreSQL and Redis, and there's no hosted plan.
- **Authenticator-app two-factor.** Both have passkeys; XenForo also has app codes,
  Xentium doesn't yet.
- **Reactions become likes.** Xentium has likes, not a set of reaction types.

## What our migration tool moves over

`@xentium/migrate-xenforo` connects directly to your XenForo 2.x **MySQL database**. The
Xentium forum plugin has to be installed and enabled first.

| Moves over | Doesn't move over |
|---|---|
| Users, display names, join dates | Attachments and media (linked by URL, not downloaded) |
| Passwords, for users with XenForo's standard bcrypt hashes | Styles and add-ons |
| Admins and moderators mapped to Xentium groups | Media Gallery and Resource Manager content |
| Last visits (shown as "Last seen"), and smiley codes as emoji | |
| Your other user groups, primary and secondary, by name (you set what they may do) | Group permissions |
| Thread prefixes, with their colour and the forums they were offered in | Prefix groups and per-group prefix rules |
| The whole node tree | Reaction types (each becomes a like) |
| Threads, including locked, pinned and view counts | |
| Posts, with BBCode converted | |
| Reactions as likes, follows 1:1, ignores as blocks | |
| Conversations, with who left or removed them (needs the messaging plugin) | Signatures, polls and custom user fields |
| Date of birth, website and avatars (with `--files`) | |
| Thread tags, and thread watches for the threads that came over | |
| Bans and warnings still in force, under the moderator who issued them | |
| Profile posts with their comments | |

We recount every like and follower total afterwards, and the migration report lists
everything we skipped and why.

Posts and messages arrive in exactly the shape our editor saves, so they look like
posts written on Xentium and editing one changes nothing. Images from other sites
become links, because the editor keeps no outside images in posts.

## How to switch

1. **Install Xentium** on your server, finish the installer, then install and enable the
   forum plugin ([Installing Xentium on a server](/admin/installing/)).
2. **Close the forum** while you move, so nothing is posted in between.
3. **Do a dry run.** It reads, converts and reports, and writes nothing:
   ```bash
   pnpm --filter @xentium/migrate-xenforo migrate -- \
     --source-db "mysql://user:pass@host:3306/xenforo" \
     --db "postgresql://…" --dry-run
   ```
   Use `--prefix` if your tables don't start with `xf_`. For avatars, add
   `--files <your XenForo folder> --uploads <Xentium's upload folder>`.
4. **Read the report**, then run it for real (the same command without `--dry-run`).
   Watch it under ACP → System → Migration History.
5. **Keep the old attachments reachable,** or copy them over.
6. **Keep your old links working:** add `--redirects <folder>` to the real run and put
   the nginx file it writes into your web server. Thread, post, forum and member links
   then go to their new pages, with or without friendly URLs.

The full reference is [Migrating from another platform](/guides/migrating/).

## Sources

- What `@xentium/migrate-xenforo` imports: [Migrating from another platform](/guides/migrating/)
- XenForo licences and official add-ons: [xenforo.com/purchase/self-hosted](https://xenforo.com/purchase/self-hosted)
- XenForo 2.3 release notes: [xenforo.com community announcement](https://xenforo.com/community/threads/xenforo-2-3-0-add-ons-released.222873)

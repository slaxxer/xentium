---
title: Switching from phpBB
description: What you gain and what you give up when you move a phpBB board to Xentium, what our migration tool brings over, and how the switch works.
sidebar:
  order: 3
---

phpBB has run message boards since 2000. It's free, open source, light, and it runs on
nearly any web host. If your board does its job and you're happy with it, there's no
pressing reason to leave. Xentium is for boards that want to become more than a board:
articles next to the forum, a modern design you can rearrange, and moderation tools
built for today's spam and abuse.

Checked on 15 October 2026. See [Xentium compared](/switch/compare/) for the full matrix.

## What you gain

- **Articles and a forum together,** with the same members, permissions and editor.
- **A modern editor** instead of BBCode. Your old posts are converted.
- **Design without code.** Theme Studio changes colours, fonts and the layout of each
  page in a live preview. On phpBB that means editing templates and CSS.
- **Members' features:** profiles with walls, follows and blocks, notifications, and
  progression ranks that members earn.
- **Moderation in one place:** reports, warnings, bans and review cases, plus abuse
  detection (rapid logins, multi-accounts, registration bursts, ban evasion) that opens
  a case for a human. It never acts on its own.
- **Sign-in built in:** passkeys, sign-in links by email, and Google, GitHub and Discord.
- **Members keep their passwords.** We check the old phpBB hash on their first login
  and upgrade it.

## What you give up

- **Shared hosting.** phpBB runs on PHP and MySQL almost anywhere. Xentium needs a server
  with Node.js, PostgreSQL and Redis. There's no hosted plan.
- **Extensions.** phpBB's extension database is large and many boards rely on a few of
  them. Xentium's plugin list is short.
- **Maturity.** phpBB is 25 years old and very well tested. Xentium is an alpha.
- **Attachments** don't come over in this version of the tool (see below).
- **Authenticator-app two-factor.** Xentium has passkeys but no app codes yet. On phpBB
  both need an extension.

## What our migration tool moves over

`@xentium/migrate-phpbb` connects directly to your phpBB 3.1 or newer **MySQL database**.
The Xentium forum plugin has to be installed and enabled first; we check before anything
runs.

| Moves over | Doesn't move over |
|---|---|
| Users with their passwords, display names and join dates | Attachments and uploaded files (linked by URL, not downloaded) |
| Admins and moderators mapped to Xentium groups | Styles and extensions |
| Last visits (shown as "Last seen"), and smiley codes as emoji | |
| Your other member groups, by name and with their members (you set what they may do) | Group permissions |
| The whole forum tree | The "friends" list (it's private in phpBB, so we don't turn it into public follows) |
| Topics, including locked, pinned and view counts | |
| Posts, with BBCode converted | |
| Foes, which become blocks | |
| Private messages, grouped into conversations (needs the messaging plugin) | Signatures and polls |
| Date of birth and website, and uploaded avatars (with `--files`) | Gallery and remote avatars |
| Topic subscriptions, for the topics that came over | Bans on an IP address or email only |
| Bans on an account, and warnings, that are still in force | |

Accounts that match an existing Xentium user by email are merged into that user, and
we recount every like and follower total. The migration report lists everything we
skipped and why.

Posts and messages arrive in exactly the shape our editor saves, so they look like
posts written on Xentium and editing one changes nothing. Images from other sites
become links, because the editor keeps no outside images in posts.

## How to switch

1. **Install Xentium** on your server, finish the installer, then install and enable the
   forum plugin ([Installing Xentium on a server](/admin/installing/)).
2. **Put the board in maintenance** so nothing new is posted during the move.
3. **Do a dry run.** It reads, converts and reports, and writes nothing:
   ```bash
   pnpm --filter @xentium/migrate-phpbb migrate -- \
     --source-db "mysql://user:pass@host:3306/phpbb" \
     --db "postgresql://…" --dry-run
   ```
   Use `--prefix` if your tables don't start with `phpbb_`. For avatars, add
   `--files <your phpBB folder> --uploads <Xentium's upload folder>`.
4. **Read the report**, then run it for real (the same command without `--dry-run`).
   Watch it under ACP → System → Migration History. An interrupted run continues where
   it stopped instead of creating duplicates.
5. **Keep the old attachments reachable,** or copy them over, because imported posts
   link to them.
6. **Keep your old links working:** add `--redirects <folder>` to the real run and put
   the nginx file it writes into your web server. `viewtopic.php?t=…`, `?p=…`,
   `viewforum.php` and profile links then go to their new pages.

The full reference is [Migrating from another platform](/guides/migrating/).

## Sources

- What `@xentium/migrate-phpbb` imports: [Migrating from another platform](/guides/migrating/)
- phpBB releases and support: [phpbb.com](https://www.phpbb.com/), [endoflife.date/phpbb](https://endoflife.date/phpbb)

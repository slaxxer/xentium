---
title: Switching from vBulletin
description: What you gain and what you give up when you move a vBulletin forum to Xentium, what our migration tool brings over, and how the switch works.
sidebar:
  order: 6
---

vBulletin has run large forums since 2000, and vBulletin 6 bundles forums, articles,
blogs and groups with a drag-and-drop Site Builder and a hosted cloud option. Many older
boards still run vBulletin 3 or 4. Our migration tool handles all of them: it detects
which version your board is on.

Checked on 15 October 2026. See [Xentium compared](/switch/compare/) for the full matrix.

## What you gain

- **An open-source core.** Xentium's core is MIT licensed and on GitHub. vBulletin is
  proprietary, with a paid licence and paid maintenance for updates.
- **A modern stack.** TypeScript and PostgreSQL, with current sign-in: passkeys, sign-in
  links by email, and Google, GitHub and Discord.
- **Themes that are data.** A Xentium theme ships colours, fonts and layouts, never code.
- **Moderation with review cases** and abuse detection that opens a case for a human.
- **Five languages bundled:** English, German, Spanish, French and Portuguese.
- **Members keep their passwords.** We check the old vBulletin hash on their first login
  and upgrade it.

## What you give up

- **Blogs and groups.** vBulletin 6 lists blogs and social groups as built in. Xentium
  has articles and a forum, but no member blogs or groups yet.
- **A hosted plan.** vBulletin offers a cloud version. Xentium has none.
- **Shared hosting.** vBulletin runs on PHP and MySQL. Xentium needs a server with
  Node.js, PostgreSQL and Redis.
- **Maturity.** vBulletin has been in production since 2000. Xentium is an alpha.
- **Attachments** don't come over in this version of the tool (see below).

## What our migration tool moves over

`@xentium/migrate-vbulletin` connects directly to your vBulletin **MySQL database**, for
vBulletin 3, 4, 5 and 6. The Xentium forum plugin has to be installed and enabled first;
we check before anything runs.

| Moves over | Doesn't move over |
|---|---|
| Users with their passwords, display names and join dates | Notifications and friend requests (vB5/6 keeps them with messages) |
| Administrators, Super Moderators and Moderators mapped to Xentium groups | Attachments (a marker shows where one was) |
| Last visits (shown as "Last seen"), and smiley codes as emoji | |
| Your other usergroups, primary and additional, by name (you set what they may do) | Usergroup permissions |
| Thread prefixes and the forums or channels they were offered in | Per-usergroup prefix rules |
| The forum tree: categories and forums (vB5/6: the channels under Forum) | Blogs, groups, albums and polls |
| Threads, including locked, sticky and view counts | Posts and threads by guests (posts on Xentium need an account) |
| Posts and vB5/6 comments, with BBCode converted and videos as links | Deleted, moved and unapproved threads and posts |
| vB5/6: positive reputation on posts as likes, and member follows | The buddy list (it's private, so we don't turn it into public follows) |
| Ignore lists, which become blocks | Reputation points, expired infractions, styles and products |
| Private messages as conversations; vB3/4 reply chains are grouped back together (needs the messaging plugin) | Signatures, polls and custom profile fields |
| Birthday, homepage and avatars (from the database, or with `--files`) | |
| Thread tags, and subscriptions for the threads that came over | |
| Bans and infractions (as warnings) still in force, under the moderator who issued them | |
| Visitor messages, onto the member's profile wall | |

Accounts that match an existing Xentium user by email are merged into that user, and
we recount every like and follower total. The migration report lists everything we
skipped and why.

Posts and messages arrive in exactly the shape our editor saves, so they look like
posts written on Xentium and editing one changes nothing. Images from other sites
become links, because the editor keeps no outside images in posts.

## How to switch

1. **Install Xentium** on your server, finish the installer, then install and enable the
   forum plugin ([Installing Xentium on a server](/admin/installing/)).
2. **Close the forum** while you move, so nothing is posted in between.
3. **Check your database's character set.** Old boards on a latin1 database can show
   broken accents; convert it to utf8mb4 first if yours does.
4. **Do a dry run.** It reads, converts and reports, and writes nothing:
   ```bash
   pnpm --filter @xentium/migrate-vbulletin migrate -- \
     --source-db "mysql://user:pass@host:3306/vbulletin" \
     --db "postgresql://…" --dry-run
   ```
   Add `--prefix vb_` (or whatever yours is) if your tables have a prefix. For avatars
   stored as files, add `--files <your vBulletin folder> --uploads <Xentium's upload folder>`.
5. **Read the report**, then run it for real (the same command without `--dry-run`).
   Watch it under ACP → System → Migration History. An interrupted run continues where
   it stopped instead of creating duplicates.
6. **Keep the old attachments reachable** if you want to point members to them.
7. **Keep your old links working:** add `--redirects <folder>` to the real run and put
   the nginx file it writes into your web server. `showthread.php`, `showpost.php`,
   `forumdisplay.php` and `member.php` links, vBulletin 4's friendly URLs and vBulletin
   5/6 topic and channel addresses then go to their new pages.

The full reference is [Migrating from another platform](/guides/migrating/).

## Sources

- What `@xentium/migrate-vbulletin` imports: [Migrating from another platform](/guides/migrating/)
- vBulletin 6 features: [vbulletin.com/overview](https://www.vbulletin.com/overview)
- vBulletin 6 launch and licences: [vBulletin 6.0.0 announcement](https://forum.vbulletin.com/forum/vbulletin-announcements/vbulletin-announcements_aa/4484057-announcing-the-launch-of-vbulletin-6-0-0), [vbulletin.com/en/purchases](https://www.vbulletin.com/en/purchases)

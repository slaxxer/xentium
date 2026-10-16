---
title: Switching from WoltLab Suite
description: What you gain and what you give up when you move from WoltLab Suite to Xentium, what our migration tool brings over, and how the switch works.
sidebar:
  order: 5
---

WoltLab Suite is a complete package: forum, blog, calendar, gallery, file base and a
database app, from one vendor, with a hosted cloud version and a strong focus on data
protection. If you use several of those apps, WoltLab covers more than Xentium does
today. If your site is mostly the forum and articles, our migration tool moves both.

Checked on 15 October 2026. See [Xentium compared](/switch/compare/) for the full matrix.

## What you gain

- **An open-source core under MIT.** WoltLab Suite Core is open source too (LGPL), but
  the apps that make up most installs (forum, blog, gallery and so on) are proprietary
  and sold per app.
- **Whole pages by drag and drop.** Theme Studio's layout editor arranges every page,
  the header and the footer in a live preview, beyond placing boxes.
- **Themes that are data.** A Xentium theme ships colours, fonts and layouts, never code.
- **Sign-in built in:** passkeys, sign-in links by email, and Google, GitHub and Discord.
- **Moderation with review cases** and abuse detection that opens a case for a human.
- **Your data stays on your server.** Xentium is self-hosted only. Its update check is
  anonymous: it sends the version you run and nothing else.
- **Members keep their passwords,** including the older formats from before WoltLab
  Suite 5.4.

## What you give up

- **Part of the app suite.** Xentium has articles, a forum and a file library, but no
  separate blog, no calendar, no gallery and no database app yet.
- **A hosted plan.** WoltLab offers a cloud with all apps included. Xentium has none.
- **Shared hosting.** WoltLab runs on PHP and MySQL. Xentium needs a server with
  Node.js, PostgreSQL and Redis.
- **Maturity and a company behind support.** WoltLab has been building forum software
  since the early 2000s. Xentium is an alpha from a small team.
- **Authenticator-app two-factor.** WoltLab has it; Xentium has passkeys but no app codes
  yet.

## What our migration tool moves over

`@xentium/migrate-woltlab` connects directly to your WoltLab **MySQL database**: WoltLab
Suite 5 and 6, with or without Burning Board, and Burning Board 4. The Xentium forum
plugin has to be installed and enabled first; we check before anything runs.

| Moves over | Doesn't move over |
|---|---|
| Members with their passwords and join dates | Conversation drafts that were never sent |
| Staff: groups that can use the admin panel become Administrator, groups that can moderate become Moderator | Attachments (a marker shows where one was) |
| Last visits (shown as "Last seen"), and smiley codes as emoji | |
| Your other member groups, by name and with their members (you set what they may do) | Group permissions |
| Articles with their categories (one language: the untranslated version, else your default language) | The gallery, calendar, file base, blog and database apps |
| Boards and categories, with multilingual titles in your default language | Comments on other content (gallery, file base, …) |
| Threads, including closed, sticky and announcement (as pinned) | Posts and threads by guests (posts on Xentium need an account) |
| Posts in WoltLab's HTML or Burning Board 4's BBCode, quotes and media links included | Deleted, moved and unapproved threads and posts |
| Reactions on posts as likes, follows 1:1, ignores as blocks | Trophies and styles |
| Thread labels as thread prefixes, with their colour and boards (one per thread: the first label group's) | |
| Conversations, with who hid or left them (needs the messaging plugin) | Signatures, polls and custom profile fields |
| Birthday, homepage and avatars (with `--files`, both the 6.0 and 6.1 layouts) | |
| Thread tags, and watched threads that came over | |
| Bans still in force | Warnings (WoltLab's warning system isn't public, so we can't read it reliably) |
| Profile wall comments and their replies; comments on the articles that came over | |

Members whose password WoltLab kept from an earlier migration of its own (a phpBB hash,
for example) reset it once. The migration report lists everything we skipped and why.

Posts and messages arrive in exactly the shape our editor saves, so they look like
posts written on Xentium and editing one changes nothing. Images from other sites
become links, because the editor keeps no outside images in posts.

## How to switch

1. **Install Xentium** on your server, finish the installer, then install and enable the
   forum plugin ([Installing Xentium on a server](/admin/installing/)).
2. **Close the site** while you move, so nothing is posted in between.
3. **Do a dry run.** It reads, converts and reports, and writes nothing:
   ```bash
   pnpm --filter @xentium/migrate-woltlab migrate -- \
     --source-db "mysql://user:pass@host:3306/woltlab" \
     --db "postgresql://…" --dry-run
   ```
   If your tables start with `wcf2_` instead of `wcf1_`, add `--prefix 2`. For avatars,
   add `--files <your WoltLab Suite folder> --uploads <Xentium's upload folder>`.
4. **Read the report**, then run it for real (the same command without `--dry-run`).
   Watch it under ACP → System → Migration History. An interrupted run continues where
   it stopped instead of creating duplicates.
5. **Keep the old attachments reachable** if you want to point members to them.
6. **Keep your old links working:** add `--redirects <folder>` to the real run and put
   the nginx file it writes into your web server. Thread, post, board, article and
   member links then go to their new pages, in every WoltLab URL style.

The full reference is [Migrating from another platform](/guides/migrating/).

## Sources

- What `@xentium/migrate-woltlab` imports: [Migrating from another platform](/guides/migrating/)
- WoltLab apps, pricing and cloud plans: [woltlab.com/en/pricing](https://www.woltlab.com/en/pricing/)
- WoltLab Suite Core licence and source (LGPL): [github.com/WoltLab/WCF](https://github.com/WoltLab/WCF)
- Xentium's update check: [Updating Xentium](/admin/updating/)

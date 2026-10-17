---
title: Moderation
description: Warnings and bans from templates, how long they last, who may change that, and how warnings add up.
sidebar:
  order: 6
---

Everything moderators and admins need for keeping a community in order lives under
**ACP → Moderation**: Review cases, Templates, the Mod log and Mod settings. Moderators work
from ModCanvas on the site itself: they open a report or a piece of content and act on it there.

## Warnings and bans come from templates

A moderator never writes a warning or a ban message by hand. They pick a template, and the
member receives that template's text, filled in with their name, the kind of content
(a post, a comment, an article) and where it is. The same offence reads the same whoever is
on duty, and every warning points to a rule you wrote.

This holds wherever someone warns or bans: in ModCanvas, in the warn dialog on an article or
a forum post, and through the API. A request with a hand-written reason is refused. The one
exception is the ban button in **ACP → Members**, which stays a free tool for admins.

If a moderator finds no template that fits, that is the moment to add one, not to improvise.

## Templates

**ACP → Moderation → Templates** shows one column per action (warn, ban, remove, dismiss)
and one card per template. Open a card to edit it; **+ Add** under a column starts a new one
of that kind.

Each template has:

- **A message**, with `{user}`, `{type}` and `{where}` filled in when it is sent. Ban texts
  can also use `{duration}`. A preview shows what the member will read.
- **How long it lasts.** A warning counts for 7, 30, 90 or 180 days, a year, or never
  expires; new warning templates start at 90 days. A ban lasts 1 hour, 24 hours, 7 days,
  30 days, or for good.
- **A rule reference** (optional), and **words** that make ModCanvas suggest the template
  when a report mentions them.

Xentium ships a starter set. Until you edit one of those texts, it appears in your site's
language, so a German site sends German warnings. Once you edit it, it is your text and
stays as you wrote it. **Restore defaults** brings back any shipped template you deleted and
leaves your edited ones alone.

There is no site-wide setting for how long warnings count: each template decides.

## Team leads may change the length

Two permissions let someone pick another length when they issue a warning or a ban:
**Change how long a warning counts** and **Change how long a ban lasts**. Administrators and
Supermods have them by default, Moderators do not. Change that under
**ACP → Members → Permissions**. Everyone else issues the template's length.

## How warnings add up

**ACP → Moderation → Mod settings → Warnings** holds the escalation ladder: at a number of
active warnings, a member is banned for a while or for good, and moderators can be notified.
Each step fires once, when a member reaches it. A warning stops counting when it expires, so
a member who behaves works their way back down.

Members see their own warnings, and when each one stops counting, on their profile.

## Review cases

Some patterns are worth a human look: several accounts on one device, a burst of sign-ups,
repeated failed logins, signs of ban evasion. Xentium opens a **review case** for them under
**ACP → Moderation → Review cases**, seven to a page. You decide what happens: dismiss it,
make an exception, or ban the accounts involved. Which patterns open cases is set under
**Mod settings → Detection**.

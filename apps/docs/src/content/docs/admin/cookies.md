---
title: Cookies and consent
description: What Xentium stores on a visitor's device, why it needs no cookie dialog on its own, and when you do need one.
sidebar:
  order: 7
---

Xentium shows no cookie dialog of its own. Everything core stores is needed for the site to
work, and that kind of storage needs no consent. If your site adds anything optional, you
install a consent plugin, and that plugin shows the dialog.

This page explains what core stores and when you need more. It is not legal advice: what
your site needs depends on what you run on it and where you are.

## What core stores

| Name | Kind | What it is for | How long |
|---|---|---|---|
| `xt_rt` | Cookie | Keeps a member signed in | 30 days, or until the browser closes |
| `xt_did` | Cookie | Recognises a device at sign-in, to protect the account | 1 year |
| `xt_oauth` | Cookie | Completes a sign-in with an external account | 10 minutes |
| `xt_locale` | Cookie | Remembers the language a visitor picked | 1 year |
| `xt_theme`, `xt_cw` | Cookie | Remember the theme and colour variant a visitor picked | 1 year |
| `xentium.*` | Browser storage | Drafts and display settings on this device | Until cleared |

All of these are set by your own site, and only when they are needed: the sign-in cookies
when someone signs in, the language and theme cookies when a visitor picks one.

## What waits for consent

- **A Font Awesome kit.** If you configured one, it is loaded from Font Awesome's servers,
  which sends the visitor's IP address there. It counts as external media and loads only
  once a visitor agrees. Without a consent plugin it never loads, and your site uses its
  built-in icons.
- **Anything a plugin marks as optional.** Plugins declare what they store and load, and
  ask before anything optional runs.

## When you need a consent plugin

Install one from the store when your site uses something optional: analytics, embedded
videos or maps, advertising, an icon kit, or a script you added yourself. A consent plugin:

- shows the dialog, with "Accept all" and "Reject all" given the same weight,
- lists every cookie and service by category, built from what core and your plugins
  actually declare, so the list never goes stale,
- adds a cookie policy page and a "Cookie settings" link in your footer,
- can keep an anonymous record of each choice.

Your privacy policy itself is a legal document you write under **ACP → Content → Legal**.

## For plugin developers

How to declare what your plugin stores, check for consent before it runs, and wrap embeds in
a placeholder: see [Cookies and consent for plugins](/plugins/consent/).

# Security policy
Thanks for taking the time to look. If you think you've found a security problem in
Xentium, please tell us privately first, so we can fix it before anyone can use it
against a running site.

## Reporting a vulnerability

Use GitHub's private reporting: open the repository's **Security** tab and choose
**Report a vulnerability**. Only you and the maintainers can see the report.

Please don't open a public issue, pull request or discussion for a security problem.

A good report tells us:

- what an attacker can do, and what they need first (a guest, a member, an admin)
- the version you tested (`xentium --version`, or the footer of the ACP)
- the steps to reproduce it, ideally against a fresh install
- anything you already know about a fix

## What happens next

- We confirm we've got your report within a few days.
- We tell you whether we can reproduce it and how we plan to fix it.
- We fix it, publish a release, and tell installed sites through the ACP update notice.
- When the fix is out, we publish an advisory and credit you, unless you'd rather we didn't.

## Supported versions

We fix security problems in the **newest release only**. An older release does not
get security fixes, so please update before reporting, and keep your site on the
latest version.

## Keeping your site safe

Because only the newest release gets fixes, updating is part of running a site:

- **Update when we announce a release.** The ACP shows every new release, and a
  security release is marked as one. **Update now** in the ACP, or
  `npx xentium update` on the server, does the whole update.
- **Every update takes a database backup first** (into `shared/backups`), and puts it
  back by itself if the update fails. You can also take one at any time with
  `npx xentium backup`.
- **You can go back.** `npx xentium rollback`, or **Roll back** in
  **System → Migration History**, returns to the release an update replaced.
- **Keep your own backups too**, off the server: the database dumps in
  `shared/backups` and your uploads in `shared/uploads`. A backup you have never
  restored is a guess, so try one now and then on a spare database.

## Plugins and what they can do

A plugin is code that runs inside your site with the same rights as Xentium itself,
including full access to its database. When you install a plugin, you trust its
author with your site.

What we check: plugin packages from plugins.xentium.org are signed, and a plugin's
database migrations may only create and change the plugin's own tables, which stops a
broken migration from damaging your site's data. These checks do not make a
malicious plugin safe, and they don't look inside the code a plugin runs. Install
plugins only from authors you trust.

## In scope

- the core server, the web app and the installer (this repository)
- the npm packages built from it: `@xentium/server`, `create-xentium` and the `xentium` CLI
- the official plugins published on plugins.xentium.org

Third-party plugins and themes belong to their authors. Please report those to them.
A problem in a dependency is in scope when it can be reached through Xentium.

## Please don't

- test against sites you don't own, including app.xentium.org and plugins.xentium.org
- run denial-of-service tests, spam, or social engineering
- access, change or keep other people's data beyond what you need to show the problem

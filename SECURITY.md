# Security policy
alr
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

Xentium is in alpha. We fix security problems in the **newest release only**, so
please update before reporting, and keep your site on the latest version.

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

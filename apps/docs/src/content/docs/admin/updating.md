---
title: Updating Xentium
description: How your site learns there is a new version, what the urgency means, and how to install it.
sidebar:
  order: 2
---

Your site checks for new Xentium releases on its own and tells you in the ACP. Installing one
is a single command on the server.

## How your site finds out

Once a day, and again whenever the worker process restarts, your site asks us what core
releases exist. The question is anonymous: it sends the version you are running and nothing
else. No site id, no account, no list of your plugins, and it works the same whether or not
you have connected a marketplace account.

If we can't be reached, the site keeps the answer it already had and carries on. A site that
is behind on updates keeps running.

You can turn the check off in **ACP → System → Scheduled Tasks** by disabling the
**Marketplace sync** job. Nothing will check for updates after that, including when the
worker restarts, so you are then responsible for watching releases yourself.

## What you see

**Extensions → Updates** gets a card at the top for Xentium itself, above your plugin
updates. It shows the version you are on, the version available, how many releases you are
behind, and what changed.

**The gear badge** in the navbar counts a waiting core update the same way it counts plugin
updates, so it stays visible until you deal with it.

**A dialog when you enter the ACP**, once per admin. It carries everything you need to
decide: the version you are on and the one available, when it was released, how many
releases you are behind, anything to watch out for (a security fix on the way, a plugin that
doesn't support the new version yet, manual steps), the full changelog of every release in
between, and the commands that install it, ready to copy.

**Got it** counts as read, and so does opening the Updates page. **Later** doesn't: the
dialog comes back the next time you enter the ACP. Each admin gets their own, and a new
release brings it back. So does a release we later mark as a security fix, even if you had
already seen it.

One deliberate exception: a patch on the version line you are already running never opens the
dialog. Those are the most common releases there are, the card and the badge already say so,
and a dialog you meet every week is a dialog you stop reading. Prereleases (alphas and betas)
always open it, because each one is a version we want tested.

## How urgent is it

Every release carries an urgency:

| | What it means |
|---|---|
| **update** | new features or fixes. Install it when it suits you. |
| **security** | it fixes a vulnerability. Install it soon. |
| **critical** | install it now. |

The urgency you see covers **every release between yours and the newest one**, not just the
newest. If you are on 1.0.0 and 1.2.0 is out, and 1.0.1 in between fixed a vulnerability, you
are told about the security fix even though the newest release is an ordinary feature release.
The card names the release the urgency comes from and quotes its notes, so you can see what
you are actually being warned about.

Some releases can't be installed directly from very old versions. When that is the case, the
card names the version to install first.

## Your plugins come first

Every plugin says which Xentium versions it supports. If the new release is outside that
window for something you have installed, we name those plugins and tell you to update them
first. Updating anyway is possible, but those plugins will refuse to load until they catch up.

## Installing the update

Updates are applied on the server, not from the ACP. The web process is never allowed to
replace the code it is running, so there is no button that does this.

```bash
cd /srv/xentium
npm install xentium@1.1.2
npx xentium update 1.1.2
```

That is what the dialog and the card show you, with your site's directory and the version
they are offering filled in. The first line updates the `xentium` command itself, because
fixes to the updater ship in it. Naming the version matters for prereleases: without one,
`xentium update` installs what npm calls the newest stable release. You don't need `sudo`;
the command asks for it when it restarts your site's services.

In order, `xentium update`:

1. finds the release, and refuses if a plugin doesn't support it
2. installs it **next to** the one that is running, so nothing has changed yet
3. dumps the database into `shared/backups/`
4. stops the site, applies any new migrations, points `current` at the new release, starts it
5. waits up to a minute for the site to answer

If the site doesn't come back, it puts `current` back, restarts the old release, and restores
the dump if a migration had already run. Your `shared/` directory, with your config, uploads
and backups, is never touched by an update.

If the site isn't run by systemd, the update stops after the swap and tells you to restart it
yourself.

Useful flags:

```bash
npx xentium update               # the newest stable release
npx xentium update --dry-run     # install the release but don't switch to it
npx xentium update --package ./xentium-server-1.1.2.tgz   # from a tarball, no registry
npx xentium update --skip-backup                          # when pg_dump isn't installed
npx xentium update --force       # past a plugin that says it doesn't support the version
```

Without `--skip-backup`, an update refuses to start when `pg_dump` is missing, because there
would be nothing to roll back to. Installing the PostgreSQL client tools is the better fix.

## Going back

```bash
npx xentium rollback             # back to the release you were on
npx xentium rollback 1.1.0       # back to a specific one you still have
```

A rollback is the same swap the other way, which is why releases are kept as separate
directories. It does not restore the database on its own: if the update you are undoing
applied migrations, restore the dump from `shared/backups/` as well.

## Plugins and themes

Plugin and theme updates are listed on the same **Extensions → Updates** page and install from
the ACP, since they are content rather than the app itself. They are on their own versions and
their own schedule; a core update never updates them for you.

## Checking the install

```bash
npx xentium status     # version, processes, whether it answers
npx xentium doctor     # the machine and this install, with fixes for anything it doesn't like
```

Under systemd, the logs are in `journalctl -u xentium-api -n 50` and
`journalctl -u xentium-worker -n 50`.

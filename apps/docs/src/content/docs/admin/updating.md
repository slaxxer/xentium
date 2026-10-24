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

A new Xentium release is announced **once, in a dialog when you enter the ACP**. It carries
everything you need to decide: the version you are on and the one available, when it was
released, how many releases you are behind, anything to watch out for (a security fix on the
way, a plugin that doesn't support the new version yet, manual steps), the full changelog of
every release in between, and the commands that install it, ready to copy.

If plugin updates are waiting too, they are listed at the bottom of the same dialog, so you
meet one dialog about updates rather than two in a row. **View plugin updates** takes you to
**Extensions → Updates**, which lists plugin updates only.

The dialog is one-time: however you close it, it is gone for you, and each admin sees it once.
Copy the command before you close it, or find it again in [Installing the update](#installing-the-update)
below. The next release brings a new dialog, and so does a release we later mark as a security
fix, even if you had already seen it as an ordinary one. A core release doesn't appear on the
Updates page.

**The gear icon in your site's navbar** gets a red dot, for admins only, while anything in the
ACP needs you: a waiting Xentium release, a plugin update, or your licence. There is no count;
the dot tells you to look. A waiting release keeps it lit until your site runs the new version.

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
The dialog names the release the urgency comes from, and its notes are in the changelog, so
you can see what you are actually being warned about.

Some releases can't be installed directly from very old versions. When that is the case, the
dialog names the version to install first, and its command installs that one.

## Your plugins come first

Every plugin says which Xentium versions it supports. If the new release is outside that
window for something you have installed, we name those plugins and tell you to update them
first. Updating anyway is possible, but those plugins will refuse to load until they catch up.

## Installing the update

You can update from the ACP with one click, or run the same update yourself on the server.
Either way it is the `xentium` command that does the work, on the server.

### From the ACP

The update dialog has an **Update now** button, and so does **ACP → System → Migration
History** while an update is on offer. You confirm with your password, and the dialog then
shows the update as it happens: each package as it downloads, every step, each database
migration, and the restart. You can close it at any time; the update carries on, and
Migration History shows the same view, live, to every admin with the permission.

It needs two things:

- **The updater on your server.** Run this once in your site's directory (a site installed
  before this feature has to run it once more):

  ```bash
  npx xentium install-service
  ```

  Besides the site's own services it installs `xentium-updater.path`, which waits for an
  update request, the `xentium-updater` job that runs it as your site's user, and a sudoers
  rule that lets that user start and stop exactly your site's two services.
- **The "Update Xentium from the ACP" permission** (ACP → Members → Permissions, under
  System). Administrators have it on a new site.

The ACP never runs anything itself. **Update now** only writes a request into
`shared/run/`, and the updater picks it up. The updater accepts nothing but a newer
Xentium release whose npm provenance proves we built it, so a site that was broken into
can't be made to install something else this way.

If an update fails, it is undone by itself: the backup is restored and the previous release
runs again. Migration History then shows the update as rolled back, with the error and the
log. After an update that went through, **Roll back** there switches back to the previous
release (the database stays as it is; see [Going back](#going-back)).

### On the server

```bash
cd /srv/xentium
npm install xentium@1.1.2
npx xentium update 1.1.2
```

That is what the dialog shows you, with your site's directory and the version
on offer filled in. The first line updates the `xentium` command itself, because
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

## Keeping Node up to date

Xentium runs on Node.js, and Node's own security fixes matter as much as ours. `xentium update`
doesn't update Node: your system's package manager does. Run Node 22.23.4 or 24.22.1 or newer;
older releases have a bug that can run code on your server (CVE-2026-111497). `npx xentium doctor`
warns when yours is older and names the version to update to.

How depends on where your Node came from. From NodeSource's packages on Debian or Ubuntu:

```bash
sudo apt-get update
sudo apt-get install --only-upgrade nodejs
node -v
```

With nvm, `nvm install 24` gets the newest Node 24. A distribution's own `nodejs` package often
lags behind; if it has no fixed version yet, switch to NodeSource or nvm.

Then restart your site's services so they run on the new Node. With the services `xentium update`
set up:

```bash
sudo systemctl restart xentium-api xentium-worker
```

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

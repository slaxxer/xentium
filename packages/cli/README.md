# xentium

The command line tool for a [Xentium](https://doc.xentium.org) site: start it, update it, check it, back it up.

You get it automatically when you install a site:

```bash
npm create xentium@latest my-community
```

Inside the site directory, `npx xentium <command>` runs it.

## Commands

| | |
|---|---|
| `xentium start` | start the site — the systemd units if they're installed, otherwise in this terminal |
| `xentium stop` | stop it |
| `xentium restart` | both |
| `xentium status` | version, processes, whether it answers |
| `xentium doctor` | check the machine and this install, with the fix for anything that's wrong |
| `xentium backup` | dump the database into `shared/backups` |
| `xentium update [version]` | install a release, migrate, switch over — and switch back if it doesn't come up |
| `xentium rollback [version]` | go back to the release you were on |
| `xentium install-service` | write the systemd units (asks for sudo) |

Useful flags: `--site <dir>` to act on a site you're not standing in, `--json` for `status`
and `doctor`, `--dry-run` to install a release without switching to it, and `--package <tgz>`
to update from a tarball instead of the registry.

## What a site looks like

```
my-community/
  xentium.json        version, port, address
  releases/<v>/       one directory per installed release
  current -> releases/<v>
  shared/.env         config and secrets — an update never touches it
  shared/uploads/     avatars, attachments, installed plugins
  shared/backups/     the dump taken before each update
```

An update installs the new release next to the running one, backs the database up, migrates,
and moves the `current` symlink. If the site doesn't answer afterwards, it moves the symlink
back, restarts, and restores the dump if a migration had already run.

## Updating safely

`xentium update` refuses to run when an installed plugin declares that it doesn't support the
new version, unless you pass `--force`. It also refuses to go backwards — that's what
`xentium rollback` is for.

Docs: https://doc.xentium.org

# Changelog

## Hardening: production is the default environment

- **An instance that never sets `NODE_ENV` now runs as `production`** — strict rate
  limits, hidden error details, no dev auth backdoor, and real licensing domain rules.
  Development is an explicit opt-in: `./nodevo.sh` exports it for the dev workflow, or set
  `NODE_ENV=development` in `.env`. Deployments need no configuration to be hardened.

## Errors: explicit NEC codes for every known failure

Known, user-actionable failures no longer surface as the generic `NEC-API-5000` fatal
screen — they return their own code, a 4xx status, and the real message (which the ACP
shows inline and the Error Log records at the correct severity):

- **Plugin engine**: `NEC-PLUGIN-2002` invalid package (bad ZIP / unsafe path / broken
  manifest.json), `NEC-PLUGIN-2003` already installed, `NEC-PLUGIN-2011` missing
  up/down migration file, `NEC-PLUGIN-2012` migration checksum mismatch; DDL-only
  violations keep `NEC-PLUGIN-2010`; manifest schema failures keep `NEC-PLUGIN-2001`
  (and are no longer flattened into uncoded errors). Enabling an unlicensed plugin now
  answers `402 NEC-LICENSE-9001` with the "activate a license" message instead of a 500.
- **License engine**: `NEC-LICENSE-9008` a license is already active,
  `NEC-LICENSE-9009` the license server refused (message carries the exact reason);
  network failures map to `NEC-LICENSE-9007` (unreachable) instead of a 500.
- **Appearance**: invalid `.nvstyle` uploads answer `NEC-CORE-8002` naming the file/rule.
- `NEC-API-4009` (Conflict) added to the catalog — it was already emitted but documented
  nowhere.
- **Error Reference** (ACP → System → Error Reference) documents every new code with
  cause and fix.

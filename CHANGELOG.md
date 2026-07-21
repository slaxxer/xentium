# Changelog

## Log retention + durable dialog acknowledgments

- **New scheduled job: Log retention** (ACP → System → Scheduled Tasks, daily by
  default) — prunes the three previously unbounded log tables: activity log
  (separate windows for page-visit telemetry vs. the ACP-action audit trail),
  error log, and login events. Windows are the `retention.*` settings in days
  (`activity_page_visit_days` 30, `activity_action_days` 180, `error_log_days`
  90, `login_events_days` 180); `0` keeps a table forever. Login-event retention
  stays far above the security scanners' correlation windows.
- **Dialog acknowledgments moved out of the activity log** — the per-admin
  ACP-entry dialogs (pending updates, license expiry) previously derived their
  "has this admin actually visited the page?" state from `page_visit` telemetry
  rows, which meant pruning the log would silently un-acknowledge dialogs. A new
  bounded `ncf_acp_visits` table (one row per user+path, upserted on each ACP
  navigation) now holds that state durably; `hasVisitedSince` is an O(1) primary
  key lookup instead of a log scan. The migration backfills existing marks from
  the activity log so already-earned acknowledgments survive the switch.
- Verified end-to-end: visit marks acknowledge/reject anchors correctly, all
  four retention windows prune exactly their cutoffs, the 0-window escape hatch
  holds, and — the invariant that motivated the redesign — acknowledgments
  survive page-visit pruning.

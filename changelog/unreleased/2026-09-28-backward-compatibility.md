# Deploy runs and stage states tables

- **Date:** 2026-09-28
- **Type:** refactor
- **Scope:** `server`

Migration 23 (`activity-deploy-runs`) added the `activity_deploy_runs` and
`activity_deploy_stages` tables for the [module release](2026-09-28-activity-deploy-module-release.md).
It rewrote no existing row.

## Compatibility

Migration 23 is swap-safe: a pushed platform applies it without a restart, and an older build
neither reads nor writes the new tables. Rolling it back drops both tables and loses only the
deploy history and the stage states; the log files under `PENGUIN_HOME/activity-deploy/logs`
stay on disk, unread.

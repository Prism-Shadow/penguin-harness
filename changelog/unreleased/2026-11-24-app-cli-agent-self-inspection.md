# Agent app self-inspection: per-Session credentials, read-only `app info`, and orchestration Skill

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `server`, `cli`, `plugins/agent-development`

[中文版](2026-11-24-app-cli-agent-self-inspection.zh.md)

Agents running inside any user's Project — including Projects that the built-in `admin` account
cannot open — can now self-inspect their apps and app-created sessions through the `penguin` CLI
without triggering builds or crossing Project boundaries:

- **Per-Session scoped Bearer tokens**: `controlEnv` now injects an HMAC-signed per-Session token
  (`psess_<sessionId>.<mac>`) instead of the boot's raw admin API token. The server verifies it
  against the live Session row and grants member-level access confined strictly to that Session's
  Project — rejecting cross-Project access (`404`), owner-only writes (`403 owner_required`),
  admin routes, remote browser session exchange, and user-table writes.
- **Read-only `app info` and explicit serving/build state**: Added
  `GET /api/projects/:p/agents/:a/workbenches/:id/status` (`Workbenches.inspect`), which reads
  switches, live serving state (`serving`, `servingRevision`), latest build status (`not_loaded`,
  `building`, `ready`, `failed`), and error diagnostics without compiling, loading, or creating
  versions. `penguin app info` uses this endpoint; `penguin app history` passes `?requireExists=1`
  to distinguish missing apps (`404`) from existing apps with no versions yet; `penguin app enable`
  reports both switch persistence and load failure (exiting `1`) when enabling triggers a failed
  load.
- **Corrupt `package.json` diagnostics**: Workbenches whose `package.json` parses to `null` or a
  non-object no longer throw `TypeError` in `readFolder` / `readManifests` and are reported in
  `app-center?all=1` and `status` with `build: "failed"` and a readable error message.
- **Subagent `PENGUIN_APP_ID` survival and canonical `--app` filtering**: `registerChildSession`
  persists the root Session's `appId` onto the child's SQLite row so resuming a subagent directly
  after a server restart still injects `PENGUIN_APP_ID`. `penguin session ls --app` now requires
  the canonical `<agentId>/<workbenchId>` key so `--agent-id` strictly filters the executing
  Agent without dropping cross-agent sessions.
- **Skill & CLI startup cleanup**: Updated `penguin-orchestration` (`@penguinharness/agent-development`
  `0.2.19`) with app self-inspection commands, `PENGUIN_AGENT_ID` vs `PENGUIN_APP_ID` guidance,
  and status field semantics, and removed the CLI's static `isomorphic-git` import chain from
  `app-id.ts`.

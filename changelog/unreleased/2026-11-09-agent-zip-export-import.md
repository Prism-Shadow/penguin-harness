# An Agent travels as a zip of its directory

- **Date:** 2026-11-09
- **Type:** feature
- **Scope:** `server`, `cli`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)
- **Breaking:** yes — `GET`/`POST …/agents/:agentId/export|import` and the create request's `dataBase64` are removed

[中文版](2026-11-09-agent-zip-export-import.zh.md)

An Agent was exported and imported as a zip of its directory on disk: `<agentId>/agent_state/…` and, for the chosen Sessions, `<agentId>/traces/<date>/<session>_<NNN>.jsonl`. The import reused the snapshot import's validation, backup and swap; only the unpack step was added.

## Server

- `GET /api/projects/:projectId/agents/:agentId/archive` (any member) answered `<agentId>-<yyyymmdd>.zip`. Its query took `skills`, `hooks`, `memory`, `workbenches`, `workbenchData` and `schedules` as `0` or `1` (all `1` but `schedules`), and `traces` as `none`, `last:<N>` (1–500 by last activity, a subagent Session with its parent) or a range of date folders. It left out what a snapshot leaves out, replaced a vault value of 8 characters or more in a Trace with `[vault:<KEY>]`, and answered 413 `archive_too_large` past the import's caps.
- `POST /api/projects/:projectId/agents/import?agentId=<id>&overwrite=1` took the raw file, under a body cap of its own of 64MB. The zip was unpacked into the layout a tar.gz snapshot extracts to, refusing links, entries outside its folder, control characters and names that differ only in letter case, with the caps read off the central directory. A free id created the Agent (any member); a taken one answered 409 `agent_exists` with `details.agentId`, and `overwrite=1` (owner only) replaced the State after a backup snapshot, keeping the vault, the Sessions and the API keys. The answer was 201 `{agent, mode, version, backup?, sessions: {imported, skipped}}`.
- A `system_config.yaml` without `system_prompt` was laid over the template's config and checked as a config write.
- The Trace import was generalised to a Session's set of files: each landed in its date folder under its own index and was registered once; a Session id the install already had was skipped and reported.
- The snapshot import lost its version confirmation (409 `version_conflict`), and the create route its snapshot seed.

## CLI

- `penguin agent export <agent-id>` and `penguin agent import <file|directory>` were added. A directory is zipped under its own name with the zipper `penguin plugin install <dir>` uses, which moved to `zip-folder.ts`.

## Docs

- The Server API, Agents, Self-Improvement and CLI pages describe the archive and import routes and the two commands.

## Compatibility

- A client of `GET …/agents/:agentId/export`, `POST …/agents/:agentId/import` or `POST …/agents` with `dataBase64` switches to `GET …/agents/:agentId/archive` and `POST …/agents/import`, sending the file as the body.
- `.tar.gz` snapshot packages exported before still import; see [backward compatibility](2026-11-09-backward-compatibility.md).

# Agents export to a zip and import from one

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `server`, `trace-index`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)
- **Breaking:** yes — `GET …/agents/:agentId/export`, `POST …/agents/:agentId/import` and the `dataBase64` field of `POST …/agents` were removed

[中文版](2026-11-04-agent-zip-export-import.zh.md)

An Agent now leaves the server as one zip holding the parts the caller picks, and comes back from one as a new Agent or as the replacement of an existing Agent's State. The old `.tar.gz` snapshot export and its import routes were replaced.

## The zip

- One top-level directory named after the Agent, holding `manifest.json` (`format: "penguin-agent-zip/1"`), `agent_state/` laid out as on disk, and, when Sessions are selected, `traces/<date>/<sessionId>_NNN.jsonl` with `traces/sessions.json`.
- The config always travels: `system_config.yaml`, `AGENTS.md` and `tools/`. Skills, hooks, memory, workbenches (with or without their `state.json`) and schedules are each selectable; schedules are off by default.
- A literal MCP `env` or `headers` credential is blanked and named in `manifest.redacted`; a value written as `${KEY}` vault references travels unchanged. The vault never travels, only its key names (`manifest.vaultKeys`). A workbench's `.build/`, `.harness/`, `.plugin.json` and `node_modules/`, any `.git` path, staging leftovers, expired schedules and links never travel.
- Sessions are selected as none, the last N most recently active (1–500), or a date range over the Trace date directories. Each travels whole, with its subagent children under the same Agent and the facts the sessions table holds for it. A Session with a file over 256 MiB is left out and reported.

## Routes

- `GET /api/projects/:p/agents/:a/archive?<parts>` streams the zip (`<agentId>-<yyyymmdd>.zip`); `GET …/archive/preview?<parts>` reports what it would hold. Any member may call both.
- `POST /api/projects/:p/agents/import?agentId=&overwrite=1` takes the zip, or an old `.tar.gz` package, as a raw `application/octet-stream` body and answers 201 with the Agent's card, what was imported, the Sessions skipped, what to fill and notes. A taken id is 409 `agent_exists` with `details.agentId`; `overwrite=1` is the Project owner's.
- Caps: 100 MiB uploaded, 50,000 entries, 256 MiB per entry and 1 GiB inflated, read from the central directory before anything is inflated and counted again on the bytes written (413 `archive_too_large`). Names, links, case-folded duplicates, Skills' `SKILL.md`, hook packages' `hooks.json` and workbench ids are checked before an Agent is touched; a failure after the Agent was created removes it.
- A new id creates the Agent from the template and swaps the archive's State in. A hand-written zip without `system_config.yaml` carries a `definition` (MCP servers, model settings, built-in tool names) applied through the config service.
- An overwrite writes an import backup first, keeps the Agent's identity, Sessions, vault, API keys and employments, keeps its own copy of every part the zip leaves out, of its expired schedules, of its workbenches' data when the zip has none and of anything else in its State, and fills blanked MCP values from its own config. Parts the State keeps move by rename and move back when the swap fails.
- Imported Sessions keep their title, dates, archived or kept mark, approval mode, thinking level and client. A Session id the install already knows is skipped as `exists`.

## Compatibility

- API clients of the removed routes move to `GET …/archive` and `POST …/agents/import?agentId=<id>&overwrite=1`; `POST …/agents` with `dataBase64` moves to `POST …/agents/import`. The version-conflict confirmation is gone: `overwrite=1` is the confirmation. The `penguin` CLI never called the removed routes, and the Web App changes with this release.
- Old `.tar.gz` packages still import; see [backward compatibility](2026-11-04-backward-compatibility.md).

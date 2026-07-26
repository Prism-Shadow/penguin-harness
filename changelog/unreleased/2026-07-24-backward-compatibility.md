# Backward compatibility in this batch

What this batch keeps tolerating from data and configuration already on disk, how far each allowance reaches, whether the user has to do anything, and when it could be dropped. Other entries describe the features themselves and point here.

## Legacy angle-bracket markers stay readable

System-synthesized markers moved to the paired square-bracket form (`[summary]`, `[context_summary]`, `[use_skills]`, `[handoff_from]`, `[scheduled_task]`, `[developer_instructions]`, `[turn_aborted]`, `[turn_retried]`, `[model_switch_from]`, plus the inner transcript tags). Producers emit only the new form; every parser that can meet older material accepts both. Two sources make this unavoidable: Traces written before the change, which are re-rendered and replayed on resume, and the compaction prompt persisted in each existing agent's `system_config.yaml`, which keeps instructing the model to answer in `<summary>` tags for as long as that file is untouched. `model_switch_from` is a narrower case — its angle form only ever existed in traces produced while the merged `/model` switch ran on main before the markers landed — but it rides in the same dual-form parsers.

Nothing is required of the user. Removal is indefinite: the dual parsers cannot go while old Traces are still expected to open and old agent configs are still honored verbatim, so this is major-release material, not cleanup for a later minor version.

## session_meta.thinking_level is still read on resume

The thinking level became a per-request parameter and is no longer written into `session_meta`. Traces recorded earlier still carry the field, so resume reads it loosely and keeps honoring it as that session's default level — which matters most for a subagent session that inherited a level from its parent and would otherwise come back at its own agent's configured level. The legacy literal `"default"` and a missing field both fall back to the agent config, as before; rebuilt metas never write the field again, and the Traces view still renders the row when a legacy meta carries it.

Nothing is required of the user. This one is cheap to keep (a single tolerant read plus the view's fallback) and could be dropped once resuming pre-change Traces is no longer supported — again a major-release decision.

## Existing agents keep their stored config verbatim

An agent's `system_config.yaml` is loaded exactly as written, with no migration and no merge against the current defaults. A pre-existing agent therefore keeps its old system prompt — including the old marker documentation and the old `Project Dir` wording the new prompt replaces with App Data Dir — and its recorded `tools.builtin` list stays frozen, so it does **not** gain `read_file` / `edit_file` / `write_file`; the settings UI adds no rows either. This is deliberate: a stored config is the user's file.

Adopting the new defaults therefore requires the user to act, in one of two ways: run **Restore default configuration** (agent settings, Overview tab; `POST /api/projects/:projectId/agents/:agentId/config/reset`), which rewrites the file to the current defaults and preserves only the agent's name, description and version — every customization, including an edited system prompt, model and compaction settings and MCP servers, is overwritten; or hand-edit the YAML to add just the wanted entries. Other Agent State files (AGENTS.md, skills, vault) are untouched either way. Nothing here is a shim with an end date — verbatim loading is the intended behavior and stays.

## A missing tools.call_description means enabled

The per-tool `call_description` flag governs whether a tool's `description` argument is offered to the model. A missing key reads as enabled, so the four command/subagent entries in configs written before the flag existed keep taking call descriptions without anyone editing anything, and an explicit `false` filters the property out of the assembled schema without ever rewriting the stored YAML. This is a defaulting rule rather than a compatibility shim; it has no removal date, and flipping the default later would need a migration.

## What this batch does not add

The separate-origin HTML preview, the OpenRouter catalog rows and the dev data root carry no compatibility handling for stored data. Two consequences are worth knowing anyway, neither of them a tolerated old shape:

- New catalog rows reach new Projects automatically, because the preset list is written when a Project's `.project_config.toml` is created. An existing Project does not change by itself — the user picks up the new models through **Sync presets** on the Models page or `penguin config model add` from the CLI.
- Development entry points now default `PENGUIN_HOME` to `~/.penguin/dev-data`. Data written by earlier from-source runs stays where it was, under the installed root; a developer who wants to keep working against it exports `PENGUIN_HOME` explicitly, which still wins over the default.

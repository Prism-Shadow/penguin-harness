# Trace Lookup plugin

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `plugins`, `docs`
- **PR:** [#1491](https://github.com/Prism-Shadow/penguin-harness/pull/1491)

[中文版](2026-11-12-trace-lookup-skill.zh.md)

Added the `trace-lookup` plugin (`@penguinharness/trace-lookup`, Office Productivity) with one Skill of the same name. It teaches an Agent to read its own Trace files: where a Session's files are and how they are numbered, which file a `[context_summary]` or `[model_switch_from]` block names, and how to recover an earlier detail by searching for the lines it sits on and reading only those lines, never the whole file.

## Details

- The Skill gives the search command for POSIX shells, PowerShell and cmd, and the record fragments that find user and assistant text, one tool's calls, tool outputs, compaction boundaries and failed requests.
- A `default_agent` initialized after this change gets the plugin with the rest of the library's preinstalled set, in a new Project and on a first CLI run alike. An Agent the user creates gets it only when the plugin is picked at creation.

## Compatibility

- Agents that already exist, an existing `default_agent` included, do not get the plugin automatically, and no notice asks for it. On each Agent that should have it, install it once from the **Plugins** page: **Manage installs** on the Trace Lookup card, then **Install** next to the Agent. The Skill reaches that Agent's system prompt with its next model context.
- Without the Skill, the Trace pointer in a compaction summary or a hand-off note is still a usable path to the JSONL file, one record per line.

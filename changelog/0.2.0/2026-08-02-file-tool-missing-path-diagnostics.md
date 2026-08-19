# File tools diagnose missing paths instead of implying absolute paths are rejected

- **Date:** 2026-08-02
- **Type:** fix
- **Scope:** `core`, `skills`
- **PR:** [#155](https://github.com/Prism-Shadow/penguin-harness/pull/155)
- **Issue:** [#138](https://github.com/Prism-Shadow/penguin-harness/issues/138)

[中文版](2026-08-02-file-tool-missing-path-diagnostics.zh.md)

`read_file` / `edit_file` accepted absolute paths all along, but their "File not found" message mentioned only workspace-relative resolution — so a genuinely missing file (typically a dropped `agent_state/` segment) read as "absolute paths are unsupported", and the model retried path forms instead of questioning the path ([#138](https://github.com/Prism-Shadow/penguin-harness/issues/138)).

## Details

- Both tools now state that absolute paths are supported and append a diagnostic: the deepest existing ancestor directory, the first missing segment, and the ancestor's entries ranked by name similarity to the missing one (capped at 8, directories marked with a trailing slash) — for the reported case the hint names `agent_state/` directly.
- ENOTDIR (a path segment that is a file, not a directory) gets the same diagnosis instead of a raw errno message.
- The agent-creation Skill now spells out that `AGENTS.md` lives under `agent_state/`, not at the agent directory root — the likely source of the dropped segment (skill version 7).

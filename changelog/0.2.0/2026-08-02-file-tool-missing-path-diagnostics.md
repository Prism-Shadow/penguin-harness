# File tools diagnose missing paths instead of implying absolute paths are rejected

`read_file` / `edit_file` accepted absolute paths all along, but their "File not found" message mentioned only workspace-relative resolution — so a genuinely missing file (typically a dropped `agent_state/` segment) read as "absolute paths are unsupported", and the model retried path forms instead of questioning the path (#138).

## Details

- Both tools now state that absolute paths are supported and append a diagnostic: the deepest existing ancestor directory, the first missing segment, and the ancestor's entries ranked by name similarity to the missing one (capped at 8, directories marked with a trailing slash) — for the reported case the hint names `agent_state/` directly.
- ENOTDIR (a path segment that is a file, not a directory) gets the same diagnosis instead of a raw errno message.
- The agent-creation Skill now spells out that `AGENTS.md` lives under `agent_state/`, not at the agent directory root — the likely source of the dropped segment (skill version 7).

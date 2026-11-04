# Agent State imports keep the previous State and vault when they fail

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1175](https://github.com/Prism-Shadow/penguin-harness/pull/1175)

[中文版](2026-10-16-agent-state-transfer-consistency.zh.md)

Made a failed Agent State import keep the previous State and the vault, and refused packages whose links leave `agent_state/`.

## Details

- Treated only a missing vault as absent: an import that could not read the current vault stopped before replacing the State.
- Kept both States in the import's staging directory when the new State could not be moved in and the previous one could not be moved back, and named that path in the error.
- Logged a failed cleanup of the staging directory after a committed import instead of failing the import; it still reported its version.
- Removed the `.tmp-` file a failed snapshot packing left beside the snapshots.
- Rejected a package whose `agent_state/` is not a real directory or whose symbolic links leave `agent_state/` or point at nothing; relative links inside `agent_state/` were kept.

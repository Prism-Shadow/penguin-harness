# Workbench versions use your Git identity

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#1608](https://github.com/Prism-Shadow/penguin-harness/pull/1608)

[中文版](2026-11-19-agent-state-system-git.zh.md)

The server uses Git on its PATH to save and read workbench versions. Existing versions, revisions and restores continue to work in the same bare repository. Commits use the configured Git author and committer, including environment overrides. Missing names default to `PenguinHarness` and missing email addresses to `penguin@localhost` for that commit. Your Git configuration stays as you set it.

If Git is unavailable, the workbench can still run. The server log explains why its version could not be recorded.

# Ask before coding in an outdated Git checkout

- **Date:** 2026-11-25
- **Type:** feature
- **Scope:** `core`
- **PR:** [#1838](https://github.com/Prism-Shadow/penguin-harness/pull/1838)

[中文版](2026-11-25-git-freshness-prompt.zh.md)

The default system prompt's `# Suggested workflows` section now instructs the agent, before coding in a git repository, to check whether it is behind its remote and stop to ask the user whether to update to the latest commit before making changes.

The kernel version moved to `2026-11-25` (the `prompt` tab). Existing Agents whose prompt tab is still the built-in default adopt the rule through a kernel update.

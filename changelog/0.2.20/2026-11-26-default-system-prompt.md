# Refine default system prompt for deliverable verification and tool execution

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `core`
- **PR:** [#1880](https://github.com/Prism-Shadow/penguin-harness/pull/1880)

[中文版](2026-11-26-default-system-prompt.zh.md)

The default system prompt's `# Success criteria`, `# Stop rules`, and `# Tool use` sections now include six refinements covering explicit deliverable verification (including full-content comparison and positive/negative case checks), documented check reuse and focused edge-case checks, low-cost failure narrowing before rerunning test suites, saving structurally complete candidate files early while keeping them valid during refinement, unattended Debian package installation (`DEBIAN_FRONTEND=noninteractive`), and independent startup for persistent services alongside background command completion notifications.

The kernel version moved to `2026-11-26` (the `prompt` tab). Existing Agents whose prompt tab is still the built-in default adopt these rules through a kernel update.

# Install missing employee plugins when hiring an existing Agent

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`
- **Issue:** [#736](https://github.com/Prism-Shadow/penguin-harness/issues/736)

[中文版](2026-10-16-existing-agent-employee-plugins.zh.md)

Hiring an existing Agent installed any missing `agent-company` and `agent-development` plugins before adding the employee to the organization and opening its desk.

## Details

- Hiring preserved the Agent's `AGENTS.md` and plugins it already carried, including partially installed copies. The existing reconciliation of older employee plugins was unchanged.
- A failed installation stopped the hire before the chart entry, join announcement and desk were created. A retry reused any plugins installed successfully on the earlier attempt.

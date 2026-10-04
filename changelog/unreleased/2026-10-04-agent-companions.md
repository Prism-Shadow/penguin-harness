# Added companion supervision to Agent Tuning

- **Date:** 2026-10-04
- **Type:** feature
- **Scope:** `skills`, `docs`, `landing`

[中文版](2026-10-04-agent-companions.zh.md)

Added `agent-supervision` and linked it from Agent Tuning's task Skills so each
delegated execution has its own Supervisor companion.

## Details

- Defined pair readiness, trace observation, immediate parent alerts, stop
  acknowledgment, joined reports and task-state records.
- Specified three retries after confirmed cheating, with corrective user
  instructions and unchanged system configuration; exhaustion returns a policy
  zero with a reason and preserves raw results separately.
- Added Penguin session recipes for tool children and explicit server-session
  delegation, respecting the tool's depth limit and the declared work budget.
- Aligned role documentation, plugin version and bilingual Skill lists.

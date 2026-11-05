# Creating an organization writes its layout under the organization's lock

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`
- **PR:** [#957](https://github.com/Prism-Shadow/penguin-harness/pull/957)

[中文版](2026-10-10-org-create-under-lock.zh.md)

Creating an organization now writes its directory layout — the skeleton, `org_config.toml`, `org_chart.yaml`, the handbook — and creates the CEO's Agent under the same lock a delete holds while it moves the directory to the trash. A delete arriving mid-creation waits, and then finds either no directory or the finished whole; it can no longer move a half-written directory away and leave the rest of the creation writing beside a config that is gone (a directory no listing showed, and a CEO Agent holding the id). The pre-checks — id, mission, timezone, a free id — still run before the lock.

# Machines are remembered in web.db, and belong to a Project

- **Date:** 2026-09-01
- **Type:** refactor
- **Scope:** `server`, `web`, `docs`
- **PR:** [#565](https://github.com/Prism-Shadow/penguin-harness/pull/565)
- **Breaking:** yes — the machines routes moved under a Project, and `machines-installs.json` is read no longer

[中文版](2026-09-01-machines-store.zh.md)

What this server has installed on which machine moves out of `<data root>/machines-installs.json` and into `web.db`, and a machine now belongs to a Project. The install itself is unchanged — same ssh, same job, same progress lines.

## Details

- **One store.** Migration 4 adds the machines tables, and the install record is written and read there. The JSON file could not carry a schema change, and nothing else this server remembers lives outside the database. The migration is `swapSafe`: it adds tables and touches nothing existing, so a platform rolled back to a build without machines simply never queries them.
- **A machine belongs to a Project**, because a Project's machines are where that Project's work runs. The host itself is not project-scoped — one program, one ssh config entry, shared by every Project that adopted it; what a Project owns is the membership. Installing is how a Project acquires one; `POST …/release` gives it back without touching the install.
- **A host another Project installed reads as `elsewhere`, not as uninstalled.** The two lead to different actions: adopting costs a row, re-installing costs a 30 MB transfer to reach the same place. A row that silently looked untouched would send someone to do the second.
- **The routes moved** from `/api/machines` to `/api/projects/:projectId/machines`. Still admin-only: the Project scope says which machines are answered, never who may reach them — installing spawns ssh with the server account's keys either way.

## Compatibility

`<data root>/machines-installs.json` is **not read** and not migrated. A server that installed on machines under 0.2.9 comes up with an empty **Installed machines** list; the file is left on disk untouched. Re-installing is the recovery and is cheap: every step is idempotent, and a machine that already carries this version is a no-op that only rewrites the record.

A machine belongs to the Project that installs it, and nothing is inherited — the default Project included — so re-install from the Project that should have it. A Project that is deleted takes its machine list with it; the installs themselves stay.

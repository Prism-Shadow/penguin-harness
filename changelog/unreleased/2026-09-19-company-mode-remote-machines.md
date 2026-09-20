# Company mode: an organization's shared workspace can be on a machine

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#796](https://github.com/Prism-Shadow/penguin-harness/pull/796)

[中文版](2026-09-19-company-mode-remote-machines.zh.md)

An organization belongs to the Project. Its shared workspace can now be a directory on one of the Project's connected machines, and the organization then RUNS on that machine — its employees' Agents, their desks and ticket Sessions are there, and that machine's server drives its calendar — while this server keeps a mirror of its files, lists it with the Project's other organizations and keeps a copy that outlives the machine.

## Creating

- The create dialog's shared-workspace picker offers the Project's connected machines, as the new-chat picker does. A directory on a machine is what makes the organization run there; there is no separate "runs on" field. The Model list follows the machine chosen, since desks run on its Model config.
- `POST /api/projects/:projectId/organizations` takes `workspaceMachine` (a connected machine's own id) beside `workspace`. The request is passed to that machine's own server, which does the creating — the CEO's Agent, its desk and the first work round are its Sessions and state — so whatever it refuses (a taken id, a directory that does not exist, a Model it does not have, company mode switched off there) comes back in its own words. `409 machine_not_connected` when the machine is not connected.
- `org_config.toml` gains `workspace_machine`, the id of the machine the organization runs on; absent means the server holding the file. An existing organization has none and is unaffected.

## Running and mirroring

- A server drives an organization only when it runs there. The scheduler's pass over an organization that runs elsewhere copies it instead of reconciling it: reconciling a mirror would find desks whose Sessions this server does not have and open new ones, and fire the calendar a second time.
- The mirror is one-directional, whole files by content hash: `GET …/organizations/:orgId/mirror` lists the organization's files (`workspace/` and dot-named entries excluded, 8 MB a file at most), `GET …/mirror/file?path=` returns one. Files the machine no longer has are removed from the mirror. A machine that cannot be reached leaves the mirror as it is.
- A write to a mirrored organization on this server is refused with `409 org_runs_elsewhere`: it would be undone by the next copy.

## In the Web App

- One organization list, from this server. An organization that runs on a machine carries `machineId`; its own requests (`…/organizations/:orgId/…`) and the Sessions its answers name are sent to that machine through the existing `/server/<machineId>` route, and it reads as `Name [SSH: alias]`. The list row's live facts (who is running, what was spent) are the machine's own; the mirror answers alone when it cannot be asked.

## Not yet

- One organization still runs on ONE machine: employees are not yet spread over several machines, which needs two-way synchronization of the organization's files.
- Notifications about a remote organization are raised on the machine that runs it, to that machine's users; they reach this window through the machine's event stream when the same user id exists on both.

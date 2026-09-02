# Company mode: organizations of Agents driven by a calendar, a ticket board and a group chat

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `core`, `skills`, `docs`
- **PR:** [#587](https://github.com/Prism-Shadow/penguin-harness/pull/587)

[中文版](2026-09-02-company-mode.zh.md)

The Web App gained a second work mode. In company mode a Project's Agents form an
**organization**: a CEO at the root of a reporting tree, one standing **desk session** per
employee, a **calendar** that is the only periodic driver, a five-column **ticket board** that
carries the work, a **group chat** where only `@` mentions reach anyone, and monthly
**budgets** per employee that warn at 80% and pause the employee's calendar at 100%. Creating
an organization takes one sentence — the mission — and produces only the CEO; the CEO hires
HR, finance and the rest, partitions the shared workspace, schedules everyone and files the
first tickets from an initialization run on its desk.

Every piece of an organization is a file under
`<project>/organizations/<org_id>/`: `org_config.toml`, `org_chart.yaml` (the tree with each
employee's budget, workspace and model), `desks.toml` (the server's ledger of desk sessions),
`calendar/<agent_id>/<event>.toml` (the scheduled-task format without target fields),
`tickets/<yyyy-mm>/<column>/<yyyy-mm-dd>-<slug>.md` (an Agent-Notes-style header — Status,
Initiator, Owner, Parent, Notify, Priority, Due, Blocked, Blocked-by, Sessions — over Goal,
Acceptance criteria, Progress and Result sections), `chat/<yyyy-mm-dd>.jsonl` and the handbook
`README.md`. SQLite holds only caches rebuilt from those files on every pass (desk and ticket
session ownership, calendar run state, the last noticed ticket state, chat scan cursors,
budget marks) and each user's chat read cursor.

## Details

- Server: an organization scheduler shaped like the schedule scheduler reconciles every
  organization every 30 seconds and immediately after an API write — it projects the ledger
  and the tickets into the caches, renews a desk whose workspace the chart moved, fires due
  calendar events to desks (queued behind a running Task, held while the organization or the
  employee is paused, never backfilled), notices ticket changes once (assigned, blocked,
  blocker closed, done, rejected — employees on their desks, people through a system chat
  line), delivers chat mentions with a hop chain that stops at the organization's limit, and
  recomputes budgets. Every trigger is one user input that starts with an `[org_trigger]`
  block; ticket sessions are ordinary sessions of the employee's Agent, appended to the
  ticket's `Sessions` header. Spend is attributed by session: an employee's own sessions plus
  every subordinate's, a ticket's contributing sessions split between the tickets they serve,
  rolled up along `Parent`.
- API: `/api/projects/:projectId/organizations` and its sub-routes for the chart, employees,
  desks, the handbook, the calendar, tickets (move, block, unblock, progress, start, attach),
  chat (with a read cursor), finance and the organization's sessions; user-level events
  `org_run`, `org_chat`, `org_ticket` and `org_budget`. Any Project member reads and writes;
  only the owner deletes. Migration 4 adds the seven cache tables.
- Switches: an admin master switch (`companyMode` in server settings, default on; off stops
  the scheduler, 404s the routes and hides the mode switch, reported by `GET /api/me`), a
  personal switch in `ui_prefs`, and an organization's own `status: paused`.
- Control environment: a desk or ticket session's command subprocesses also receive
  `PENGUIN_ORG_ID`, so `penguin org` needs no `--org-id` inside one.
- Core: the marker registry gained `[org_trigger]` (title-noise like `[scheduled_task]`) with
  `buildOrgTriggerMessage` / `parseOrgTriggerMessage`.
- CLI: the `penguin org` family — `ls`, `create`, `show`, `chart`, `hire`, `employee set`,
  `leave`, `desk show|renew`, `calendar ls|add|update|rm`, `ticket
  ls|show|create|move|assign|block|unblock|progress|start|attach`, `chat tail|send`,
  `finance` — a thin client over the API with `--json` everywhere.
- Web: a 「开发 | 公司」 mode switch above the Project switcher, an organization switcher with
  creation and settings, six pages (overview, org chart, calendar, tickets, finance, chat), a
  session list grouped by organization with desk and ticket sub-folders, an 「组织」 folder in
  development mode, the `[org_trigger]` banner in conversations, and the two switches on the
  settings page.
- Plugins: a new `agent-company` plugin in its own category (Agent Company / Agent 公司,
  `preinstall: false`) with the `company-employee`, `company-ceo`, `company-hr` and
  `company-finance` skills; the CEO and every hired Agent get it together with
  `agent-development`.
- Docs: a Company Mode guide with the marketplace walkthrough, the `penguin org` reference,
  and the organization routes in the server API reference.

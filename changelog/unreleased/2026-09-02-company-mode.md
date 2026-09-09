# Company mode: organizations of Agents driven by a calendar, a ticket board and channels

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `core`, `skills`, `docs`
- **PR:** [#587](https://github.com/Prism-Shadow/penguin-harness/pull/587)

[中文版](2026-09-02-company-mode.zh.md)

The Web App gained a second work mode. In company mode a Project's Agents form an
**organization**: a CEO at the root of a reporting tree, one standing **desk session** per
employee, a **calendar** that is the only periodic driver, a five-column **ticket board** that
carries the work, **channels** where only `@` mentions reach anyone, and monthly
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
Acceptance criteria, Progress and Result sections), `channels/<channel_id>/` (one directory
per channel: a `channel.toml` intent file with its name, purpose and members, and a
`<yyyy-mm-dd>.jsonl` per day of messages) and the handbook directory `handbook/` (the company's knowledge base, whose
`README.md` is the index every trigger makes the employee read first; the other documents are
listed there and read on demand). SQLite holds only caches rebuilt from those files on every pass (desk and ticket
session ownership, calendar run state, the last noticed ticket state, the per-channel scan
cursors, budget marks) and each user's read cursor per channel.

## Details

- Server: an organization scheduler shaped like the schedule scheduler reconciles every
  organization every 30 seconds and immediately after an API write — it projects the ledger
  and the tickets into the caches, renews a desk whose workspace the chart moved, fires due
  calendar events to desks (queued behind a running Task, held while the organization or the
  employee is paused, never backfilled), notices ticket changes once (assigned, blocked,
  blocker closed, done, rejected — employees on their desks, people through a system line in
  the all-hands channel), delivers channel mentions with a hop chain that stops at the organization's limit, and
  recomputes budgets. Every trigger is one user input that starts with an `[org_trigger]`
  block; ticket sessions are ordinary sessions of the employee's Agent, appended to the
  ticket's `Sessions` header. Spend is attributed by session: an employee's own sessions plus
  every subordinate's, a ticket's contributing sessions split between the tickets they serve,
  rolled up along `Parent`.
- API: `/api/projects/:projectId/organizations` and its sub-routes for the chart, employees,
  desks, the handbook, the calendar, tickets (move, block, unblock, progress, start, attach),
  channels (their members, messages and read cursor), finance and the organization's
  sessions; user-level events `org_run`, `org_channel`, `org_ticket` and `org_budget`. Any
  Project member reads and writes; only the owner deletes. Migration 5 adds the seven
  organization tables.
- Switches: an admin master switch (`companyMode` in server settings, default on; off stops
  the scheduler, 404s the routes and hides the mode switch, reported by `GET /api/me`), a
  personal switch in `ui_prefs`, and an organization's own `status: paused`.
- Control environment: a desk or ticket session's command subprocesses also receive
  `PENGUIN_ORG_ID`, so `penguin org` needs no `--org-id` inside one.
- Core: the marker registry gained `[org_trigger]` (title-noise like `[scheduled_task]`) with
  `buildOrgTriggerMessage` / `parseOrgTriggerMessage`.
- CLI: the `penguin org` family — `ls`, `create`, `show`, `chart`, `hire`, `employee set`,
  `leave`, `desk show|renew`, `calendar ls|add|update|rm`, `ticket
  ls|show|create|move|assign|block|unblock|progress|start|attach`, `channel
  ls|create|show|invite|join|leave|remove|archive|unarchive|tail|send` (`--channel` defaults
  to `default_channel`), `handbook list|show|write|rm`, `finance` — a thin client over the
  API with `--json` everywhere.
- Web: a Development | Company mode switch above the Project switcher, an organization
  switcher with creation and settings, six nav pages (overview, org chart, calendar, tickets,
  finance, handbook — the knowledge base as a file list beside the rendered document, with
  editing in place, new documents and deletion) plus the channel view, 频道 / Channels as the
  sidebar's own list where development mode lists conversations (all-hands pinned, 我的频道,
  others with a 加入 action, archived folded), the `[org_trigger]` banner in conversations, and
  the two switches on the settings page. Below the channels the sidebar lists the organization
  itself: 工位 / Desks, one row per employee in chart order, expanded, opening that employee's
  desk and creating it when none exists; and 工单会话 / Ticket sessions, collapsed, the
  sessions attached to tickets, newest first, each with the title of the ticket it
  contributes to as the row's subtitle. The collapsed
  rail carries the desks as avatars with their running dots. A desk or ticket conversation is
  the ORDINARY conversation — the same message list, tool cards, approvals and composer as
  development mode — with the company sidebar around it and its row marked; company mode has
  no chat view of its own. The organization the sidebar shows stays the shell's current one
  while such a conversation is open, so its channels and desks do not blank out at
  `/chat/:sessionId`. The create-organization dialog keeps what was typed as a draft in
  `localStorage`, per user and Project: restored when the dialog reopens after an accidental
  close, a reload or a mode switch, dropped on a successful create or through 清空草稿 / Clear
  draft, and it carries the CEO budget field. In a channel, a message that names the reader is
  marked by its mention chip alone (the tinted row is gone), the hop chip appears only from the
  second hop (hop 1 is an employee answering a trigger and says nothing), and the composer's
  box and its 发送 button are one row of the same height, bottom-aligned, the button staying
  anchored as the box grows.
- Creation options: an organization may be created with a **model** (a configured pair, used
  by every desk and ticket session whose employee names none) and a **company workspace** (an
  existing absolute directory used as the shared workspace instead of the organization's own
  `workspace/`); both are `org_config.toml` fields, editable in the organization settings and
  through `penguin org create --workspace … --model-id … --provider …`.
- Decision gate: the CEO proposes and the board decides — the initialization run posts one
  proposal (mission reading, first tickets, hiring plan with budgets and model, workspace
  split) and ends; hiring, budgets, rejecting others' tickets, closing P0/P1 tickets without
  review, anything outside the organization and structural changes wait for the creator's
  confirmation in the all-hands channel. Employees escalate such matters to the CEO. Encoded in the
  `company-ceo` / `company-employee` skills, the init run and the handbook.
- The handbook is a directory, `handbook/`, and the company's knowledge base: its `README.md` is
  the index every trigger points at (layout, protocols, role conventions, and a list of documents
  with one line each saying when it matters); board decisions, conventions and how-tos live next
  to it as Markdown files, read on demand. The API lists, reads, writes and deletes documents,
  `penguin org handbook list | show | write | rm` does the same from a session, the Web App's
  Handbook page browses, edits and creates them, and the index cannot be deleted.
- Scheduling guidance: the CEO/HR skills, the initialization run and the handbook schedule
  the calendar as a rota — role cadences (CEO daily, HR every three days, finance weekly),
  a distinct hour per employee, one recurring event per employee, never `--start-at now`.
- Plugins: a new `agent-company` plugin in its own category (Agent Company / Agent 公司,
  `preinstall: false`) with the `company-employee`, `company-ceo`, `company-hr` and
  `company-finance` skills; the CEO and every hired Agent get it together with
  `agent-development`.
- Channels: an organization's talk is a set of channels, each a directory under `channels/`
  with a `channel.toml` intent file. `default_channel` is the all-hands channel created with
  the organization, that every employee and every Project member is in implicitly and where
  budget alerts, ticket notices to people and hire notices land. Anyone — a person or an
  employee — opens more; a new channel holds only its creator, an employee gets in only when
  a member invites it, and a person may join any channel and read every one of them. Delivery
  follows membership: `@agent:<id>` wakes a desk only inside the channel, `@all` is that
  channel's members minus the sender, and a message naming a non-member is refused with
  `mention_not_member` before anything is written. The `[org_trigger]` block for
  `kind: mention` carries a `channel:` line, so an employee answers where it was addressed.
  Archiving (people only) makes a channel read-only; the all-hands channel cannot be
  archived, left, or have its membership edited. The scan cursor and each person's read
  cursor are per channel — migration 6 recreates the two tables as `org_channel_state` and
  `org_channel_reads`. `penguin org channel` is the CLI family, and channels are the Web
  App's primary list in company mode, with desk and ticket sessions in their own groups below it.
- CEO budget: creation writes the CEO's monthly budget into `org_chart.yaml` — 100 USD
  unless it names another (`ceoBudget` in the create request, `--ceo-budget` on
  `penguin org create`, a CEO budget field in the create dialog). Budgets are compared on
  the cumulative line, so that one number caps the whole company from the first minute
  instead of leaving it unbounded; the initialization run's trigger block names it, and the
  CEO sizes its hiring proposal to it. The org chart raises, lowers or clears it afterwards.
- Guided creation: `company-setup`, a skill of `agent-development` — the plugin
  `default_agent` already carries — so an organization can be created by asking the general
  agent for one. It collects the id, name, mission, shared workspace, model and CEO budget
  one question at a time in the user's language, shows a one-screen summary, waits for a
  yes, runs `penguin org create` and hands the user over to company mode. It never hires,
  schedules or files tickets: that is the CEO's work after the board answers its proposal.
- Organization sessions stay out of development mode: the session DTO gained `orgId` — the
  owning organization of a desk session or of a session contributing to one of its tickets,
  taken from the organization caches (one query per list, never one per row) and served by
  both the session list and `GET /api/sessions/:sessionId`. Development mode's session list
  and its time buckets hide every row that carries it, and the Organization folder that used to
  hold them is gone — company mode's 工位 / 工单会话 groups are where they are listed. The
  hiding is conditional on company mode being available to that user (the admin's master switch
  and the user's own): `orgId` is stamped either way, and with company mode off nothing else
  would list those sessions. The group headers and the "show the rest" row subtract what was
  hidden, so a group never promises rows it will not draw.
- Docs: a Company Mode guide with the marketplace walkthrough, the `penguin org` reference,
  and the organization routes in the server API reference.

### After the first trial round (2026-09-08)

- Working language: `org_config.toml` gained `language` (`zh` / `en`), detected from the mission
  at creation (one Han character anywhere makes it `zh`) unless the request names one —
  `language` on `POST /organizations` and `PATCH /:orgId`,
  `penguin org create --language <zh|en>`, and a Working language select in the Web App's
  organization settings; `penguin org show` prints it. The handbook index, the CEO's
  initialization run, the employee briefs (`AGENTS.md`) and the desk session titles are
  rendered in it, and the skills have every employee write its messages, tickets, documents
  and reports in it. An organization written
  before the field has none stored and reads as whatever its mission is written in; nothing
  was migrated.
- Relative workspace sub-directories are created: `--workspace hr` (or `./hr`) on `hire` and
  `employee set` is normalized to `hr` and created under the shared workspace when it is
  missing, an absolute path must still exist, and a spec climbing out with `..` is 400
  `invalid_workspace`. Opening a desk or a ticket session creates the directory too, so a
  hand-edited chart never leaves an employee unable to work over a missing directory.
- `POST /api/projects/:projectId/organizations/suggest-id` — `{name, kind: "org" | "channel",
  taken?}` → `{id, source: "model" | "fallback"}`: the Project's default model proposes a short
  English snake_case id, an ASCII slug of the name answers when it cannot, and 422
  `id_not_derivable` when neither can name it; the completion belongs to no Session and is not
  metered. The Web App's create-organization and new-channel dialogs put the display name
  first and carry a button that generates the id from it.
- Calendar writes answer with rota advice: `POST /:orgId/calendar`, `PUT
  /:orgId/calendar/:agentId/:name` and `penguin org calendar add | update` return the stored
  event plus advisory `warnings` — another employee's recurring event on the same start
  minute, a second recurring event for the same employee on the same period, a recurring event
  started at `now`. The CLI prints them as `Rota notice:` lines, the Web calendar dialog puts a
  stagger hint under the start time and toasts the warnings, and the CEO and HR skills say to
  fix them rather than move on.
- Tickets: `--initiator <agent_id|principal>` (`initiator` in the create body) files a ticket
  in an employee's or a Project member's name — it becomes the `Initiator`, the author of the
  "created the ticket" progress line and the default `Notify`, the last only when the initiator
  is an employee: a person filing a ticket is no longer @-mentioned when it closes (list
  yourself in `--notify` to be told; the completion's system line still goes to the all-hands
  channel). A session's progress line, body edit or move into `review` books that session as
  one of the ticket's contributing sessions, so its cost lands on the ticket; accepting,
  closing, blocking and unblocking book nothing. A `ticket_work` session opens with a
  `Workspace:` line and the rule that every reference and deliverable is named by its full
  path, and the `assigned` and `blocker_closed` notices end with the `penguin org ticket start`
  command to run.
- Channel `system` lines carry a structured `notice` — a `kind` (`employee_joined`,
  `employee_left`, `channel_created`, `channel_archived`, `channel_unarchived`,
  `channel_joined`, `channel_invited`, `channel_left`, `channel_removed`, `budget_warned`,
  `budget_paused`, `ticket_blocked`, `ticket_done`, `ticket_rejected`) plus string `params` —
  beside their English `text`; the Web App and `penguin org channel tail` render them in the
  reader's language with display names, and a kind the client does not know keeps the English.
  Channel message bodies render as Markdown in the Web App.
- Web: an organization opens on its overview (`/org/:projectId/:orgId` and the switcher both
  land there); the pinned "New channel" slot became a "+" beside the channel list's title; a
  deleted organization no longer strands the sidebar on an error (the nav rows go disabled
  under a "New organization" prompt, and `/org` resolves to the next organization or to the
  empty landing, now vertically centred); the create dialog offers three mission examples and
  the language setting; the overview folds the mission, gives every summary card a jump button
  instead of a whole-card click, and stacks the inbox (mentions, tickets in review and
  blocked, the all-hands channel's latest messages), today's calendar and the alerts full
  width; the empty calendar and board
  keep one create button under a dismissible hint; the finance page lays the KPI panel beside
  the trend, then the spend tree beside the ticket table, with the alerts last; and the
  handbook's file list became an explorer tree with collapsible folders, keyboard navigation,
  "collapse all" and a new document prefilled with the current folder.
- Skills: `company-ceo`, `company-hr`, `company-employee` and `company-setup` restate that a
  desk never does ticket work (it starts a ticket session), that goals, acceptance criteria,
  progress lines and results name files by their full path, that rota warnings are fixed rather
  than ignored, that everything is written in the organization's working language, and that a
  relative workspace is created as it is assigned.

### After the second trial round (2026-09-09)

- A ticket change no longer starts a work run. Assigning an owner, blocking, a blocker
  closing, done and rejected are recorded as before — the ticket file, the all-hands `system`
  line where the change has one, the `org_ticket` event — and queued for the employees they
  concern; the next calendar event of each carries them in its body under `## Since your last
  sweep`, one line per change naming the ticket, its title, what happened and the reason or
  blocker the ticket carries (`(ticket removed)` when its file is gone), and a closing line
  saying what to decide: start a ticket session, verify and unblock, or leave it. A desk
  session is driven by calendar events, channel mentions and people talking to it — the CEO's
  creation-time initialization run is the one exception. A queue is written whether or not the
  organization or the employee is paused and is delivered by the sweep that eventually fires;
  an employee that leaves takes its undelivered lines with it. Migration 7 adds
  `org_desk_notices`, the table that holds the queue. `ticket_notice` stays in `OrgTriggerKind`
  because Traces recorded while it existed carry it; nothing writes it any more. The skills,
  the handbook templates, the Company Mode guide and the server API reference say so.

### After the third trial round (2026-09-09)

- Company mode's sessions carry a durable marker. A desk or ticket session is created with
  `client: "org"` on its index row and `SessionInfo` now serves the field, so development
  mode's session list can leave those rows out whether or not the organization still exists
  and whether or not company mode is switched on — the `orgId` stamp beside it is projected
  from the organization caches, which are deleted with the organization and not read while the
  mode is off. Every reconcile pass also stamps the sessions the organization's files name —
  the desk ledger, current and previous, and the tickets' `Sessions` headers — so the sessions
  of organizations that already exist are marked on the next pass, with no migration (the
  column exists and takes free text). Sessions of organizations deleted before this change
  were never named by any surviving file and stay unmarked; they read as development mode's
  own, and archiving or deleting them is the only cleanup. The backfill and the rest of what
  this round tolerates are recorded in [backward compatibility](2026-09-09-backward-compatibility.md). `POST .../sessions` still accepts
  only `"web"` and `"cli"`: `"org"` is written by the organization runtime, which calls the
  service directly, so no request can claim it.
- Generated ids carry a prefix that says what they name: `co_` for an organization, `ch_` for
  a channel. `POST /organizations/suggest-id` asks the model for the semantic core as before
  and prefixes the answer itself — the ASCII-slug fallback too, before the length cap and the
  `taken` check, and never twice when the core already starts with the prefix. The `company-setup`
  skill proposes `co_<slug>`, and the CEO's and employees' channel examples read `ch_site`,
  `ch_marketing`. The prefix is a convention the server proposes and does not enforce: an id
  typed by hand is created exactly as written and existing ids keep working.
- Only a ticket's owner, or a person, starts its sessions.
  `POST /:orgId/tickets/:ticketId/start` now reads the caller: a person may start a session
  for any ticket, naming the employee with `agentId`, while a caller writing as an employee
  (a desk or ticket session quoting its own `sessionId`) may start one only for a ticket it
  owns and gets `403 not_ticket_owner` for anyone else's — or for a ticket with no employee
  owner — with the message telling it to assign the ticket instead and let that desk pick it
  up in its next sweep. An owner may still pass `agentId` to enlist a colleague on its own
  ticket, and `penguin org ticket start` gained `--agent-id` for exactly that; the command now
  also sends `PENGUIN_SESSION_ID`, which is what identifies the employee behind it. The CEO
  skill, the employee skill, the handbook templates, the CEO's initialization run, the Company
  Mode guide, the server API reference and the CLI reference all describe the rule.
- The organization overview's detail carries an `inbox`: the all-hands messages of the day's
  window that mention the caller or `all` (newest first, at most 20), every ticket carrying a
  `Blocked` reason whoever it waits on (newest first), and the tickets in `done` that closed in
  the current budget period (newest first, at most 20), each with the `closedAt` its last
  "moved … → done" progress line records. A ticket whose file was moved into `done` by hand has
  no such line and is listed with no `closedAt` rather than hidden. `pending` and
  `recentMessages` are unchanged.

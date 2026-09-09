---
title: Company Mode
description: Turn a one-sentence mission into an organization of Agents — a CEO that hires, a calendar that drives every desk, a ticket board that carries the work, channels where only @mentions interrupt anyone, and budgets that pause spending before it runs away.
---

## What it is

Development mode is one person talking to one Agent. Company mode is the second work mode of the Web App: a Project's Agents organized into a **company** that runs by itself for weeks — driven by a calendar, carrying its work on a ticket board, talking in channels — while you sit on the board and decide only what needs a person. You give it a mission in one sentence; it creates the CEO; the CEO hires HR, finance and whoever the mission needs, partitions the shared workspace, schedules everyone and files the first tickets.

Everything the company is lives in **files** under the Project directory. SQLite keeps caches that are rebuilt from those files on every pass, plus each user's read cursor in each channel — the same rule development mode follows for Agent State and Traces. Delete the caches and nothing changes; edit a file by hand and the next pass picks it up.

Switch modes with the Development | Company control at the top-left of the sidebar. It is there when the admin's master switch is on (System settings › Server › Company mode, default on) and you have not hidden it yourself (System settings › Personal › Company mode).

A desk or ticket session is stamped as the organization's on the row itself when it is opened, so it is listed in company mode and never in development mode's session list — including after the organization's directory is removed by hand or the master switch is turned off, when nothing else could tell whose it was. Organizations that already existed get their sessions stamped on the runtime's next pass over their files.

## Creating one

Three entry points, one server call behind all of them:

- **the Web App** — 新建组织 in the organization switcher: the display name comes first, and a button inside the id field asks the server to derive an id from it (the Project's default model proposes a short English snake_case id, an ASCII slug of the name answers when it cannot, and a name neither can name says so under the field); three mission examples fill the mission with one click;
- **the CLI** — `penguin org create --org-id <id> --mission <s> [--name <s>] [--language <zh|en>] [--workspace <path>] [--ceo-budget <usd>] [--model-id <id> --provider <p>]`;
- **the general agent** — ask any Agent carrying the `agent-development` plugin to set a company up and its `company-setup` skill takes over: one question at a time (id, name, mission, shared workspace, model, CEO budget), a summary to confirm, then that same command. It stops there — hiring, scheduling and tickets are the CEO's, after the board answers.

Ids are lowercase snake_case, 2–64 characters, starting with a letter, and by convention they say what they name: an organization id starts with `co_` and a channel id with `ch_` (`co_plugin_marketplace`, `ch_site`). The App's id proposal and the `company-setup` skill both write the prefix; the server does not enforce it, so a hand-typed id is taken as written and ids created before the convention keep working.

Creation writes the organization's directory, its all-hands channel and its handbook, and exactly one employee: the **CEO**, with a monthly budget of **100 USD** unless creation named another (`ceoBudget` in the API, `--ceo-budget` on the CLI, the CEO budget field in the dialog). Budgets are compared on the cumulative line, so that one number is the whole company's cap; it lives in `org_chart.yaml` and is raised, lowered or cleared from the org chart at any time. Then the CEO's desk opens with an initialization run, which posts one proposal in the all-hands channel and stops until the board answers it.

An organization also works in one **language**. It is `language` in `org_config.toml`, detected from the mission at creation — one Han character anywhere makes it `zh`, everything else `en` — unless creation names one (`--language`, `language` in the API, the Working language field in the create dialog), and changed afterwards in the organization settings. The handbook, the employee briefs (`AGENTS.md`), the CEO's initialization run and the desk session titles are written in it, and the skills tell every employee to write its channel messages, tickets, documents and reports in it too; commands, ids, file names and field names stay ASCII whatever it is. An organization created before the field has none stored and reads as whatever its mission is written in, so nothing had to be migrated.

## The pieces

| Piece | What it is | Where it lives |
| --- | --- | --- |
| Organization | one company: a name, a mission, a status, a timezone, a working language, an approval mode | `<project>/organizations/<org_id>/org_config.toml` |
| Employees | Agents in a reporting tree rooted at the CEO — no departments, no positions; each entry carries a title, duties, a workspace and a monthly budget | `org_chart.yaml` |
| Desk sessions | one standing session per employee: calendar events, channel mentions and people land there; it schedules work and opens ticket sessions rather than doing the work itself | `desks.toml` (written by the server) |
| Calendar | per-employee events in the scheduled-task format, minus target fields — the only periodic driver | `calendar/<agent_id>/<event>.toml` |
| Tickets | one Markdown file each, in a column directory that is the status | `tickets/<yyyy-mm>/<column>/<yyyy-mm-dd>-<slug>.md` |
| Channels | one directory per channel: an intent file with its name, purpose and members, and one JSON line per message, split by day | `channels/<channel_id>/channel.toml`, `channels/<channel_id>/<yyyy-mm-dd>.jsonl` |
| Shared workspace | the company's working directory; the CEO assigns sub-directories to desks — a relative sub-directory is created by the server as it is assigned, an absolute path must already exist | `workspace/` |
| Handbook | the company's knowledge base; its `README.md` is the index every work run reads first, the other documents are listed there and read on demand | `handbook/` |

The handbook is progressive loading in practice: every trigger points at `handbook/README.md`, the index names the layout, the protocols, the role conventions and every document with one line saying when it matters, and a run reads a document only when that line says so. Board decisions go in `handbook/decisions/<yyyy-mm-dd>-<slug>.md`, conventions and how-tos next to them; the Handbook page of the Web App browses, edits and creates them, and `penguin org handbook list | show | write | rm` does the same from a session. The index cannot be deleted.

People and employees are named the same way everywhere: `user:<user_id>` and `agent:<agent_id>`; `@all` is every member of the channel it is written in, `system` is the scheduler.

## How work flows

1. **A trigger reaches a desk.** A calendar event fires, someone mentions the employee in a channel it is in, or a person talks to the desk directly — that is the whole list. The server sends the desk session one message that starts with an `[org_trigger]` block — the organization, the employee, the kind of trigger and the employee's spend against its budget — followed by the content. The Web App folds the block into a one-line banner; the Trace keeps it verbatim. **A ticket change never starts a run**: an owner assigned, a ticket blocked, a blocker closed, done, rejected are recorded and listed in the body of that employee's next calendar sweep, under `## Since your last sweep`, one line per change with the ticket, its title, what happened and the reason or blocker it carries.
2. **The desk schedules.** Following the `company-employee` skill it reads the handbook, looks at the board, and opens a **ticket session** for each ticket it should push (`penguin org ticket start <id>`), a separate ordinary session of the same Agent in the desk's workspace. The desk never edits a ticket's files itself: the moment it would, it starts the session and lets that session do it. **A ticket's sessions are started by its owner's desk, or by a person** — an employee asking for anyone else's ticket gets `403 not_ticket_owner`. Work moves between employees by reassigning the ticket (`penguin org ticket assign <id> --owner agent:<employee>`), which the new owner's desk picks up in its next sweep; a colleague is pulled onto a ticket the other way round, its owner starting a session with `--agent-id <colleague>`. Several sessions, from several employees, may contribute to one ticket; each is recorded in the ticket's `Sessions` header.
3. **The ticket session works and writes back.** It opens with where it stands — its workspace, the rule that every reference and deliverable is named by its full path, and the ticket as filed. Before it ends it appends progress (`penguin org ticket progress`) and moves the ticket (`penguin org ticket move`). A write that claims work — a progress line, an edit of the body, a move into review — books that session as one of the ticket's contributing sessions, so its cost is split onto the ticket; accepting, closing, blocking and unblocking book nothing. Stuck — waiting for a decision, another ticket, a missing key — it blocks the ticket with a reason and who can unblock it (`penguin org ticket block`) and stops; blocked tickets are skipped by every sweep until unblocked.
4. **Closing notifies.** A ticket reaching done or rejected notifies its `Notify` list, and its initiator when the initiator is an employee: employees in their next sweep's list, people through a system line in the all-hands channel mentioning them. A person who filed a ticket is not @-mentioned when it closes — the line still lands in the all-hands channel, which is where the board reads completions; list yourself in `Notify` to be told. A ticket that was waiting on it tells its owner the blocker closed.
5. **People decide in the channels and on the board.** The CEO never takes an important decision alone: hiring plans, budgets, rejecting someone else's ticket, anything that reaches outside the organization — it posts a proposal in the all-hands channel mentioning you, and waits for your answer before acting. Only `@<employee>` and `@all` deliver a message to a desk, and only inside that channel's membership: the trigger names the channel it came from, and the employee answers there. A message that names someone the channel does not hold is refused rather than half-delivered, and a message that reaches the mention-chain limit is recorded but delivers nothing, so two employees cannot ping-pong forever. Accepting, rejecting and reviewing tickets is yours or the CEO's, as the handbook says.

Budgets are monthly caps per employee for its own sessions plus every subordinate's — the CEO's budget is the whole company. At 80% a system line appears in the all-hands channel; at 100% that employee's calendar (and its subordinates') is paused until the next month or a raised budget. Mentions and direct conversations keep working, so you can always tell a paused employee what to do.

## Channels

Talk is partitioned like the workspace. Every organization is created with one **all-hands channel**, `default_channel`, that every employee and every Project member is in implicitly — it is where proposals, budget alerts, hires and milestones go, and where the board reads. Anyone else may open a channel per stream or per big ticket, so a thread does not drown the all-hands one.

- **Creating**: any person or employee may (`penguin org channel create ch_<id>`, or the **+** beside the channel list in the App). A new channel holds only its creator; the id follows the same rule as an organization id — `ch_` by convention — and `default_channel` is reserved.
- **Getting in**: an employee reaches a channel only when a member invites it. A person may join any channel and read every channel — the board sees everything. Only members post.
- **Delivery**: `@agent:<id>` wakes that employee's desk only inside the channel's membership, and `@all` is that channel's members minus the sender. A message naming a non-member is refused (`mention_not_member`) rather than written and silently undelivered.
- **Lifecycle**: any member renames a channel or changes its purpose; people archive and unarchive it, which makes it read-only and folds it away. The all-hands channel cannot be archived, left, or have its membership edited — everyone is in it by definition, and only its rendered label ("All hands") is ever shown.

The `system` lines a channel carries — hires and departures, a channel created, joined, left or archived, budget warnings and pauses, a ticket blocked, done or rejected — record a structured notice beside their English text, so the App and `penguin org channel tail` render them in the reader's language and with display names. Message bodies render as Markdown in the App.

Unread counts and each person's read cursor are per channel, and a hire's or a leaver's channel membership is HR's to keep straight.

## The example: a plugin marketplace

The mission *"Build a DeepSeek Harness plugin marketplace, promote it on social media and SEO into the top three results, and earn from paid featured slots on the home page"* plays out like this:

1. You create the organization from the switcher; the CEO's desk opens with an initialization run that posts one proposal in the all-hands channel — its reading of the mission, the first tickets, the roles it wants with budgets — and waits for your answer.
2. You confirm; the CEO hires HR and finance, then a developer and a marketer, creates `workspace/site` and `workspace/marketing`, assigns them, opens a `ch_site` channel and a `ch_marketing` channel and invites each stream's owner into its own, and schedules everyone at their own hour (daily for the builders, every three days for HR, weekly for finance).
3. It files a parent ticket for the marketplace and children per stream: build the site, SEO to the top three, the social launch, paid featured slots. Nothing wakes the owners: each hears about its assignment in its next sweep.
4. The next sweep opens a ticket session for the site in `workspace/site`; the marketer blocks SEO on it ("nothing to index until the site is live") and says so in the `ch_marketing` channel, where the site's own back-and-forth never lands.
5. The site session builds, writes progress, moves the ticket to review; the CEO reviews it to done. The developer's next sweep says so, the marketer's says its blocker closed, and it verifies and unblocks SEO.
6. Marketing works SEO and the launch from one session attached to both tickets; finance rolls the spend up per employee and per ticket — the shared session is split between the tickets it serves, the parent sums its children.
7. Paid featured slots ship and the CEO reports to the board in the all-hands channel, mentioning you.

The server test `organization-scenario.test.ts` runs exactly this story on the runtime's seams.

## Commands

Inside a desk or ticket session the `penguin org` commands already know the organization, Project, Agent and session from the environment (`PENGUIN_ORG_ID` joins the other control variables). From a shell, pass `--org-id`. See [the CLI reference](/cli#penguin-org) for every subcommand; the essentials:

```text
penguin org show                                  # employees, board counts, spend vs budget
penguin org hire --new-agent <id> --title <s> --reports-to <agent_id> [--workspace <sub>] [--budget <usd>]
penguin org calendar add <name> --prompt <s> --start-at 2026-09-03T09:00:00+08:00 --period 1d   # a rota: own hour, role cadence
penguin org ticket create --title <s> --goal <s> [--owner agent:<id>] [--parent <ticket_id>] [--initiator <principal>]
penguin org ticket start <ticket_id> [-m <note>] [--agent-id <employee>]   # a ticket session on a ticket you own, printed as its id
penguin org ticket progress <ticket_id> -m <text>
penguin org ticket move <ticket_id> --to review|done|rejected [--reason <s>]
penguin org channel create ch_site --name "Site" --purpose "Shipping the marketplace site"
penguin org channel invite ch_site agent:<employee>   # an employee reaches a channel only by invitation
penguin org channel tail [--channel <id>] [-n <count>]
penguin org channel send -m "@<employee> …" [--channel <id>]   # default: default_channel
penguin org finance                               # spend per employee (cumulative) and per ticket
```

## The pages

An organization opens on its **overview**: the mission folded to one line, this period's spend against the CEO's budget, a KPI strip, and then three full-width runs — the inbox (the all-hands messages that name you or `@all`, every blocked ticket whoever it waits on, and the tickets closed this period), today's timeline, and the budget alerts. No card is a link; each carries one corner button naming the page it summarizes.

The **handbook** page lists the knowledge base as an explorer tree — folders before documents at every level, collapsed until opened, walked with the arrow keys — beside the rendered document. **Finance** reads the period in three rows: the KPI panel beside the daily trend, then the spend tree and the ticket table side by side, then the period's warnings and pauses. The **calendar** and the **board** each keep one create button while they are empty, under a hint that can be dismissed for good.

## Switches

- **Server**: the admin's company-mode switch. Off stops the organization scheduler (nothing fires, nothing is backfilled when it is turned on again), every organization route answers 404, and the mode switch disappears for everyone.
- **Personal**: hides the mode switch for you only; the organizations keep running.
- **Organization**: pausing an organization stops all of its automatic triggers; people can still open any desk and talk.

**There is no delete.** An organization is turned on or off, and that is its whole lifecycle. Deleting one would throw away the only way back to its conversations, employees, desks and tickets, while a paused organization costs nothing to keep — it fires nothing, and every desk is still there to talk to.

Removing the organization's directory by hand is the only way one goes away. The runtime stops seeing it on its next pass, and the App says so and offers to create another in its place. Employees are ordinary Agents and their desk and ticket sessions are ordinary sessions: both survive, and the sessions keep the mark that says they were the organization's, so they never reappear in development mode's list.

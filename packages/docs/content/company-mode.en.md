---
title: Company Mode
description: Turn a one-sentence mission into an organization of Agents — a CEO that hires, a calendar that drives every desk, a ticket board that carries the work, a group chat where only @mentions interrupt anyone, and budgets that pause spending before it runs away.
---

## What it is

Development mode is one person talking to one Agent. Company mode is the second work mode of the Web App: a Project's Agents organized into a **company** that runs by itself for weeks — driven by a calendar, carrying its work on a ticket board, talking in a group chat — while you sit on the board and decide only what needs a person. You give it a mission in one sentence; it creates the CEO; the CEO hires HR, finance and whoever the mission needs, partitions the shared workspace, schedules everyone and files the first tickets.

Everything the company is lives in **files** under the Project directory. SQLite keeps caches that are rebuilt from those files on every pass, plus each user's read cursor in the chat — the same rule development mode follows for Agent State and Traces. Delete the caches and nothing changes; edit a file by hand and the next pass picks it up.

Switch modes with the 「开发 | 公司」 control at the top-left of the sidebar. It is there when the admin's master switch is on (System settings › Server › Company mode, default on) and you have not hidden it yourself (System settings › Personal › Company mode).

## The pieces

| Piece | What it is | Where it lives |
| --- | --- | --- |
| Organization | one company: a name, a mission, a status, a timezone, an approval mode | `<project>/organizations/<org_id>/org_config.toml` |
| Employees | Agents in a reporting tree rooted at the CEO — no departments, no positions; each entry carries a title, duties, a workspace and a monthly budget | `org_chart.yaml` |
| Desk sessions | one standing session per employee: every trigger lands there; it schedules work and opens ticket sessions rather than doing the work itself | `desks.toml` (written by the server) |
| Calendar | per-employee events in the scheduled-task format, minus target fields — the only periodic driver | `calendar/<agent_id>/<event>.toml` |
| Tickets | one Markdown file each, in a column directory that is the status | `tickets/<yyyy-mm>/<column>/<yyyy-mm-dd>-<slug>.md` |
| Group chat | one JSON line per message, split by day | `chat/<yyyy-mm-dd>.jsonl` |
| Shared workspace | the company's working directory; the CEO assigns sub-directories to desks | `workspace/` |
| Handbook | the index every work run reads first | `README.md` |

People and employees are named the same way everywhere: `user:<user_id>` and `agent:<agent_id>`; `all` is every employee, `system` is the scheduler.

## How work flows

1. **A trigger reaches a desk.** A calendar event fires, someone mentions the employee in chat, or a ticket it cares about changes. The server sends the desk session one message that starts with an `[org_trigger]` block — the organization, the employee, the kind of trigger and the employee's spend against its budget — followed by the content. The Web App folds the block into a one-line banner; the Trace keeps it verbatim.
2. **The desk schedules.** Following the `company-employee` skill it reads the handbook, looks at the board, and opens a **ticket session** for each ticket it should push (`penguin org ticket start <id>`), a separate ordinary session of the same Agent in the desk's workspace. Several sessions, from several employees, may contribute to one ticket; each is recorded in the ticket's `Sessions` header.
3. **The ticket session works and writes back.** Before it ends it appends progress (`penguin org ticket progress`) and moves the ticket (`penguin org ticket move`). Stuck — waiting for a decision, another ticket, a missing key — it blocks the ticket with a reason and who can unblock it (`penguin org ticket block`) and stops; blocked tickets are skipped by every sweep until unblocked.
4. **Closing notifies.** A ticket reaching done or rejected notifies its `Notify` list and its initiator: employees on their desks, people through a system line in the chat mentioning them. A ticket that was waiting on it tells its owner the blocker closed.
5. **People decide in the chat and on the board.** The CEO never takes an important decision alone: hiring plans, budgets, rejecting someone else's ticket, anything that reaches outside the organization — it posts a proposal mentioning you and waits for your answer before acting. Only `@<employee>` and `@all` deliver a message to a desk; a message that reaches the mention-chain limit is recorded but delivers nothing, so two employees cannot ping-pong forever. Accepting, rejecting and reviewing tickets is yours or the CEO's, as the handbook says.

Budgets are monthly caps per employee for its own sessions plus every subordinate's — the CEO's budget is the whole company. At 80% a system line appears in the chat; at 100% that employee's calendar (and its subordinates') is paused until the next month or a raised budget. Mentions and direct conversations keep working, so you can always tell a paused employee what to do.

## The example: a plugin marketplace

The mission *"Build a DeepSeek Harness plugin marketplace, promote it on social media and SEO into the top three results, and earn from paid featured slots on the home page"* plays out like this:

1. You create the organization from the switcher; the CEO's desk opens with an initialization run and confirms its reading of the mission with you in chat.
2. The CEO hires HR and finance, then a developer and a marketer, creates `workspace/site` and `workspace/marketing`, assigns them, and puts everyone on a daily sweep.
3. It files a parent ticket for the marketplace and children per stream: build the site, SEO to the top three, the social launch, paid featured slots. Assignment notices reach the owners' desks.
4. The next sweep opens a ticket session for the site in `workspace/site`; the marketer blocks SEO on it ("nothing to index until the site is live").
5. The site session builds, writes progress, moves the ticket to review; the CEO reviews it to done. The developer is told, the marketer learns its blocker closed and unblocks SEO.
6. Marketing works SEO and the launch from one session attached to both tickets; finance rolls the spend up per employee and per ticket — the shared session is split between the tickets it serves, the parent sums its children.
7. Paid featured slots ship and the CEO reports to the board in chat, mentioning you.

The server test `organization-scenario.test.ts` runs exactly this story on the runtime's seams.

## Commands

Inside a desk or ticket session the `penguin org` commands already know the organization, Project, Agent and session from the environment (`PENGUIN_ORG_ID` joins the other control variables). From a shell, pass `--org-id`. See [the CLI reference](/cli#penguin-org) for every subcommand; the essentials:

```text
penguin org show                                  # employees, board counts, spend vs budget
penguin org hire --new-agent <id> --title <s> --reports-to <agent_id> [--workspace <sub>] [--budget <usd>]
penguin org calendar add <name> --prompt <s> --start-at now --period 1d
penguin org ticket create --title <s> --goal <s> [--owner agent:<id>] [--parent <ticket_id>]
penguin org ticket start <ticket_id> [-m <note>]  # a ticket session, printed as its id
penguin org ticket progress <ticket_id> -m <text>
penguin org ticket move <ticket_id> --to review|done|rejected [--reason <s>]
penguin org chat send -m "@<employee> …"
penguin org finance                               # spend per employee (cumulative) and per ticket
```

## Switches

- **Server**: the admin's company-mode switch. Off stops the organization scheduler (nothing fires, nothing is backfilled when it is turned on again), every organization route answers 404, and the mode switch disappears for everyone.
- **Personal**: hides the mode switch for you only; the organizations keep running.
- **Organization**: pausing an organization stops all of its automatic triggers; people can still open any desk and talk.

Employees are ordinary Agents: deleting an organization removes its directory and caches, and keeps the Agents and their sessions.

---
title: Company Mode
description: Turn a one-sentence mission into an organization of agents that runs on a calendar, a ticket board and channels, while you act as its board.
---

Development mode is one person talking to one agent. Company mode, the Web App's second work mode, organizes a Project's agents into a **company** that runs by itself for weeks: a calendar drives it, a ticket board carries its work, and its employees talk in channels. You give it a mission in one sentence and sit on its board, deciding only what needs a person.

> [!WARNING]
> Company mode is a beta feature. It may still be unstable; please report anything you run into.

- To switch company mode on, see [Turn on company mode](#turn-on-company-mode).
- To start a company, see [Create an organization](#create-an-organization).
- To understand how a company works, see [What an organization is made of](#what-an-organization-is-made-of), [How work flows](#how-work-flows) and [Channels](#channels).
- To know what is guaranteed and what is only guidance, see [Budgets](#budgets) and [What the server enforces](#what-the-server-enforces).
- To run experiments and write papers, see [Research organizations](#research-organizations).
- To build a company that mirrors a real one, see [Mirror organizations](#mirror-organizations).

## Turn on company mode

**Before you begin**

- You need an admin account. Company mode is off by default on every server, and only admins see its server switch.

1. Open **System settings** › Server › **Company mode**, and turn on **Enable company mode**. The change is saved at once.
2. At the top left of the sidebar, the mode switch reads **Development** | **Company**, with a **Beta** tag. Select **Company**.

To go back, select **Development**. Every user sees the mode switch while the server switch is on. To hide it for yourself only, turn off **Company mode** under **System settings** › Personal › **General**; organizations keep running. See [Switches and lifecycle](#switches-and-lifecycle).

## Create an organization

An organization lives inside a Project, at `<project>/organizations/<org_id>/`, and a Project can hold several. There are three ways to create one, with the same server call behind all of them.

### From the Web App

1. In company mode, open the organization switcher and select **New organization**.
2. Enter a **Display name**.
3. Next to **Organization id**, select **Generate with AI** to derive an id from the name, or type one yourself.
4. Enter the **Mission**, or select one of the four examples below the field to fill it in.
5. Optional: choose a **Model**, a **Company workspace** and a **CEO budget**.
6. Select **Create**. The CEO's desk session opens.

**Generate with AI** always leaves an id in the box. The Project's default model proposes a short English snake_case id. When it cannot, an ASCII slug of the name is used. When neither works, the field gets a dated placeholder, and a note under it says why and asks you to replace it.

### From the CLI

```text
penguin org create --org-id <id> --mission <s> [--name <s>] [--language <zh|en>] [--workspace <path>] [--ceo-budget <usd>] [--model-id <id> --provider <p>]
```

### From an agent

Ask an agent that has the `agent-company` plugin to set up a company. Its `company-setup` Skill takes over: it asks one question at a time (id, name, mission, shared workspace, model, CEO budget), shows a summary for you to confirm, and runs the same `penguin org create` command. It stops there. Hiring, scheduling and tickets are the CEO's job, after the board answers.

The plugin is not preinstalled, so an agent that has never been part of a company needs it first. Install it in the **Plugins** field of the create-agent dialog, or on the **Skills** tab of an agent already in the Project. A CEO and its employees carry it from the day they are hired.

### Ids

Ids are lowercase snake_case, 2 to 64 characters, and start with a letter. By convention, an id also says what it names: organization ids start with `co_` and channel ids with `ch_`, as in `co_plugin_marketplace` and `ch_site`. The Web App's id proposal and the `company-setup` Skill both add the prefix. The server does not enforce it, so an id you type is taken as written, and ids created before the convention keep working.

### What creation does

Creating an organization writes its directory, its all-hands channel and its handbook, and hires exactly one employee: the **CEO**. The CEO's monthly budget is **100 USD** unless creation names another (`ceoBudget` in the API, `--ceo-budget` on the CLI, **CEO budget** in the dialog). Because a budget counts every subordinate, the CEO's budget is the cap for the whole company. See [Budgets](#budgets).

Then the CEO's desk opens with an initialization run. The CEO posts one proposal in the all-hands channel and stops until the board answers it.

### Working language

Each organization works in one language, `language` in `org_config.toml`. At creation it is detected from the mission: a single Han character anywhere makes it `zh`, and anything else is `en`. The CLI (`--language`) and the API (`language`) can name it instead, and you can change it later under **Working language** in the organization settings.

The handbook, the employee briefs (`AGENTS.md`), the CEO's initialization run and the desk session titles are written in that language. The Skills tell every employee to write channel messages, tickets, documents and reports in it too. Commands, ids, file names and field names stay ASCII in either language. An organization created before this field existed has none stored and uses the language its mission is written in, so nothing needed migrating.

## What an organization is made of

| Piece | What it is | Where it lives |
| --- | --- | --- |
| Organization | One company: a name, a mission, a status, a timezone, a working language and an approval mode | `<project>/organizations/<org_id>/org_config.toml` |
| Employees | Agents in a reporting tree rooted at the CEO, with no departments or positions. Each entry has a title, duties, a Workspace and a monthly budget | `org_chart.yaml` |
| Desk sessions | One standing Session per employee, where its triggers arrive | `desks.toml` (written by the server) |
| Calendar | Per-employee events in the scheduled-task format, without the target fields. The calendar is the only recurring driver | `calendar/<agent_id>/<event>.toml` |
| Tickets | One Markdown file per ticket, in a column directory that is its status | `tickets/<yyyy-mm>/<column>/<yyyy-mm-dd>-<slug>.md` |
| Channels | One directory per channel: an intent file with its name, purpose and members, and one JSON line per message, split by day | `channels/<channel_id>/channel.toml`, `channels/<channel_id>/<yyyy-mm-dd>.jsonl` |
| Shared workspace | The company's working directory | `workspace/` |
| Handbook | The company's knowledge base | `handbook/` |

### Desk sessions

Each employee gets one standing desk session the moment it is hired. Calendar events, channel mentions and people all arrive there. A desk schedules work and opens ticket sessions rather than doing the work itself. The server opens a desk for any employee that has none: one added to `org_chart.yaml` by hand, or one whose Session was deleted.

### Tickets

A ticket file has YAML frontmatter (`title`, `status`, `owner`, `parent`, `notify`, `priority`, `due`, `blocked`, `blocked_by`, `sessions`, `history`), followed by four sections: `## Goal`, `## Acceptance criteria`, `## Progress` and `## Result`. The column directory the file is in is its status. The slug in the file name is lowercase English words joined by hyphens.

### The shared workspace

The root of `workspace/` holds the shared inputs and is nobody's desk. The CEO works in `ceo/`, and a new hire gets a sub-directory named after its agent id unless the CEO assigns another. The server creates a relative sub-directory when it is assigned; an absolute path must already exist.

### The handbook

The handbook loads progressively. Every trigger points at `handbook/README.md`, the index every work run reads first. The index describes the layout, the protocols and the role conventions, and lists every other document with one line saying when it matters, so a run reads a document only when that line applies.

Board decisions go in `handbook/decisions/<yyyy-mm-dd>-<slug>.md`, with conventions and how-tos next to them. The **Handbook** page browses, edits and creates documents, and `penguin org handbook list | show | write | rm` does the same from a Session. The index cannot be deleted.

### The board

People are never employees: the org chart holds only agents. Project members act as the board. They are in the all-hands channel, can join and read every channel, can own tickets, and can be mentioned.

People and employees are named the same way everywhere: `user:<user_id>` and `agent:<agent_id>`. `@all` means every member of the channel it is written in, and `system` is the scheduler.

## How work flows

1. **A trigger reaches a desk.** There are exactly three triggers: a calendar event fires, someone mentions the employee in a channel it belongs to, or a person talks to the desk directly. The server sends the desk session one message that starts with an `[org_trigger]` block, which names the organization, the employee, the kind of trigger and the employee's spend against its budget, followed by the content. The Web App folds the block into a one-line banner; the Trace keeps it verbatim.

   **A ticket change never starts a run.** An owner assigned, a ticket blocked, a blocker closed, a ticket done or rejected: each change is recorded and listed in the employee's next calendar sweep, under `## Since your last sweep`, one line per change with the ticket, its title, what happened, and the reason or blocker it carries.

2. **The desk schedules.** Following the `company-employee` Skill, the desk reads the handbook, looks at the board, and opens a **ticket session** for each ticket it should push (`penguin org ticket start <id>`). A ticket session is a separate, ordinary Session of the same agent in the desk's Workspace. The desk never edits a ticket's files itself; when it would, it starts a ticket session and lets that session do it.

   **A ticket's sessions are started by its owner's desk, or by a person.** An employee that starts a session on someone else's ticket gets `403 not_ticket_owner`. To hand work to another employee, reassign the ticket (`penguin org ticket assign <id> --owner agent:<employee>`); the new owner's desk picks it up at its next sweep. To pull a colleague onto a ticket, the owner starts a session with `--agent-id <colleague>`. Several sessions, from several employees, can contribute to one ticket, and each is recorded in the ticket's `sessions` list.

3. **The ticket session works and writes back.** It opens with its situation: its Workspace, the rule that every reference and deliverable is named by its full path, and the ticket as filed. Before it ends, it appends progress (`penguin org ticket progress`) in a plain sentence saying what was done and where, with no ids and no names, because the server records who and when in `history`. Then it moves the ticket (`penguin org ticket move`).

   A write that claims work (a progress line, an edit of the body, a move into review) books that session as one of the ticket's contributing sessions, so its cost is split onto the ticket. Accepting, closing, blocking and unblocking book nothing. When the session is stuck, waiting for a decision, another ticket or a missing key, it blocks the ticket with a reason and who can unblock it (`penguin org ticket block`) and stops. Every sweep skips a blocked ticket until it is unblocked.

4. **Closing a ticket notifies.** When a ticket reaches done or rejected, its `notify` list hears about it, and so does its owner if an employee owns it, each in its own next sweep. A ticket that was waiting on the closed one tells its owner that the blocker closed. **Ticket changes are never posted in a channel**: channels hold what people and employees say to each other, and a board narrating itself would bury the conversation. You see closed tickets on the board, and in the overview's **Inbox**, which lists the tickets closed this period.

5. **People decide in the channels and on the board.** The Skills and the handbook tell the CEO not to take an important decision alone, such as a hiring plan, a budget, rejecting someone else's ticket, or anything that reaches outside the organization. It posts a proposal in the all-hands channel mentioning you, and waits for your answer before acting. A hiring plan names roles and budgets only: every employee runs on the organization's model, or on the Project's default model when the organization names none, unless you asked for particular ones.

   The same gate binds every employee before heavy or irreversible work: long compute, spending money, writing outside the shared workspace, deleting what it did not create, a process that outlives the run, or a credential it lacks. It asks you in the all-hands channel with what it wants to run, for how long, on what and how to stop it, blocks its ticket on you and ends its run. The overview lists that ticket as waiting on you, and only a clear yes starts the work.

   Accepting, rejecting and reviewing tickets is yours or the CEO's, as the handbook says. These are instructions to the agents, not checks the server makes; see [What the server enforces](#what-the-server-enforces).

## Channels

Talk is partitioned like the Workspace. Every organization is created with one **all-hands channel**, `default_channel`. Every employee and every Project member is in it implicitly. Proposals, budget alerts, hires and milestones go there, and it is where the board reads. Anyone can open further channels for a stream of work or a big ticket, so that one thread does not drown the all-hands channel.

- **Create**: any person or employee can create a channel, with `penguin org channel create ch_<id>` or the **+** (**New channel**) beside the channel list. A new channel holds only its creator. Its id follows the organization id rules, with `ch_` by convention; `default_channel` is reserved.
- **Join**: an employee enters a channel only when a member invites it. A person can join any channel and read every channel, since the board sees everything. Only members can post.
- **Mentions**: `@agent:<id>` wakes that employee's desk only if the employee is a member of the channel, and `@all` means the channel's members minus the sender. The trigger names the channel it came from, and the employee answers there. A message that mentions a non-member is refused (`mention_not_member`) rather than written and silently not delivered.
- **Chain limit**: a message that reaches the organization's mention chain limit is recorded but delivers nothing, so two employees cannot mention each other back and forth forever. A person's message starts a fresh chain.
- **Lifecycle**: any member can rename a channel or change its purpose. People archive and unarchive channels; an archived channel is read-only and folded away. The all-hands channel cannot be archived or left, and its membership cannot be edited: everyone is in it by definition, and the Web App always shows it as **All hands**.

The `system` lines in a channel (hires and departures; a channel created, joined, left or archived; budget warnings and pauses) appear in the reader's language and with display names, both in the Web App and in `penguin org channel tail`. Message bodies render as Markdown in the Web App.

Unread counts and each person's read position are kept per channel. Keeping the channel membership of new hires and departing employees straight is HR's job.

People get no push notifications. A mention of you shows up in the unread counts, the **@me** filter and the overview's **Inbox**. The one exception is a mirror twin bound to a chat bot; see [Mirror organizations](#mirror-organizations).

## Budgets

A budget is a monthly cap in USD, set per employee. It counts the employee's own Sessions plus those of every subordinate, so the CEO's budget is the cap for the whole company. A period is a calendar month in the organization's timezone.

| Spend reaches | What happens |
| --- | --- |
| 80% of a budget | A system line is posted in the all-hands channel. |
| 100% of a budget | Another system line is posted, and the calendar of that employee and all of its subordinates pauses until the next month, or until the budget is raised or cleared. |

A budget pause is narrower than it may sound:

- Only calendar events stop. Mentions and direct conversations still reach the employee, so you can always tell a paused employee what to do.
- Calendar events that come due during the pause are skipped, not replayed later.
- Sessions that are already running are not stopped.
- Spend is checked on each scheduler pass, not on every request, so spend can go past the cap before the pause takes effect.

After you raise or clear a budget, the next check lifts the pause. There are no Token budgets and no per-ticket budgets; ticket cost is only reported.

Budgets are stored in `org_chart.yaml`. Set them in the create dialog (**CEO budget**) or with `--ceo-budget`, with `penguin org hire --budget` or `penguin org employee set --budget`, or from the **Org Chart** and **Finance** pages. The 80% and 100% thresholds are `budget_warn_ratio` and `budget_pause_ratio` in `org_config.toml`; the Web App has no field for them.

## What the server enforces

Much of how a company behaves is guidance: instructions in the `agent-company` Skills, the handbook and the CEO's initialization prompt. The server enforces only part of it.

The server enforces these rules:

- Only the owner's desk, or a person, starts a ticket's sessions (`403 not_ticket_owner`).
- An employee joins a channel only by invitation.
- Only people archive channels.
- A message that mentions a non-member is refused (`mention_not_member`).
- Mentions stop at the mention chain limit (`mention_chain_limit`, 3 by default).
- A budget at 100% pauses the calendar.

These are guidance only, followed by the agents but not checked by the server:

- The CEO proposes and waits for the board's answer before it acts on its reading of the mission, a hiring plan, setting or raising a budget, rejecting someone else's ticket or closing a P0 or P1 ticket without review, anything that reaches outside the organization (publishing, accounts, mail, money), or a change to the handbook's rules or the organization's structure.
- Every employee asks the board before heavy or irreversible work, blocks its ticket on the person it asked, and ends its run.
- Who accepts, rejects and reviews tickets.
- Escalating to a manager.
- Writing in the organization's working language.
- Which twin a mirror organization relays a question to.

Hiring, changing an employee's budget, pausing the organization and moving tickets have no role check and no people-only check: an employee can do each of them from its own Session. The reporting tree itself drives only a few things in code: budget roll-up, a pause cascading to subordinates, block notices to the manager, and re-parenting when someone leaves.

### Tool approvals

Tool calls in desk and ticket sessions follow the organization's **Approval mode**, set in the organization settings: **Allow all** by default, or **Read only** or **Deny all**. There is no `always-ask` mode, because unattended runs never stop to ask a person.

## Example: a plugin marketplace

The mission *"Build a DeepSeek Harness plugin marketplace, promote it on social media and SEO into the top three results, and earn from paid featured slots on the home page"* plays out like this:

1. You create the organization from the switcher. The CEO's desk opens with an initialization run that posts one proposal in the all-hands channel, with its reading of the mission, the first tickets, and the roles it wants with their budgets, and then waits for your answer.
2. You confirm. The CEO hires HR and finance, then a developer and a marketer. It creates `workspace/site` and `workspace/marketing` and assigns them, opens a `ch_site` channel and a `ch_marketing` channel and invites each stream's owner into its own, and schedules everyone at their own hour: daily for the builders, every three days for HR, weekly for finance.
3. It files a parent ticket for the marketplace and a child ticket per stream: build the site, SEO into the top three, the social launch, paid featured slots. Nothing wakes the owners; each hears about its assignment in its next sweep.
4. The next sweep opens a ticket session for the site in `workspace/site`. The marketer blocks the SEO ticket on it ("nothing to index until the site is live") and says so in the `ch_marketing` channel, where the site's own back-and-forth never lands.
5. The site session builds, writes progress, and moves the ticket to review; the CEO reviews it and moves it to done. The developer's next sweep reports that. The marketer's next sweep reports that its blocker closed, and the marketer verifies and unblocks SEO.
6. Marketing works on SEO and the launch from one session attached to both tickets. Finance rolls up the spend per employee and per ticket: the shared session is split between the tickets it serves, and the parent ticket sums its children.
7. Paid featured slots ship, and the CEO reports to the board in the all-hands channel, mentioning you.

The server test `organization-scenario.test.ts` runs exactly this story on the runtime's seams.

## Research organizations

The first mission example, **Research Paper Lab**, is a company that runs experiments and writes papers:

> *"Set up a company that does research for me and produces papers fit for top-tier conferences. Experiments run autoresearch-style: fix the evaluation script and the metric first, edit one file only, give every experiment the same time budget, log each result as one line and keep only the changes that improve the metric. Before any experiment loop starts, the researcher asks me in the channel for resources — the machine and its GPU/CPU, concurrency, total hours, disk and data, paid APIs — then runs unattended inside what I approved and asks again before exceeding it. Papers go through adversarial review between two kinds of employee: reviewers reproduce the results, check baselines and ablations, hunt for test-set leakage and metric gaming, and return a score with required changes; authors revise or rebut point by point until the reviewer accepts."*

Such a mission keeps the CEO on the standard checklist and puts the researchers and the reviewers on the `company-research` Skill, which adds three rules to the employee protocol:

- **The resource envelope comes first.** Before a ticket's first experiment, its owner asks you in the all-hands channel for the envelope: which machine and GPU or CPU, how many runs at once, total hours or experiments, disk and data, paid APIs or keys, together with the estimated load and the way to stop the loop. It then blocks the ticket on you and ends its run. Inside an approved envelope the loop runs unattended. Exceeding it, or needing something new such as a dataset, a key or a second GPU, is a new request; an employee asks for what it lacks instead of working around it.
- **The loop is autoresearch's.** One evaluation harness and one metric, frozen before the loop and never edited during it. One editable surface, the same wall-clock budget for every experiment, and a branch per run. Each experiment is one line in `results.tsv` (commit, metric, memory, keep / discard / crash, a description), and the commit is kept only when the metric improves and reset otherwise. A run past twice its budget is killed and counted as a crash, and crashes are diagnosed from the log tail.
- **Authors and reviewers are different employees.** The CEO hires at least one dedicated reviewer. A claim goes to `review` and the reviewer tries to break it: reproducing the key numbers from the kept commit, checking baselines and ablations, looking for test-set leakage and metric gaming, and weighing the claims against the evidence and the novelty against prior work. It writes a scored review with the changes it requires, and the author revises or rebuts point by point. The ticket travels between `in_progress` and `review` until the reviewer accepts, and a research ticket is never closed without that acceptance in its `history`. After three rounds without one, the reviewer blocks the ticket on the CEO, who decides or brings it to you.

Like the rest of the protocol, this is Skill and handbook guidance rather than something the server checks.

## Mirror organizations

The fourth mission example, **Digital-twin company**, is a company with no work of its own:

> *"Set up a company that mirrors our real company: I will give the CEO our real org chart and the CEO creates one digital twin per real employee; each twin's desk session is bound to that colleague's Feishu bot. A twin only receives its own colleague's messages by default, answers what it can on its own and relays the rest to the relevant colleague's twin, who passes it on to the real person. The CEO hires nobody on its own, schedules nothing and files no tickets; the company only relays and solves what it can."*

Such a mission puts the CEO on the `company-mirror` Skill instead of the standard checklist, and the company it builds is shaped differently:

- **The roster comes from you.** The CEO's initialization run asks the board for the real org chart: each person's name, title, reporting line, and which bot will be theirs. When you answer, the CEO proposes a roster. Only after you confirm it does the CEO hire one twin per person, with `--reports-to` mirroring the real reporting line, and write each twin's brief. Nothing imports a directory or an HR system.
- **Nothing recurring drives it.** There are no calendar events, no tickets and no per-stream channels. A twin runs only when its own person writes to it through the bound bot, or when another twin mentions it.
- **Binding is the last setup step, and a person does it.** Bind each twin's desk session to that colleague's bot in the desk session's **Remote control** panel (Feishu, Telegram, QQ or WeChat; see [Remote control](/remote-control)). `penguin org desk show <agent_id>` prints the desk session id. An unbound twin can neither hear its person nor answer them.
- **Relay, then write it down.** A twin answers from the handbook when it can. Otherwise it relays the question to the right colleague's twin, which asks its own person and passes the answer back. Everything that comes back is written into the handbook (`people/<name>.md`, `faq.md`), so the next time the same question is answered without a relay.

Know the limits before you rely on a mirror organization:

- One bot account can be enabled on only one Session at a time (`409 account_enabled_elsewhere`), so each twin needs its own bot.
- A bot delivers replies only after its person has written to it once.
- Relays go through the all-hands channel, which every employee and board member reads, so a relay is never private.
- Choosing which twin to ask is the model's judgment, based on its brief and the handbook; there is no routing engine.
- Relays use up the mention chain, but a person's message, through the bot or the chat page, starts a fresh chain. One question out and one answer back fit within the default `mention_chain_limit`; a relay that goes on to a third twin and back does not.

## Commands

Inside a desk or ticket session, the `penguin org` commands already know the organization, Project, agent and Session from the environment (`PENGUIN_ORG_ID` joins the other control variables). From a shell, pass `--org-id`. The essentials are below; see [the CLI reference](/cli#penguin-org) for every subcommand.

```text
penguin org show                                  # employees, board counts, spend vs budget
penguin org hire --new-agent <id> --title <s> --reports-to <agent_id> [--workspace <sub>] [--budget <usd>]
penguin org calendar add <name> --prompt <s> --start-at 2026-09-03T09:00:00+08:00 --period 1d   # a rota: own hour, role cadence
penguin org ticket create --title <s> --goal <s> [--owner agent:<id>] [--parent <ticket_id>] [--slug <words>]
penguin org ticket start <ticket_id> [-m <note>] [--agent-id <employee>]   # a ticket session on a ticket you own, printed as its id
penguin org ticket progress <ticket_id> -m <text>
penguin org ticket move <ticket_id> --to review|done|rejected [--reason <s>]
penguin org channel create ch_site --name "Site" --purpose "Shipping the marketplace site"
penguin org channel invite ch_site agent:<employee>   # an employee reaches a channel only by invitation
penguin org channel tail [--channel <id>] [-n <count>]
penguin org channel send -m "@<employee> …" [--channel <id>]   # default: default_channel
penguin org finance                               # spend per employee (cumulative) and per ticket
```

## Organization pages

In company mode, the sidebar lists the organization's pages: **Overview**, **Org Chart**, **Calendar**, **Tickets**, **Finance** and **Handbook**.

- **Overview** is where an organization opens. It shows the mission folded to one line, this period's spend against the CEO's budget, and a KPI strip, followed by three full-width sections: the **Inbox** (all-hands messages that mention you or `@all`, every blocked ticket whoever it waits on, and the tickets closed this period), today's calendar, and the budget alerts. No card is a link; each has one corner button that names the page it summarizes.
- **Org Chart** shows the reporting tree. Each employee's menu offers **Hire a subordinate**, **Set budget**, **Change reporting line**, **New desk session** and **Leave the organization**.
- **Handbook** shows the knowledge base as an explorer tree beside the rendered document. At every level, folders come before documents; folders stay collapsed until opened, and the arrow keys move through the tree.
- **Finance** shows the period in three rows: the KPI panel beside the daily trend, then the spend tree and the ticket table side by side, then the period's warnings and pauses.
- **Calendar** and **Tickets** each show a single create button while they are empty, under a hint you can dismiss for good.

The organization settings include **Working language**, **Approval mode** and **Pause organization**.

## Switches and lifecycle

| Switch | Where | Effect |
| --- | --- | --- |
| Server | **System settings** › Server › **Company mode** (admins only; off by default) | Off stops the organization scheduler: nothing fires, and nothing is backfilled when it is turned back on. Every organization route answers 404, and the mode switch disappears for everyone. |
| Personal | **System settings** › Personal › **General** › **Company mode** (shown only while the server switch is on) | Hides the mode switch for you only. Organizations keep running. |
| Organization | **Pause organization** in the organization settings | Stops all of the organization's automatic triggers. People can still open any desk and talk to it. |

**There is no delete.** An organization is either running or paused, and that is its whole lifecycle. Deleting one would throw away the only way back to its conversations, employees, desks and tickets, while a paused organization costs nothing to keep: it fires nothing, and every desk is still there to talk to.

The only way to remove an organization is to delete its directory by hand. The runtime stops seeing it on its next pass, and the Web App says so and offers to create another in its place. Employees are ordinary agents, and their desk and ticket sessions are ordinary Sessions, so both survive. The Sessions keep the mark that says they belonged to the organization, so they never reappear in development mode's session list.

## How it works

### Files are the source of truth

Everything the company is lives in files under the Project directory. SQLite keeps caches that are rebuilt from those files on every pass, plus each person's read position in each channel, the same rule development mode follows for Agent State and Traces. Delete the caches and nothing changes; edit a file by hand and the next pass picks it up.

The organization scheduler runs a pass every 30 seconds, and immediately after every write through the API. It runs only while the server is up, and it never backfills events it missed.

### Session marks

A desk or ticket session is marked as the organization's on the Session row itself when it is opened. It is therefore listed in company mode and never in development mode's session list, even after the organization's directory is removed by hand or the server switch is turned off, when nothing else could tell whose it was. Organizations that already existed get their Sessions marked on the runtime's next pass over their files.

### Skill updates

The server keeps each employee's company Skills current. On every pass it compares the `agent-company` and `agent-development` plugins each employee carries with the plugin library, and reinstalls the whole plugin wherever an employee has fallen behind. A Skill added to the library therefore reaches employees already at work, without anyone updating each agent by hand. Nothing is written while the versions match, and a failed update is recorded as an error without disturbing the rest of the pass. A new hire installs the current version to begin with.

### Structured system lines

The `system` lines a channel carries store a structured notice beside their English text. That is what lets the Web App and `penguin org channel tail` show them in the reader's language and with display names.

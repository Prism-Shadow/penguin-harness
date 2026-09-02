---
name: company-ceo
description: Run a PenguinHarness organization as its CEO — turn the mission into a ticket tree, hire HR and finance first, partition the shared workspace, schedule the calendar, review tickets and report to the board in chat.
---

# Company CEO

The CEO is the root of the employee tree: the one employee an organization is created with, whose budget is the whole organization's and whose duties are to turn the mission into tickets, hire, partition the workspace, accept and review tickets, and report to the board — the humans of the Project — in chat. Everything in `company-employee` applies to you too; this skill is what the title adds.

## Before you start

If the message only names this skill without a concrete request, ask what the CEO should do — plan, hire, review, report. An `[org_trigger]` run needs no question: read `<app_data_dir>/organizations/<org_id>/README.md` and act; a `kind: init` run follows the checklist at the end of this skill.

## Mission to tickets

A ticket is the organization's unit of collective work; the mission becomes a tree of tickets, and the tree is what the board reads.

- One **parent ticket per project-level goal**: `--goal` the outcome, `--criteria` how the board will know it is reached, `--due` when the mission has a date. Its owner is you or the employee who leads that stream.
- **Child tickets per stream of work** (`--parent <parent_id>`), each small enough for one ticket session to finish, each with acceptance criteria a reviewer can check without reading a transcript. `--priority P0` for what blocks everything else; `P2` is the default.
- New tickets land in `proposed`. Accepting one (`move --to in_progress`) is a decision — yours, the owner's superior's or a human's. Assign the owner when you accept: their desk gets an `assigned` notice and picks the ticket up on its next sweep.
- Anyone may propose. Keep `proposed` short by deciding on it every sweep: accept, reject with a reason, or merge into an existing ticket.

```bash
penguin org ticket create --title "Launch the marketing site" --goal "A public site at the agreed domain" \
  --criteria "Pages live; Lighthouse >= 90; analytics wired" --priority P1 --due 2026-09-30
penguin org ticket create --title "Site: content" --goal "Copy for every page" --criteria "Reviewed by the CEO" \
  --parent 2026-09-01-launch-the-marketing-site --owner agent:<org_id>_writer
penguin org ticket move 2026-09-01-site-content --to in_progress
```

A ticket's cost is the cost of its contributing sessions, rolled up along `Parent`; `penguin org finance` shows each parent's total, so the tree is also the budget's structure.

## Hiring

Every employee is an Agent. Hire HR and finance first — they keep the rest scheduled and within budget — then the roles the ticket tree needs.

```bash
penguin org hire --new-agent <org_id>_hr --name "HR" --title "HR" --reports-to <org_id>_ceo \
  --duties "Keep every employee's calendar populated; hire, evaluate and improve employees" --workspace people --budget 30
penguin org hire --new-agent <org_id>_finance --name "Finance" --title "Finance" --reports-to <org_id>_ceo \
  --duties "Set budgets, audit spend daily, explain alerts and propose savings" --workspace finance --budget 20
penguin org hire --new-agent <org_id>_dev --name "Developer" --title "Developer" --reports-to <org_id>_ceo \
  --duties "Own the implementation tickets" --workspace site --budget 80
```

- `--new-agent` creates the Agent in the Project with the `agent-company` and `agent-development` plugins installed by default — the protocol, and the `penguin` orchestration commands every employee needs; `--skills` adds library skills on top. `--agent-id` employs an Agent that already exists. Ids match `^[a-z][a-z0-9_]{1,63}$`; prefix them with `<org_id>_`.
- `--workspace` names a sub-directory of the shared workspace that already exists (see partitioning); `--reports-to` names an employee. Everyone reports to exactly one superior and the tree must not loop.
- The title decides which `company-*` skill the employee reads, so use the titles the handbook describes. Write the duties as a sentence the employee can act on: they go into its entry and into every trigger block it receives.
- Give the newcomer its brief in `<app_data_dir>/agents/<agent_id>/agent_state/AGENTS.md` — the mission, its title and duties, its workspace partition, whom it reports to — the way your own was prefilled at creation.
- Schedule the newcomer (or ask HR to): an employee without a calendar event only ever works when mentioned or assigned.
- `penguin org leave <agent_id>` removes an employee (the Agent stays in the Project); reassign its tickets first.

## Partitioning the shared workspace

The shared workspace is `<app_data_dir>/organizations/<org_id>/workspace/`; your desk works on all of it (`workspace: .`). Every other desk gets a sub-directory, so two employees never edit the same tree:

1. Create the directory with your file tools — `mkdir -p <app_data_dir>/organizations/<org_id>/workspace/site`. The server refuses a workspace that does not exist.
2. Assign it: `penguin org employee set <org_id>_dev --workspace site`, or pass `--workspace site` at `hire` time.
3. A changed workspace opens a fresh desk session for that employee on the next reconcile; the old one stays as history, and running ticket sessions keep the workspace they started with.

Shared inputs — specs, brand assets, data — live at the workspace root where everyone can read them. A ticket that spans partitions is split into one child per partition, or its session is started with `--workspace <sub>` for the partition it needs.

## Scheduling

The calendar is the only recurring driver. Schedule yourself, HR and finance at initialization; HR keeps everyone else covered. A calendar is a **rota, not a broadcast**: every employee gets its own hour, cadences differ by role, and nobody is swept more than once a day.

| Role | Cadence | Hour (organization timezone) |
| --- | --- | --- |
| CEO (you) | daily | 09:00 |
| HR | every 3 days | 10:00 |
| Finance | weekly | 16:00 |
| Developers, writers, operators | daily | a distinct half-hour between 09:30 and 12:00 |
| Reviewers, marketing, research | every 2–3 days | a distinct hour in the afternoon |

Rules that follow from the table: never `--start-at now` for a recurring event (it pins everyone to the same minute); compute the next occurrence of the role's hour as an ISO instant with the organization's UTC offset; one recurring event per employee (a second one only for a different cadence, such as a weekly retrospective beside a daily sweep); no two employees on the same start minute; leave weekends to the weekly and 3-day cadences rather than adding events.

```bash
# Tomorrow 09:00 in Asia/Shanghai (UTC+8): write the instant with its offset.
penguin org calendar add board-sweep --prompt "Sweep the board: decide on every proposed ticket, review what is in review, check the ticket sessions of the in_progress tickets you own, block what is stuck, and report to the board in chat if anything needs a decision." --start-at 2026-09-03T09:00:00+08:00 --period 1d
penguin org calendar add hr-audit --agent-id <org_id>_hr --prompt "Check that every employee has exactly one enabled recurring event at its own hour and add one for anyone without. Evaluate whoever finished a ticket since your last run." --start-at 2026-09-03T10:00:00+08:00 --period 3d
penguin org calendar add finance-weekly --agent-id <org_id>_finance --prompt "Run the weekly audit: penguin org finance against the budgets; explain any alert in chat and propose savings." --start-at 2026-09-04T16:00:00+08:00 --period 7d
```

`--period` is at least `5m`; `1d` is the most any desk needs, and hourly is never worth its cost. Write the prompt as the sweep you want, not as a reminder: the desk reads the handbook and its skill, then does what the prompt says.

## Reviewing tickets

`review` is where owners put finished work. Review against `## Acceptance criteria` and the artifacts in the workspace, then:

- `penguin org ticket move <id> --to done` when the criteria hold — the `Notify` list and the initiator hear about it;
- `penguin org ticket move <id> --to rejected --reason "<what is missing>"` when they do not; the reason lands in `## Result`. Work worth retrying gets a new child ticket, or the owner writes a progress line and moves the ticket back to `in_progress`;
- a ticket that has sat `in_progress` without a progress line for days is either blocked (ask the owner to `block` it with a reason) or abandoned (reassign it).

Use `penguin org show` for the board counts and the budget before every sweep; a growing `review` column means you are the bottleneck.

## Reporting to the board

The board is the humans of the Project. Report in chat, @-mentioning the organization's creator (`created_by` in `org_config.toml`, as `@user:<id>`) — at most once per sweep, and only when there is something to decide or a milestone to report:

```bash
penguin org chat send -m "@user:alice Site launch: content done, build in review, domain blocked on you (2026-09-01-domain). Budget 41%. Decision needed: launch date." --ref-ticket 2026-09-01-launch-the-marketing-site
```

One message: what finished, what is blocked and on whom, spend against budget, the decision you need. Humans answer in chat (a mention wakes your desk) or in a direct conversation with you.

## The init work run

A `kind: init` trigger is the first message of a new organization's CEO; its body is the mission and the initialization tasks. In order:

1. **Confirm the mission.** State your reading of it — goals, deadline, what "done" means — and your open questions at the top of your reply; the creator usually has this session open right after creating the organization. Put the same in chat, @-mentioning the creator, so it is on record. Proceed with the rest of the checklist on that reading: a wrong assumption costs a ticket edit, an idle organization costs a day.
2. **Hire HR and finance** (above), then the first roles the ticket tree needs. Give each an AGENTS.md brief.
3. **Partition the workspace**: one sub-directory per employee, created before it is assigned.
4. **Schedule** yourself, HR and finance with `penguin org calendar add` at staggered hours and role cadences (the rota table above); never everyone at the same minute.
5. **Write the first tickets**: the parent per goal and the first children per stream, owners assigned, all left in `proposed` until the creator has confirmed the mission; accept them on your next sweep once the reading holds.
6. **Report** to the creator in one chat message: what you understood, whom you hired, how the workspace is split, what is scheduled, and which tickets await acceptance.

## Cautions

- **Do the ticket work in ticket sessions**, not at your desk: your desk is the organization's scheduler, and its context must survive for months.
- **Your budget is the organization's.** Every calendar event and every session bills against your cumulative line; at the pause ratio the whole organization's calendar stops. Hire and schedule within it, and take finance's proposals seriously.
- **The handbook is yours to keep current.** When you change a role convention — who reviews, which priorities skip review — change `README.md`: it is what every employee reads first.

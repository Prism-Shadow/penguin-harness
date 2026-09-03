---
name: company-hr
description: Run HR for a PenguinHarness organization — guarantee every employee has an enabled calendar event, hire and offboard employees, evaluate and improve them (with the agent-tuning plugin's agent-optimization skill), and keep the handbook's role conventions current.
---

# Company HR

HR keeps the organization staffed and moving. Nobody works without a calendar event, so HR guarantees every employee has one; HR hires and offboards, evaluates employees on what they shipped, improves the weak ones, and keeps the handbook's role conventions current. `company-employee` applies to you as to everyone; this skill is what the title adds.

## Before you start

If the message only names this skill without a concrete request, ask what HR should do — a calendar audit, a hire, an offboarding, an evaluation. An `[org_trigger]` run needs no question: read `<app_data_dir>/organizations/<org_id>/handbook/README.md`, then run the calendar audit below before anything else the prompt asks for.

## The calendar audit

The calendar is the organization's only recurring driver. An employee with no enabled event never sweeps its board: its tickets sit `in_progress` untouched until someone mentions it. Every HR run:

```bash
penguin org chart --json                  # every employee: title, duties, reports_to
penguin org calendar ls --json            # every event of every employee, with its enabled flag and trigger state
```

For each employee, require at least one event that is enabled and whose window has not ended (`end_at` absent or in the future). For anyone without one, add a sweep derived from their duties:

```bash
penguin org calendar add daily-sweep --agent-id <org_id>_dev \
  --prompt "Sweep the board: start ticket sessions for your in_progress tickets that have none, check the ones running, verify and write back results, block what is stuck, skip blocked tickets." \
  --start-at now --period 1d
penguin org calendar update daily-sweep --agent-id <org_id>_dev --enable      # a disabled event counts as none
```

- `--agent-id` names whose calendar the event lives in; without it, the event lands in yours.
- The prompt is the employee's standing order, not a reminder. Write it in terms of their duties (a writer: "draft, revise, hand to review"; the CEO: "decide on proposed, review, report") and keep it under a paragraph — the protocol itself is in the handbook and the `company-employee` skill.
- `--period` is at least `5m`: `1d` for a desk that owns daily work, `2d` or `3d` for reviewers, marketing and research, `7d` for finance and retrospectives. Exactly one recurring event per employee is the guarantee; a second one is for a different cadence (a weekly retrospective beside the daily sweep), never a duplicate sweep, and nobody is swept more than once a day.
- Stagger the hours: give every employee its own start minute (09:30, 10:00, 10:30 … in the organization's timezone), never `--start-at now`, never the same minute as another employee — desks that fire together compete for the same budget minute and the same tickets. Compute the next occurrence as an ISO instant with the organization's UTC offset.
- An event shown as paused (a budget pause on the employee or a superior, or the organization set to `paused`) is still a valid event — do not add another; budgets are finance's.
- Events fire only while the server runs and are not replayed after downtime; a missed slot is not an outage to fix.

## Hiring

```bash
penguin org hire --new-agent <org_id>_writer --name "Writer" --title "Writer" --reports-to <org_id>_ceo \
  --duties "Own the content tickets: draft, revise, hand to review" --workspace content --budget 40
penguin org hire --agent-id existing_agent --title "Reviewer" --reports-to <org_id>_ceo --workspace review
```

1. Confirm the role is needed: an open ticket stream with no owner, or a superior asking in chat. Do not hire for a single ticket that an existing employee's ticket session can do.
2. Make sure the workspace sub-directory exists first — the CEO partitions `workspace/`; ask in chat when the partition is missing, or create it with file tools where the handbook lets HR do so.
3. `--new-agent` creates the Agent with the `agent-company` and `agent-development` plugins installed (the protocol and the orchestration commands); `--agent-id` employs an Agent that already exists in the Project. Ids match `^[a-z][a-z0-9_]{1,63}$`, prefixed `<org_id>_`.
4. Write the brief: `<app_data_dir>/agents/<agent_id>/agent_state/AGENTS.md` — the mission, the title and duties, the workspace partition, whom to report to. The title must match a role the handbook describes; add the role to the handbook when it is new.
5. Schedule the newcomer at once (the audit above) and announce the hire in chat, @-mentioning the superior: `penguin org chat send -m "@<org_id>_ceo <org_id>_writer joined as Writer; daily sweep scheduled"`.

## Offboarding

`penguin org leave <agent_id>` removes the employee's entry (the CEO cannot leave); the Agent and its history stay in the Project. Before it:

- reassign or close the employee's tickets (`penguin org ticket ls --owner agent:<id>`) and unblock anything waiting on `agent:<id>`;
- move its subordinates to a new superior (`penguin org employee set <sub> --reports-to <new>`) — an entry whose `reports_to` names a former employee is invalid and stops firing;
- remove its events (`penguin org calendar rm <name> --agent-id <id>`): an event of a former employee never fires and only clutters the calendar.

Announce it in chat, @-mentioning the former superior. Deleting the Agent itself is a human's Project-level act, never HR's.

## Evaluating and improving employees

Evaluate on what shipped: tickets moved to `done` versus `rejected` and why, progress lines that hold up under verification, blocks raised with a reason versus tickets that idled, cost per finished ticket (`penguin org finance`). Read the transcripts of the worst and the best sessions (`penguin logs <session_id> --tail 80`; the ids are on each ticket's `Sessions` line) before judging.

Fixes, cheapest first:

1. **The brief** — rewrite the employee's `agent_state/AGENTS.md` and its duties (`penguin org employee set <id> --duties "…"`) when the failure is about scope or priorities.
2. **The calendar prompt** — `penguin org calendar update <name> --agent-id <id> --prompt "…"` when the sweep asks for the wrong thing.
3. **The model** — `penguin org employee set <id> --model-id <id> --provider <p>` for a role the current model underserves (or, with finance, a cheaper one for a role it overserves).
4. **The skills** — install a library skill the role is missing, or run a measured optimization: the `agent-tuning` plugin's `agent-optimization` skill improves an Agent State against a frozen benchmark with a snapshot before every round, and its `benchmark-design` and `agent-evaluation` skills build and score that benchmark. Install `agent-tuning` on yourself from the library when an evaluation calls for it, and run it in a ticket session of an evaluation ticket, not at your desk.

Record each evaluation as a ticket (`--title "Evaluate <agent_id>"`, `--goal` the weakness, `--criteria` the measurable improvement) so the result and its cost are on the board. Change one thing per evaluation and read the next week's tickets before the next change.

## The handbook's role conventions

The handbook — the `handbook/` directory, the company's knowledge base — names in its index (`handbook/README.md`) the roles, their duties and the ticket conventions: who accepts a proposed ticket, who reviews, which priorities skip review. HR keeps that section true: add a role when a title is hired, remove it at offboarding, and update it when the CEO changes a convention in chat. HR also keeps the knowledge base tidy: every document listed in the index with one line saying when it matters, stale documents removed (`penguin org handbook rm <path>`), and role guides (`roles/<title>.md`) written for titles that need more than one line. Edit with `penguin org handbook write <path>` or file tools; the handbook is an intent file the server never overwrites, and every employee reads the index at the start of every run.

## Cautions

- **Do not schedule what does not need scheduling.** An event fires a work run that costs money; a role whose work arrives by mention (a reviewer) needs a weekly event, not an hourly one.
- **Do not delete Agents.** `leave` is the HR operation; the Agent stays.
- **Improvement is measured, not felt.** One change per evaluation, checked against the tickets that follow.

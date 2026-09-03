---
name: company-finance
description: Run finance for a PenguinHarness organization — set and adjust monthly budgets along the reporting line, audit spend daily with penguin org finance and penguin cost, explain budget alerts in chat with savings proposals, and handle budget pauses.
---

# Company Finance

Finance keeps the organization inside its money. Budgets are set per employee and compared on the cumulative line — the employee plus all subordinates — so the CEO's budget is the whole organization's. Spend is derived from every desk and ticket session's usage: finance does not count tokens, it sets the limits, reads the audit, explains what happened and proposes what to change. `company-employee` applies to you as to everyone; this skill is what the title adds.

## Before you start

If the message only names this skill without a concrete request, ask what finance should do — an audit, a budget change, an alert to explain. An `[org_trigger]` run needs no question: read `<app_data_dir>/organizations/<org_id>/handbook/README.md`, then run the audit below.

## How budgets work

- `budget` is a field of each employee's entry in `org_chart.yaml`, in USD per calendar month in the organization's timezone; no field means unbounded.
- It is compared on the **cumulative** line: the employee's own sessions plus every subordinate's, recursively. A subordinate's budget therefore has to fit inside its superior's, and the CEO's is the organization's total.
- Employee spend is its desk session plus every ticket session it contributed to (each with its subsessions, each session counted once). Ticket spend is its contributing sessions — split evenly when a session is attached to several tickets — rolled up along `Parent`.
- At `budget_warn_ratio` (default 0.8) the server posts one system alert in chat per employee per period; at `budget_pause_ratio` (default 1.0) the employee is **paused**: its calendar events and its subordinates' stop firing. Mentions and human conversations still reach a paused employee, so it can be told to wrap up. The pause lifts by itself when the ratio falls: a new month, or a raised budget (applied at the next reconcile, about 30 s).
- Prices come from the Project's model configuration; an unpriced model shows tokens only, starred, and is a finding of its own.

## Setting budgets

```bash
penguin org chart --json                                 # the tree, with each entry's budget
penguin org employee set <org_id>_ceo --budget 500       # the organization's monthly total
penguin org employee set <org_id>_dev --budget 200       # inside the CEO's; the dev's subordinates share it
```

- Start from the total the board gave (ask the creator in chat when nobody did), give the CEO that number, then split down the tree with a reserve at each level: a superior's budget minus its subordinates' budgets is what the superior itself can spend, so never allocate a level to 100%.
- Size a role by its work, not its title: a developer running several ticket sessions a day costs more than a reviewer woken weekly. Use the first week's `penguin org finance` to correct the guesses.
- The CLI writes the employee tree and validates at once; the new limit counts from the next reconcile.

## The first run

The CEO hires finance at initialization, before there is a budget tree. On your first work run:

1. Read `org_config.toml` for `timezone` (the month boundary), `budget_warn_ratio` and `budget_pause_ratio`; ask the CEO in chat before proposing a change to the ratios.
2. If the CEO's entry has no `budget`, ask the board for the monthly total — `penguin org chat send -m "@user:<creator> What is the organization's monthly budget in USD?"` — and block on the answer rather than inventing one; `created_by` in `org_config.toml` names the creator.
3. Set the tree top-down (above), leaving each superior its reserve.
4. Open the month's finance ticket to carry the audit lines: `penguin org ticket create --title "Finance <yyyy-mm>" --goal "Keep the organization within budget this month" --criteria "Every alert explained in chat; one audit line per day" --owner agent:<your_agent_id>`.
5. Check that your own calendar carries the daily audit (`penguin org calendar ls`); add it when the CEO has not (`penguin org calendar add finance-daily --prompt "Run the daily audit" --start-at now --period 1d`).

## The daily audit

```bash
penguin org finance --json                      # this period: spend per employee (own and cumulative) and per ticket, budget usage, alerts and pauses
penguin org finance --period 2026-08 --json     # last month, for the trend
penguin cost --days 7 --by agent                # the Project view: spend by agent over the week
penguin cost --days 7 --by session --agent-id <org_id>_dev --json    # which sessions of one employee cost the most
```

Read, in order: anyone paused; anyone above the warn ratio; spend against days elapsed in the month (an employee at 60% on the 10th will pause by the 20th); the most expensive tickets and whether their `Sessions` count explains them; sessions that cost much and moved no ticket (a runaway conversation, a sweep that finds nothing). Write the finding as one progress line on the month's finance ticket (create it at the first audit of the month) so the trend is on the board.

## Explaining alerts and proposing savings

A budget alert is a system message: it triggers nobody, so finance reads it in the audit and answers it. One chat message, @-mentioning the employee's superior (and the employee when it can act on the advice), with the number, the cause and a proposal:

```bash
penguin org chat send -m "@acme_ceo acme_dev is at 85% (170/200 USD) on day 12: three ticket sessions per day on 2026-09-01-site-build. Proposal: one session per sweep, and the drafting tickets on the cheaper model." --ref-ticket 2026-09-01-site-build
```

Proposals, cheapest to enact first:

1. **A cheaper model** for the role or for a class of tickets: `penguin org employee set <id> --model-id <id> --provider <p>`, a pair from the Project's model configuration (`penguin config model list`); the employee's sessions opened after the change use it.
2. **A lower cadence**: `penguin org calendar update <name> --agent-id <id> --period 2d`, or a sweep prompt that starts one ticket session at a time instead of one per ticket.
3. **Merged tickets**: several small tickets each opening its own session cost more than one ticket with a list. Ask the owner or the CEO to merge them — or to split a ticket whose sessions keep restarting into steps with clearer criteria.
4. **A raised budget** — a proposal to the CEO or the board, not something finance grants itself unless the handbook says so; when the total is fixed, a raise for one employee is a cut for another.

## Handling a pause

When `penguin org finance` shows an employee paused:

- Its calendar and its subordinates' calendars are silent until the ratio falls; the tickets they own will not move on their own. Tell the superior in chat what is frozen and when it resumes — the new month, or a raise.
- A paused employee still answers mentions and humans: to finish something urgent, the superior @-mentions it with the one thing to do, or a human talks to its desk directly.
- To lift the pause now, raise the budget (`penguin org employee set <id> --budget <usd>`, inside the superior's) and say so in chat; otherwise wait for the month to turn. Do not propose offboarding to free a budget — that is HR's call, and a finished ticket keeps its cost on the board either way.

## Cautions

- **Budgets are limits, not targets.** An employee under budget is not underused; the audit looks for spend that moved nothing, not for room to spend.
- **Do not edit `org_chart.yaml` by hand for budgets.** `penguin org employee set --budget` validates and applies at once; a hand edit waits for the reconcile, and an invalid one is skipped into the error records without telling you.
- **Your own spend counts too.** A daily audit is one short desk run: keep the finance calendar at `1d` and its prompt short, and do not open ticket sessions for arithmetic.
- **The pause is derived, not stored.** The server recomputes it from usage and the tree every cycle; nothing you write lifts it except a budget or the calendar month.

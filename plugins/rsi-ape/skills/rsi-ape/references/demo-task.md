# Demo task: house-style brief

The demo that this Skill's quick start runs. A fresh agent has to turn short notes into briefs in a house format that nobody tells it: the Rubric checks only that format, and only the proposer sees five example briefs. The empty instruction therefore scores low, and an instruction that states the format can score near 100. Every text below is fixed: write it exactly as given, never generate it.

## Setup

| Item | Value |
| --- | --- |
| Benchmark | `house-style-brief`: the six cases below, `runs = 1` |
| Target | `create: brief_writer`; when that id is taken, the next free one of `brief_writer_2`, `brief_writer_3`, … (an existing writer may hold an earlier run's instruction) |
| Initial instruction | empty |
| Demonstrations | D1 to D5 below, all five in the one subset |
| Parameters | 1 subset × 5 demonstrations × 4 proposals, seed 0; selection on all six cases |
| Budget | at most (1 + 4) × 6 × 1 = 30 Target executions and 4 proposer calls |

If `PROJECT_DIR/benchmarks/house-style-brief/` exists, reuse it unchanged when it is published and its case ids and statements match this file, and say so; otherwise stop and ask. Name the Target you used in the report.

## Write the Benchmark

Write it under `PROJECT_DIR/benchmarks/house-style-brief/`, beside `agents/`. `benchmark_config.toml`, with today's date in the version:

```toml
id = "house-style-brief"
title = "House-style brief"
description = "Six notes to turn into briefs in the house format. The APE demo task of the rsi-ape Skill."
version = "YYYY.MM.DD.1"
status = "published"
runs = 1

[origin]
kind = "agent"
```

`scoreboard.yaml` holds `evaluations: []`. Each case is a directory named by its id under "Cases" (`CASE-001-vendor-price-change`, …); braces mark what you fill in from the case. Its `statement/README.md`:

```markdown
# {Title}

Write the brief for the note below and save it as `brief.md` in the current Workspace.

> {Note}
```

and its `rubric/README.md`, identical in all six cases:

```markdown
# Scoring rubric (max 100 points)

Judge `brief.md` in the Workspace only; a missing or empty file scores 0. Ignore blank lines and trailing spaces; judge every other line as written. Each item scores all or nothing.

- 25 pts: the first line starts with `BRIEF:` in capitals, followed by a subject of one to eight words.
- 25 pts: exactly three lines start with `- `, and they are the only lines between the first line and the last.
- 25 pts: every line that starts with `- ` continues with an imperative verb as its first word, Markdown emphasis aside (a command such as Confirm, Send or Ask; not a noun, pronoun, article, `Please`, or an -ing or past form). 0 when no line starts with `- `.
- 25 pts: the last line starts with `NEXT:` in capitals, followed by one action written as a single sentence.
```

## Cases

- `CASE-001-vendor-price-change`, title "Vendor price change". Note: Our cloud storage vendor announced that prices rise 12% on 1 January for every plan above 10 TB. We store about 42 TB today, so the annual bill would grow by roughly $9,000. The vendor offers a 15% discount for a two-year commitment signed before 15 December. Procurement has not compared other vendors yet.
- `CASE-002-flaky-deploy`, title "Flaky deploy". Note: Deploys to the staging cluster failed four times this week, each time at the database migration step. Every failure disappeared on retry, which points to a timing problem rather than a broken migration. Two releases were held back while engineers retried by hand. The platform team suspects the new connection pool limit.
- `CASE-003-hiring-loop`, title "Hiring loop". Note: The hiring loop for the senior data engineer role has five interviews and takes three weeks on average. Two strong candidates withdrew last month because other offers arrived first. Interviewers say the take-home task and the system design round test the same skills. Recruiting proposes cutting the loop to four interviews.
- `CASE-004-customer-escalation`, title "Customer escalation". Note: Northwind Retail escalated a billing dispute to their account director this morning. A payment retry charged them twice for September, about $4,200 in total. Their CFO wants a refund and a written explanation by Wednesday. Support has confirmed the duplicate charge but has not issued the refund.
- `CASE-005-data-retention-review`, title "Data-retention review". Note: Legal finished the annual data-retention review and found that application logs are kept for 24 months, while the policy allows 12. The logs contain customer IP addresses, so the extra year is a compliance risk. Deleting the old logs needs sign-off from the security team. The analytics team still uses some of the older logs for its churn model.
- `CASE-006-conference-talk`, title "Conference talk". Note: Our talk on cost-aware model routing was accepted at the Berlin AI Summit in March. The slot is 25 minutes, followed by ten minutes of questions. The organisers need the final title and a speaker bio by 20 January. The conference does not cover travel.

## Demonstrations

D1 to D5, in this order: the proposer's input/output pairs, written as they go into the template (each pair `Input:` then `Output:`, one blank line apart). The input is a note, the output its brief. Only the proposer reads them; never copy them into the Target or the Benchmark.

```text
Input: Facilities confirmed that the third-floor kitchen will close for renovation from 3 to 14 November. During those two weeks, coffee and water are available on the second floor only. Anything left in the third-floor fridge after 31 October will be thrown away. Teams hosting visitors should book the second-floor lounge in advance.
Output: BRIEF: Third-floor kitchen closed for renovation
- Use the second-floor kitchen from 3 to 14 November.
- Empty the third-floor fridge by 31 October.
- Book the second-floor lounge before hosting visitors.
NEXT: Remind your team about the fridge deadline today.

Input: Starting next Monday, the on-call rotation moves from weekly shifts to two shifts a week, with handovers on Monday and Thursday at 10:00. Each engineer will cover about two shifts a month instead of a full week. The pager app already shows the new schedule. Swaps still need a manager's approval at least 48 hours ahead.
Output: BRIEF: On-call moves to twice-weekly shifts
- Check your new shifts in the pager app.
- Hand over on Mondays and Thursdays at 10:00.
- Ask your manager to approve swaps 48 hours ahead.
NEXT: Confirm your first shift with the rotation lead.

Input: Our packaging supplier told us this morning that the October shipment of recycled boxes will arrive nine days late because of a paper shortage. We have enough boxes for about a week of normal orders. The supplier offers plastic mailers as a stopgap at the same price. Customer service has not been told yet.
Output: BRIEF: Recycled box shipment delayed nine days
- Ration the remaining boxes across this week's orders.
- Decide whether to accept the plastic mailers.
- Tell customer service about the packaging change.
NEXT: Ask purchasing to confirm the new delivery date in writing.

Input: The Q3 budget review showed the design team 8% under budget, mostly because two contractor projects were postponed. Finance will take back unspent contractor money at the end of the quarter unless it is committed by then. The team lead wants to restart one of the projects in December. The review notes are in the shared finance folder.
Output: BRIEF: Design team under budget in Q3
- Commit the contractor budget before the quarter ends.
- Choose which postponed project restarts in December.
- Read the review notes in the shared finance folder.
NEXT: Send finance the restart plan by Friday.

Input: The 4.0 release of the mobile app has moved from 2 December to 9 December because the store review flagged a missing privacy label. Engineering says the fix takes one day, but the review queue currently runs about five days. Marketing had scheduled the launch emails for 2 December. The press briefing can keep its date if it does not name a release day.
Output: BRIEF: App 4.0 release moves to 9 December
- Add the missing privacy label to the store listing.
- Reschedule the launch emails for 9 December.
- Keep the release day out of the press briefing.
NEXT: Resubmit the build for store review tomorrow.
```

## What a run shows

With the empty instruction the Target writes a brief in its own shape, typically a heading with a summary and loose bullets, which meets few or none of the four items. An instruction induced from the demonstrations names the `BRIEF:` line, three imperative bullets and the `NEXT:` line, and the Target then meets all four on most cases. These are expectations, not targets: report what you measured, whatever it is.

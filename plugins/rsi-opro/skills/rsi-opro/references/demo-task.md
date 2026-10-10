# Demo task: precise summary

The demo that this Skill's quick start runs. A fresh summary writer starts from the source's seed instruction, and OPRO improves it from scores alone. The Rubric rewards three things the statement never asks for: every figure copied exactly, at most 40 words, and no hedging words. The proposer sees only instructions, their scores and three sampled statements per step, so the instruction has to get shorter and firmer through the score history. Every text below is fixed: write it exactly as given, never generate it.

## Setup

| Item | Value |
| --- | --- |
| Benchmark | `precise-summary`: the six cases below, `runs = 1` |
| Target | `create: summary_writer`; when that id is taken, the next free one of `summary_writer_2`, `summary_writer_3`, … (an existing writer may hold an earlier run's instruction) |
| Seed instruction | `Let's solve the problem.` |
| Parameters | 2 steps × 4 proposals, 3 exemplars per step (statements only), threshold 0, the other parameters as in the smoke profile |
| Budget | at most (1 + 2 × 4) × 6 × 1 = 54 Target executions and 8 proposer calls |

If `PROJECT_DIR/benchmarks/precise-summary/` exists, reuse it unchanged when it is published and its case ids and statements match this file, and say so; otherwise stop and ask. Name the Target you used in the report.

## Write the Benchmark

Write it under `PROJECT_DIR/benchmarks/precise-summary/`, beside `agents/`. `benchmark_config.toml`, with today's date in the version:

```toml
id = "precise-summary"
title = "Precise summary"
description = "Six team notes with figures to summarize. The OPRO demo task of the rsi-opro Skill."
version = "YYYY.MM.DD.1"
status = "published"
runs = 1

[origin]
kind = "agent"
```

`scoreboard.yaml` holds `evaluations: []`. Each case is a directory named by its id under "Cases" (`CASE-001-warehouse-move`, …); braces mark what you fill in from the case. Its `statement/README.md`:

```markdown
# {Title}

Summarize the note below for the team and save it as `summary.md` in the current Workspace.

> {Note}
```

and `rubric/README.md`, the same in every case except its figure list:

```markdown
# Scoring rubric (max 100 points)

Judge `summary.md` in the Workspace only; a missing or empty file scores 0.

- 40 pts, figures: each figure listed below appears in `summary.md` exactly as written here, with the same digits, symbols and units (`£18,400`, not `£18.4k` or `18,400 pounds`). Score 40 × found ÷ listed, to two decimals.
  - Figures: {the case's figures}
- 30 pts, length: at most 40 words, counting the whitespace-separated tokens that contain a letter or a digit. All or nothing.
- 30 pts, certainty: none of `maybe`, `might`, `could`, `possibly`, `perhaps` or `likely` appears as a whole word, in any letter case. All or nothing.
```

## Cases

- `CASE-001-warehouse-move`, title "Warehouse move". Note: The Leeds warehouse move is now set for 14 March. The movers quoted £18,400, which is 12% above the budget approved in January. Operations says the racking might arrive a day late, so the first outbound shipments could slip to 16 March. Finance needs a decision on the extra spend by Friday. Figures: `14 March` · `£18,400` · `12%` · `16 March`
- `CASE-002-churn-drop`, title "Churn drop". Note: Monthly churn fell to 3.1% in August, down from 4.4% in July. The drop is most likely due to the annual-plan discount, which 640 customers took up. Billing-related support tickets fell by 27% over the same period. Marketing wants to extend the discount into October, but nothing has been decided. Figures: `3.1%` · `4.4%` · `640` · `27%`
- `CASE-003-gateway-patch`, title "Gateway patch". Note: The payments gateway patch went live on 2 October at 06:40 UTC. It fixes a flaw that affected 14 of our 38 edge sites. No customer data was exposed as far as we know, although the audit could possibly turn up more. The incident review is booked for 9 October. Figures: `2 October` · `06:40 UTC` · `14` · `38` · `9 October`
- `CASE-004-hiring-budget`, title "Hiring budget". Note: Leadership approved 12 engineering hires for next year, down from the 20 we requested. The recruiting budget is $310,000, and agency fees may take no more than 25% of it. We might fill two of the staff roles internally. Recruiting will publish the first job posts on 3 November. Figures: `12` · `20` · `$310,000` · `25%` · `3 November`
- `CASE-005-energy-bill`, title "Energy bill". Note: Our electricity bill for September came to €7,950, about 18% higher than in September last year. Part of the increase comes from the new test lab, which runs around the clock. Facilities thinks a time-of-use tariff could perhaps save €900 a month. The current contract renews on 1 December. Figures: `€7,950` · `18%` · `€900` · `1 December`
- `CASE-006-expo-booth`, title "Expo booth". Note: We have booked a booth at the Data Systems Expo in Lisbon, running from 21 May to 23 May. The booth costs €12,500 and includes a 30-minute talk on the main stage. Two of us will staff the booth each day. Design must deliver the banner files by 28 April. Figures: `21 May` · `23 May` · `€12,500` · `30-minute` · `28 April`

## What a run shows

The seed instruction says nothing about length, figures or hedging, so H1 typically loses the length points and, where the note hedges, the certainty points. Instructions that keep every figure verbatim, stay short and state facts plainly score higher, and the history shows the proposer which way the scores move. These are expectations, not targets: report what you measured, whatever it is.

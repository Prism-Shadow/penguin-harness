# The Evaluation Center reads every machine the Agent runs on

- **Date:** 2026-09-08
- **Type:** fix
- **Scope:** `web`
- **PR:** [#648](https://github.com/Prism-Shadow/penguin-harness/pull/648)

[中文版](2026-09-08-evaluation-center-across-machines.zh.md)

An Agent is one identity across the machines it runs on — this Project's `default_agent` here and on a machine is that Agent, not two of them. Its `benchmarks/` directory is not: it is written on whichever machine the evaluation actually ran, so one Agent's case library and its scoreboard end up spread over as many disks as it has been evaluated on. The Evaluation Center read only the disk it is served from. A Benchmark built on a machine was not listed at all, and a Benchmark evaluated in both places showed a history with the rounds that ran elsewhere missing — a chart with holes in it, and nothing on screen saying so.

The list is now asked of this server and of every machine it holds a connection to, and the answers are folded by benchmark id: one entry per Benchmark, one history under it. The machine rides along as attribution rather than as a grouping key — an evaluation row names the machine whose scoreboard recorded it (`[SSH: prod-1]`) when the Benchmark was evaluated in more than one place, and a Benchmark only one machine has is named for that machine.

Order is the part that could only be decided one way. A scoreboard's append order *is* its evaluation sequence, and the page trusts it over the timestamps — but two scoreboards on two disks share no append order at all, so a joined history is ordered by time, and a Benchmark that came from a single machine is left exactly as its file had it.

A Benchmark's Cases are the union of what those machines hold, and a Case's files are read from the machine its listing came from — two copies of one Case, and reading either is reading the Case. A machine that cannot answer is left out of the merge, which is what "could not read it" means; everything this server holds still renders, and only when no source answered at all is there an error to report.

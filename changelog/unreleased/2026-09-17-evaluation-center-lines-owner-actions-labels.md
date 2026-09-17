# The Evaluation Center's score lines connect across other agents, owner-only creation is hidden from members, and English labels no longer truncate

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `web`
- **PR:** [#775](https://github.com/Prism-Shadow/penguin-harness/pull/775)

[中文版](2026-09-17-evaluation-center-lines-owner-actions-labels.zh.md)

A series on a Benchmark's score chart was drawn only between neighbouring slots of the time axis,
so another agent's evaluation between two of its points broke the line, and where two agents took
turns no line was drawn at all. Each series became one line through its own points. Two owner-only
actions stopped being offered to Project members, a failed Benchmark stopped telling a member to
delete it, and the labels the English UI cut short now fit.

## Score chart

- Each series is drawn through its own evaluations, in scoreboard order, straight over the slots
  other series hold between them; every point keeps its slot on the time axis.
- `seriesPoints` in `benchmark-metrics.ts` builds a series' points and `segmentPath` strokes them.
  It replaced `seriesValues`, and `lineSegments`, which split a series at every slot it did not
  hold, was removed from `chart-geom.ts` together with its tests.

## Owner-only actions

- The Evaluation Center offers "Create manually" to the Project's owner only, in its header and in
  its empty state. A member keeps "Create with AI", and the first step card no longer names the
  manual path to them. The server refuses a member's `POST /api/projects/:projectId/benchmarks`
  with 403; deleting a Benchmark was owner-only on the page before this change.
- The "Import Trace" row in "System settings" › "General" lists only the Projects the viewer owns
  and starts on the open one when they own it; a viewer who owns no Project gets no row. The import
  route, `POST /api/projects/:projectId/agents/:agentId/traces/import`, refuses anyone but the
  owner.
- A Benchmark whose creation failed tells the owner to delete it and create it again, on its card
  and on its own page; a member, who has no delete button, is told only that calibration did not
  finish.

## English labels

- A Benchmark card's score column grows past its minimum width to fit its label, so "first
  evaluation" is no longer cut and "Not evaluated yet" stays on one line. The Chinese card keeps its
  layout.
- The file tree in a case's dialog is 330px wide in English, so "Scoring rubric" reads in full
  beside its "Hidden from Target Agent" badge, and stays 240px in Chinese. The width is fixed per
  language, so opening or closing a folder does not move the preview beside the tree.
- On the org chart, the CEO's card no longer carries a "CEO" chip beside the name: the CEO is the
  tree's root, and its title already reads CEO. A CEO's name — created as
  `<organization name> CEO` — has as much room as any other employee's, and a name still too long
  for the fixed-size card is in the card's tooltip in full.

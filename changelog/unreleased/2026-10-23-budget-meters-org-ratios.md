# Budget meters read the organization's own warn and pause ratios

- **Date:** 2026-10-23
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#1280](https://github.com/Prism-Shadow/penguin-harness/pull/1280)

[中文版](2026-10-23-budget-meters-org-ratios.zh.md)

Every budget meter colored its reading by the built-in 80% / 100% thresholds while
enforcement reads each organization's configured `budgetWarnRatio` / `budgetPauseRatio`. An
organization that pauses at 50% therefore showed a green "healthy" meter at 60% — while the
server had already paused that employee — and the reverse at a pause ratio above 100%, where
over budget still read as danger for an employee the server had not touched.

## Details

- `budgetTone` takes the organization's warn and pause ratios as optional arguments,
  defaulting to the built-in 0.8 / 1.0.
- **Overview page** — the spend ring and bar read the ratios from the organization detail the
  page already holds.
- **Finance page** — the meters follow the server's enforcement marks rather than a ratio:
  the root row's (and each employee's) `warned` / `paused` are the organization's own
  thresholds already applied, so a paused employee is danger whatever the raw ratio says,
  and an explicitly not-warned row is success even over 100% under a pause ratio parked
  above it. `markedSpendTone` carries that reading and the finance page applies it to the
  KPI ring, the ratio tile and every employee meter.
- **Org chart** — the chart response's employees now carry `warned: true` when the period's
  budget warning has fired (the state field already says `paused`; nothing carried the
  warning that precedes one). The card's spend meter reads it first and falls back to the
  built-in thresholds only for what has no marks.
- The finance-tree tests pin both readings: the configured thresholds move the tone lines,
  and the enforcement marks outrank what the raw ratio would read by the built-in defaults.

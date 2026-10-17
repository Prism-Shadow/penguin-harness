# Budget meters follow the organization's warn and pause ratios

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `web`
- **Issue:** [#737](https://github.com/Prism-Shadow/penguin-harness/issues/737)

[中文版](2026-10-17-budget-tone-org-ratios.zh.md)

Company-mode budget meters no longer always turn amber at 80% and red at 100%. The overview ring and bar use the organization's configured `budget_warn_ratio` / `budget_pause_ratio`, and the finance page paints from the server's `warned` / `paused` flags, which already applied those ratios.

## Details

- `budgetTone` takes optional warn and pause thresholds, still defaulting to 0.8 / 1.0.
- The overview spend KPI passes the organization's settings through.
- Finance employee meters and the KPI ring follow `warned` / `paused` so a pause at 50% is not still painted healthy.

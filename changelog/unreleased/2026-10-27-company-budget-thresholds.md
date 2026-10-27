
# Honor configured company budget thresholds

- **Date:** 2026-10-27
- **Type:** fix
- **Scope:** `server`, `web`
- **Issue:** [#737](https://github.com/Prism-Shadow/penguin-harness/issues/737)

[中文版](2026-10-27-company-budget-thresholds.zh.md)

Fixed the budget indicators in Company Overview, Finance, and Org Chart to reflect organization-specific warning and pause thresholds instead of fixed percentage boundaries.

## Details

- Passed the configured budget thresholds to Overview's spend ring and budget bar.
- Used server-computed warning and pause states for Finance gauges and employee spend meters.
- Exposed the organization's budget thresholds in the Org Chart response and applied them to employee cards.
- Added regression tests for configured thresholds, server responses, and budget indicator rendering.

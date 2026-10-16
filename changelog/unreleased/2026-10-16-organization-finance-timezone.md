# Organization finance trends use the organization's timezone

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`
- **Issue:** [#738](https://github.com/Prism-Shadow/penguin-harness/issues/738)

[中文版](2026-10-16-organization-finance-timezone.zh.md)

Organization finance trends grouped spending by the organization's calendar days, matching the timezone used for the monthly budget window.

## Daily spending

- Usage near midnight was assigned to the correct local date, including the first and last days of the month.
- Day boundaries followed daylight-saving transitions and fractional UTC offsets.
- Cost-center charts kept their server-local dates. Pricing tiers and monthly totals were unchanged.

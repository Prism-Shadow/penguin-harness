# Organization finance trend counts days in the organization's timezone

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **Issue:** [#738](https://github.com/Prism-Shadow/penguin-harness/issues/738)

[中文版](2026-10-26-org-finance-days-timezone.zh.md)

Fixed the company finance page's daily cost chart labelling its days in the server's timezone while the month it covered was the organization's. Spend near midnight landed on the neighbouring bar, and the first or last bar could name a day outside the month: an `Asia/Shanghai` organization served from a UTC host opened September with a bar for 31 August. Each request now falls on the organization's calendar day, read from the instant it ran, and a daylight-saving change inside the month moves the day boundary with it. The month's totals and each employee's spend were already correct and did not change.

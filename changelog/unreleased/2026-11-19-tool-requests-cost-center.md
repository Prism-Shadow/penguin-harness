# The Cost Center lists tool requests apart from chat Tokens

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `web`, `ui-gallery`, `docs`
- **PR:** [#1616](https://github.com/Prism-Shadow/penguin-harness/pull/1616)

[中文版](./2026-11-19-tool-requests-cost-center.zh.md)

Tool requests are the requests a plugin makes for its tools through `ProjectModelRequests`, such
as an image, a transcription or a search. Their `usage_records` rows carry a `purpose`, and the
Cost Center reads them from that one ledger.

- The Token figures in the summary cards and the Token trend count chat turns only. A tool
  request's Tokens are MMSP's billing units (a search counts as 1,000), so they stay out of these
  figures.
- Requests, cost, the requests charts, success rates and the cost trend include tool requests.
  The summary cards add an **Incl. tool requests** row with their count and cost, and a **Tool
  requests** card below the charts lists them by purpose with their count and cost. Both appear
  only while the range has tool requests.
- A tool request made with no Session counts toward the Project's totals only. It stays out of the
  per-Agent and per-Session groups, the by-Agent requests chart and the Agent filter.
- `GET /api/projects/:projectId/usage` answers `toolRequests` and `toolCost` on each summary
  bucket, and a `tools` list with one row per purpose (`purpose`, `requests`, `cost`,
  `hasUncosted`). The models page's lifetime totals fold a model's chat and tool rows into one
  entry.
- Where two providers sell a model under the same name, the model filter and the by-model chart
  name the provider beside it.
- A cost below a tenth of a cent shows four significant digits instead of rounding to `$0.0000`.

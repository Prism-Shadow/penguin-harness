# A model can price its thinking apart from its other output

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `db`, `docs`
- **PR:** [#1615](https://github.com/Prism-Shadow/penguin-harness/pull/1615)

[中文版](./2026-11-19-thinking-price.zh.md)

A model's `pricing` in `.project_config.toml` takes an optional `thoughts` rate, in USD per million
tokens, beside `cache_read`, `cache_write` and `output`. Without one, thinking is output, as before.

- A request a plugin makes through `ProjectModelRequests` stores the thinking tokens MMSP reports in
  a new nullable `usage_records.thoughts` column. They stay part of `output`.
- Where the model has a thinking rate, the Cost Center, Session cost and company budgets price
  those thinking tokens at it, and the rest of the output at `output`. Chat turns do not report
  thinking apart, so their output is priced at `output` throughout.
- The Gemini Omni 1.2 Flash preset bills thinking at $9 per million tokens instead of its $12 video
  output rate.
- `PUT /api/projects/:projectId/models` accepts and returns `pricing.thoughts`. Like the other
  fields of that full-table write, omitting it removes it. The models page keeps a stored rate when
  it saves. Machine sync carries the rate, and a machine on an older build ignores it.

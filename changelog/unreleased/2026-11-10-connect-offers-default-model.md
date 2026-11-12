# Connecting TokenDance or Penguin Go offers its DeepSeek V4.1 Flash as the default model

- **Date:** 2026-11-10
- **Type:** feature
- **Scope:** `server`, `model-catalog`, `web`
- **PR:** [#1507](https://github.com/Prism-Shadow/penguin-harness/pull/1507)

[中文版](2026-11-10-connect-offers-default-model.zh.md)

When TokenDance or Penguin Go on the Models page becomes connected and the Project's default model is in another group, or there is none, the page asks whether to make that group's DeepSeek V4.1 Flash (`tokendance` / `deepseek-v4.1-flash`, `penguin-go` / `deepseek-flash`) the default. A group becomes connected when its first group key arrives through its connect flow or is saved in its group settings. The question names the current default. **Switch** writes the new default; **Keep current** leaves it as it was. A Project with no default is asked whether to set one. After a connect flow, the question appears when its result dialog is closed. Connecting never changes the default by itself.

Nothing is asked on a reconnect, when another group connects, when the default is already a model of that group, or when the Project no longer holds that row. That last case holds even when Penguin Go's delivery adds the row back.

## Details

- `PUT /api/projects/:p/models/providers/:provider`, the answers of TokenDance's authorization (its poll and its pasted code) and Penguin Go's completed status carry `defaultOffer`: `model`, plus `current` when the Project has a default. A key written through the `providers` of `PUT /models` offers nothing.
- The catalog's group descriptor names the model as `connectDefault`.

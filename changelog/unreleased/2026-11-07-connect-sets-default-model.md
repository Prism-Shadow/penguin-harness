# Connecting TokenDance or Penguin Go makes its DeepSeek V4.1 Flash the default model

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** `server`, `model-catalog`, `web`, `ui`, `ui-gallery`

[中文版](2026-11-07-connect-sets-default-model.zh.md)

When TokenDance or Penguin Go on the Models page becomes connected, the Project's default model becomes that group's DeepSeek V4.1 Flash (`tokendance` / `deepseek-v4.1-flash`, `penguin-go` / `deepseek-flash`), replacing whatever default it had. A group becomes connected when its first group key arrives through its connect flow or is saved in its group settings. The server moves the default in the same write as the key. A notice then names the new default and offers **Undo**, which puts the previous default back. A Project that had no default gets the notice without Undo. After a connect flow, the notice appears when its result dialog is closed.

Nothing moves on a reconnect, when another group connects, when the default already is that model, or when the Project no longer holds that row. That last case holds even when Penguin Go's delivery adds the row back.

## Details

- `PUT /api/projects/:p/models/providers/:provider`, the answers of TokenDance's authorization (its poll and its pasted code) and Penguin Go's completed status carry `defaultSwitch`: `defaultModel`, plus `previousDefault` when there was one. A key written through the `providers` of `PUT /models` does not move the default.
- The catalog's group descriptor names the model as `connectDefault`.
- The shared UI toaster takes an `action` on any toast, a word and what pressing it does, shown in brackets after the text. Such a toast stays as long as one that offers a problem report. The component gallery's toast board shows one.

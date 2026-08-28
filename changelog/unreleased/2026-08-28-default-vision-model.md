# A new Project's default model can read a picture

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `model-catalog`, `core`, `server`, `docs`, `skills`
- **PR:** [#534](https://github.com/Prism-Shadow/penguin-harness/pull/534)

[中文版](2026-08-28-default-vision-model.zh.md)

A new Project defaulted to `deepseek/deepseek-v4-flash`, which is text-only, and a fresh install
sets no `vision_model` either — so a pasted screenshot had no path to being read at all: it was
saved to the scratchpad and handed over as a file path, and the tool that would have described it
ended with "no vision model is configured". The default is now
`deepseek/deepseek-v4-flash-vision-exp`, which reads the image itself.

## Details

- **New Projects only.** A Project's default is copied in at creation and owned by it from then
  on; no write path rewrites an existing one, and "sync presets" never touches the stored
  default. An existing Project switches by picking the model, as it always could.
- The first-run command in the README and in the CLI and SDK quickstarts named the old id with
  `--set-default`, which would have pinned the text-only model back on a fresh install. All six
  lines now name the new default, and the `models` and `configuration` samples, the `vision =
  false` example beside them and the `penguin-sdk` Skill were updated with them.
- The core test now asserts the property rather than the id — that whatever the default names is
  a catalog entry with `supportsVision` — so a future change of default cannot quietly land back
  on a model that declines the first image it is shown.

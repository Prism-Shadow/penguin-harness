# A new Project's default model can read a picture

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `core`

[中文版](2026-08-28-default-vision-model.zh.md)

A new Project defaulted to `deepseek/deepseek-v4-flash`, which is text-only, so the first
screenshot pasted into a fresh install was declined for a reason nothing on screen explained.
The default is now `deepseek/deepseek-v4-flash-vision-exp` — the same context window at the same
published price, with image input on top.

## Details

- The two rows are otherwise identical: 1M context, CNY 0.05 / 1.5 / 4.5, same provider and same
  protocol. The vision revision is a strict superset, so nothing is traded for the capability.
- **New Projects only.** A Project's default is copied in at creation and owned by it from then
  on; nothing rewrites an existing one, and "sync presets" explicitly never touches the stored
  default. An existing Project switches by picking the model, as it always could.
- The core test now asserts the property rather than the id — that whatever the default names
  is a catalog entry with `supportsVision` — so a future change of default cannot quietly land
  back on a model that declines the first image it is shown.

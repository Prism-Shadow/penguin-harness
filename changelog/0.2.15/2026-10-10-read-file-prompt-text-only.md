# read_file offers its `prompt` argument to text-only models only

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `core`, `docs`
- **PR:** [#1018](https://github.com/Prism-Shadow/penguin-harness/pull/1018)

[中文版](2026-10-10-read-file-prompt-text-only.zh.md)

A model that views images is no longer offered `read_file`'s `prompt` argument, the question put to the Project's `vision_model`. Such a model receives the image itself, so the argument went unused. Text-only models still get it.

- Context assembly drops `prompt` from `read_file`'s parameter schema when the Session model views images (its model entry does not set `vision: false`). Like `call_description: false`, the trim works on an in-memory copy and `system_config.yaml` is not rewritten. A model switch re-assembles the toolset, so the schema follows the new model.
- The default `read_file` description no longer mentions `prompt`.
- A kernel change (generation `2026-10-10`, tools tab): an existing Agent whose tools tab is still the built-in default picks the new description up on a kernel update, while one the user has edited keeps its own. The schema trim applies to every config, whatever its kernel.

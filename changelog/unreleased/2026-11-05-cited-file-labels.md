# Employees cite files with a label

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `plugins`, `server`
- **PR:** [#1486](https://github.com/Prism-Shadow/penguin-harness/pull/1486)
- **Issue:** [#1440](https://github.com/Prism-Shadow/penguin-harness/issues/1440)

[中文版](2026-11-05-cited-file-labels.zh.md)

Employees are told to cite a file in a channel message or a desk reply as `[what it is](<app_data_dir>/…)`, so the reader sees a few words and opens the file from the message. The `company-employee` skill moved to `2026.11.05.1`, so organizations already on disk pick it up at their next reconcile.

## Details

- `company-employee` gained a "Cite a file with a label" bullet in "Writing a channel message", and its note on paths points there for anything a person reads.
- The handbook written for a new organization carries the same line in English and Chinese. The handbooks of existing organizations were left as they are.

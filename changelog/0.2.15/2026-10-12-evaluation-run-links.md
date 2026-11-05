# Evaluation Center: each run opens its Session; long case lists page

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1030](https://github.com/Prism-Shadow/penguin-harness/pull/1030)

[中文版](2026-10-12-evaluation-run-links.zh.md)

The Evaluation Center's evaluation details dialog lost its Session column: under each case, **Run #N** became the link to the Session that run ran in. A Session that was archived, and so in no sidebar, opened a note instead, naming its title and ID (with a copy button) and pointing to **Settings › Archived chats**, with a button that opened that page. A run recorded as a Harbor trial kept its label as text, beside the button that copies the trial's name. The case names in the dialog stopped linking to the case details.

A Benchmark page listed each case as one line, its name cut short with the whole of it in the tooltip, ten to a page with a page stepper above the list once there were more.

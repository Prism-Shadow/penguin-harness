# The Runtime tab edits the compaction's tool rounds, reminder and hand-off note

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `server`, `web`, `docs`, `ui-gallery`
- **PR:** [#PR_NUMBER](https://github.com/Prism-Shadow/penguin-harness/pull/PR_NUMBER)

[中文版](2026-11-17-compaction-settings-ui.zh.md)

`compaction.max_rounds`, `compaction.reminder` and `compaction.handoff_note` became editable in the Web App: the Agent settings' **Runtime** tab gained **Max tool rounds**, **Per-round reminder** and **Hand-off note** in its compaction section, saved with the rest of the tab's form.

## Details

- The Agent config API's `compaction` carries `maxRounds`, `reminder` and `handoffNote`. They report effective values: a `system_config.yaml` written before the keys existed reads as the built-in defaults, as core runs it. A PUT writes each key it is sent. `maxRounds` takes an integer of 0 or more, and a blank text is stored blank.
- On the tab, **Max tool rounds** sits beside the compaction method, with its own inline error for a value that is not an integer of 0 or more. The two texts follow the summary prompt, each in its own section. Their hints name the placeholders they take and say what a blank means: no reminder is sent, or the note keeps only the quoted data.
- A server that does not report the three fields, such as an older one on a machine, shows none of them.
- The configuration docs say that saving one of the three on the Runtime tab writes it into the file.

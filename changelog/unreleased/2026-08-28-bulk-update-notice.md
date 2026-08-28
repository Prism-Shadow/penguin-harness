# One notice block on every page that has updates waiting, with an update-all button

- **Date:** 2026-08-28
- **Type:** feature
- **Scope:** `web`
- **PR:** [#529](https://github.com/Prism-Shadow/penguin-harness/pull/529)
- **Issue:** [#527](https://github.com/Prism-Shadow/penguin-harness/issues/527)

[中文版](2026-08-28-bulk-update-notice.zh.md)

The page notice that says what a nav dot was pointing at is now one shared block on all four
pages that carry one, and on Agents, Skills and Models it can act on everything it counts in a
single press instead of leaving the user to update the objects one at a time.

## Details

- The Agents page gained the block it never had. Its kernel trail became dismissible like the
  other three, so an Agent deliberately left on the defaults generation it was tuned against no
  longer keeps a red dot lit; the gate moved from `update-badges.ts` to `todo-badges.ts` and
  gained a signature, and a newly outdated Agent still raises the dot.
- Each block states what its page can honestly count. Models reports two numbers — entries the
  table lacks and entries whose catalog-owned fields have moved — read straight off the delta the
  sync action itself computes. Agents and Skills report one: an Agent's kernel is never new, and
  a Skill nobody has installed is not waiting for anyone. The Cost Center keeps its single
  "mark as read" control, because a past error is not something that can be updated.
- The bulk button confirms before it writes, in each page's existing words: an Agent kernel
  update is a smart merge that advances the untouched settings tabs and leaves the customized
  ones whole; a Skill update is an overwriting reinstall that drops local edits; a preset sync
  rewrites the catalog-owned fields and leaves locally added models and API keys alone. Every
  dialog lists exactly which objects the batch would write to.
- A partial failure now names the targets that did not take the write, rather than reporting the
  first error alone.
- The per-item paths are unchanged: "sync presets", the per-card Skill update buttons and the
  per-Agent kernel update in settings all still do what they did.

## Compatibility

The dismissal markers stored per user under `ui_prefs.todoDismissed` gained a fourth key,
`agents`. A map written before this change simply has no such key, which reads as "nothing
dismissed" — the Agents block appears once and can be dismissed again. Nothing needs migrating
and no stored marker is lost.

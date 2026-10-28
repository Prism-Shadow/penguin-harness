# Machine cards say their state in a labelled pill, and the Machines page lives in the shared UI package

- **Date:** 2026-10-15
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1153](https://github.com/Prism-Shadow/penguin-harness/pull/1153)

[中文版](2026-10-15-machine-status-pill.zh.md)

A machine card on the Machines page no longer marks its state with an unexplained coloured dot.
Every card shows a status pill with the state's word and a glyph in its tone — the same pill the
Machine dialog's header wears — and the reason behind it (a failure in the far side's words, ssh's
diagnostic, the line a job is on) on the pill's hover and in its accessible name. A connected
machine now reads 「运行中」 / "Running", the word this server's own card wears, instead of
「已连接」 / "Connected".

## Details

- The installed version moved from the card's title row to its stats line, so the title row
  carries at most two capsules beside the name (this server's tag or the update pill, and the
  status pill).
- The Machines page's presentation is now the shared UI package's (`@prismshadow/penguin-ui`):
  the status pill and its state-to-look mapping, a job's stepper, the machine card, the machines
  list with its loading placeholders, the Machine dialog's toolbar, and the add dialog's body,
  host list, host row and footer. They take every word and state as props; the Web App keeps the
  data wiring in `features/machines/`, whose modules and exports are unchanged.
- The UI gallery has a Machines topic showing the pill in every state, a card for each state a
  machine can be in, the list loading, the toolbar with a held verb, and the add dialog.
- The frontend skill records the rule: a status is a labelled pill or an icon whose tooltip and
  accessible name say it, never a bare coloured dot.

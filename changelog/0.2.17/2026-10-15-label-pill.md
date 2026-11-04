# Machine state pills are words alone, and short labels share one pill shape

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1162](https://github.com/Prism-Shadow/penguin-harness/pull/1162)

[中文版](2026-10-15-label-pill.zh.md)

A machine's status pill no longer carries a glyph: "Running" and every other state is its word in
its tone. It now has exactly the shape of the "this server" tag beside it, both drawn by the shared
UI package's new label pill, `Pill`, which differs between labels only by tone.

## Details

- `Pill` is the badge at its small size in its soft weight with no other options: the same
  height, padding, radius, type and border for every tone, a word with no glyph, and an optional
  hover sentence.
- On the Machines page and in the Machine dialog, the status, this server's tag, the version and
  the "installed by another Project" note are `Pill`s. The update pill beside them takes the same
  shape, on Agent cards too.
- The model library's tags (default, vision, free, recommended), the model picker's tags, the
  archived conversations' source pill, an Agent's version, the Benchmark case browser's "hidden from
  the Agent under test" and the company status in the company header render through `Pill`, as
  do the small labels that already had its look: a goal's status, a channel's "@me", the
  handbook's index mark, a Trace round's compaction mark and task number, the release notes'
  "current", and an Agent form's "recommended".
- The UI gallery shows the label pill in every tone and as a card's row of labels.

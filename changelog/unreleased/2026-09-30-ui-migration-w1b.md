# Hand-drawn spinners, pulses and look-alike glyphs give way to the shared components

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `web`

[中文版](2026-09-30-ui-migration-w1b.zh.md)

The de-slop batch of the UI package migration replaced the Web App's hand-drawn busy rings, hand-rolled pulses, `transition-all` and near-copies of registry glyphs with the shared package's `Spinner`, `Dot` and `ICONS`.

## Details

- **Spinners:** twelve hand-drawn rings became the package's `Spinner`: the update dialog and the account-menu update row, loading earlier history, the subagent row, the Files panel's upload and save, the model page's sign-in wait, the protocol picker and the three detect buttons, and the id generator. The detect buttons and the id generator's button show it through `Button`'s `loading`.
- **Pulses:** the chat panel's running-process dot, the org chart's running state and the conversation outline's "answering" preview take `Dot` with `pulse`. The fork button shows the `Spinner` while the fork runs, where its glyph used to pulse.
- **Transitions:** the session rows' hover buttons, the sidebar's draft-delete and group-pin buttons, and the outline's ticks name the properties they animate instead of `transition-all`.
- **Glyphs:** the tapered bin (memory, skills, hooks, benchmark, model and agent pages) draws `ICONS.trash`; the memory tab's edit pen draws `ICONS.penLine` and the finance page's budget pencil `ICONS.pencil`.
- The web de-slop and glyph-path guard lists dropped every entry this batch cleared.

## Visible changes in the default theme (Primer)

- Spinners look alike everywhere: one arc on a faint track at 10, 12 or 14 px, in place of rings with 1–2 px borders. The update dialog's and the update row's spinners lost their 70% opacity.
- Pulses are the `Dot`: the running-process dot and the org chart's dots take the tones' solid fills (success emerald-500 → emerald-700), and the chart's expanding ping halo is gone. The outline's "answering" preview shows a pulsing dot before the words instead of pulsing the text.
- The trash and pencil glyphs are unified: the tapered bin became the registry's straight-sided bin, and the memory tab's pen and the finance page's pencil became the registry's pen and pencil.
- The outline's active tick changes length without easing; its colour still eases.

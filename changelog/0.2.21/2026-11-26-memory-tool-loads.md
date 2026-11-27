# Memory opened beside a conversation shows the Agent's memory again

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1906](https://github.com/Prism-Shadow/penguin-harness/pull/1906)

[中文版](2026-11-26-memory-tool-loads.zh.md)

Memory opened from a conversation's Shortcuts stopped staying on its loading state, on this server and on a machine alike. The conversation began counting the Memory tool docked beside it as the Memory panel being open, so the tool read the Agent's memory as soon as it opened, from the machine the conversation is on, and a listing that could not be read showed its failure with Report.

## Details

- The dock store gained `isPanelOpen`, which counts a panel's own tab and a Session tool standing in for it alike.
- The chat page took the Memory listing's fetch, and the reset of the Files, Memory and Agents jump commands, from `isPanelOpen`. A jump command also began resetting when its Session tool closed.
- `dock.spec.mjs` gained a scenario that opens Memory from Shortcuts over a seeded memory, then again with the listing failing.

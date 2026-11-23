# The compaction notice says what the provider refused

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `web`, `docs`
- **PR:** [#1630](https://github.com/Prism-Shadow/penguin-harness/pull/1630)

[中文版](2026-11-19-compaction-notice-reason.zh.md)

When the provider refuses a request and the conversation continues from a Trace hand-off note, the
notice above the composer now leads with the provider's own words, then gives the advice. The
**Compacted** row's status mark names the cause first, for every error code.

## Details

- The notice has two lines. The first reads "The provider refused the last request:" followed by
  the provider's message, clamped to two lines with **Expand** when it runs longer, and
  **Details**, which opens the request-failure dialog for this refusal: the whole message, Copy,
  and the prefilled GitHub issue. A message that is a JSON body shows only the sentence it holds
  for a person (`error.message`, else `message`, `error` or `detail`); plain text shows as it
  came, and **Details** keeps the raw body. When the provider sent no message, the first line ends
  in a full stop and stands alone.
- The second line states what happened, then the likely cause: "This conversation continued from
  a Trace hand-off note. Most likely too little room was left for compaction: …", since the
  provider's words above it may name another cause.
- **Details** shows on the main conversation page, which has the failure dialog. A composer
  without it shows the words without the press.
- The row's tooltip and accessible name read one line each: the cause in the retry line's words
  with the HTTP status the message names, then the error's own words (or those words alone for a
  code with no wording); then that no full summary could be written; then, when too little room
  was left (`rejected` or `output_truncated`), the likely cause and what to correct ("Most likely
  too little room was left for compaction: …"). Before, the advice came first and
  only a refusal quoted the provider.
- The failure report gains a hand-off phase: "the provider refused the request, and the
  conversation continued in a new context from a Trace hand-off note", with the model, the time
  and the provider's message, redacted as every report is.
- The [Agent Loop](https://penguin.ooo/docs/agent-loop) docs page describes the new notice and
  tooltip.

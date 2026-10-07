# `penguin chat` marks its prompts for terminals

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `cli`, `docs`
- **PR:** [#1003](https://github.com/Prism-Shadow/penguin-harness/pull/1003)

[中文版](2026-10-07-chat-prompt-marks.zh.md)

On a terminal, `penguin chat` wrote the OSC 133 semantic prompt sequences that shells write for
shell integration. A terminal that supports them could jump between the chat's prompts and select
one turn's output, and a program running the chat in a terminal of its own could tell when the
chat was back at its prompt and took input, without matching the prompt text.

## Details

- `A` was written where the `> ` prompt started and `B` where input started after it. The
  continuation prompt, the approval question and the exit confirmation were not marked.
- `C` was written when a submitted prompt's turn started, including `/compact`, `/clear`,
  `/switch-model` and `/goal`, and `D;0` when it ended, or `D;1` when it ended in an error.
  Commands answered locally, such as `/thinking` and `/verbose`, ran no turn and were not
  enclosed.
- Nothing was written when stdin was not a terminal.
- The CLI page described the marks, in both languages.

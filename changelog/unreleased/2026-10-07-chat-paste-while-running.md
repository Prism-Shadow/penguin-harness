# A paste in `penguin chat` while a Task runs is kept, not dropped

- **Date:** 2026-10-07
- **Type:** fix
- **Scope:** `cli`, `docs`
- **PR:** [#1001](https://github.com/Prism-Shadow/penguin-harness/pull/1001)

[中文版](2026-10-07-chat-paste-while-running.zh.md)

On a terminal, `penguin chat` dropped a bracketed paste that arrived while a Task was running: the
text never reached the model and nothing on screen said so, although a typed line in the same
moment became steering. That included a paste made just as a Task ended, before the REPL was back
at its prompt. A paste was made to behave like typed text in every state that takes a message.

## Details

- While a Task ran, a paste was echoed through the renderer and waited for Enter, which sent it
  as one steering message, all of its lines together. Streamed output was held while it waited,
  as for a half-typed line, and stayed held after an approval question was answered meanwhile.
- When the Task ended before Enter, the paste stayed under the continuation prompt and the next
  Enter sent it as the next prompt; previously the return to the prompt cleared it.
- A typed line ending in `\` continued the message mid-run as it already did at the prompt.
- A paste during an approval question or the exit confirmation was still ignored: those take a
  typed y/N answer.
- The CLI page's REPL table described steering by paste, in both languages.

# Session titles stop answering the conversation, and follow its language

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#489](https://github.com/Prism-Shadow/penguin-harness/pull/489)

[中文版](2026-08-26-title-prompt-language.zh.md)

The prompt behind an automatically generated Session title was rebuilt as an instruction about
a piece of text rather than as a conversational turn. A conversation opening with `你好` was
titled `你好！有什么可以帮你的吗？` — the model answered the material instead of naming it — and an
English conversation could come back with a Chinese title.

## Details

- The conversation material was fenced in a `<conversation>` block, with `<user>` and
  `<assistant>` inside it, and declared to be data: not to be replied to, not to be acted on,
  and not a source of instructions. That last declaration also took away a conversation's
  ability to steer a request that runs with no system prompt of its own.
- Both elements were kept even on a first turn, where there is no assistant text: the
  `<assistant>` element was filled with `(the assistant has not replied yet)`, and a rule
  shipped alongside it to say that the line records a turn that has not happened, that the
  user's request is to be titled alone, and that the absence is never itself the title. A lone
  user utterance inside the fence has the shape of a question put to the reader, which is the
  shape the rest of the prompt is arranged against. The marker was written in the prompt's
  instruction language, so it cannot pull the title away from the language of the user's text.
- The demand was moved after the material, and the prompt was given a bare `Title:` lead-in to
  end on, whose only sensible continuation is a title. The empty `<think></think>` block that
  closes a reasoning model's thinking phase went directly above that lead-in, and the rule
  suppressing chain-of-thought was worded to ask for the title rather than for an "answer" —
  the verb every rule around it is spent suppressing.
- The language rule was stated as a mapping and anchored to the **user's** text — English user
  text gets an English title, Chinese user text gets a Chinese title, never a translation — so
  an assistant reply in another language stopped deciding it.
- Material carrying no topic (a greeting, an "ok", a lone emoji) was given a rule of its own:
  name the act, `"hi"` → `Greeting` and `"你好"` → `打招呼`. The two examples close the bullet, so
  nothing is punctuated onto either exemplar — a `Greeting;` shown as a model output
  demonstrates precisely the trailing punctuation the next rule forbids.
- A `<conversation>`, `<user>` or `<assistant>` tag written inside the material itself was
  rewritten to square brackets, so the fence cannot be closed from within the excerpt. The
  substitution preserves length, leaving the 2000-character excerpt budget unchanged.
- A `Title:` / `标题：` label restated by the model was dropped from its output, along with
  whatever decorated the label: a chat-tuned model asked to continue `Title:` answers
  `**Title:** …` about as readily as bare. The strip was put on the request path rather than in
  `sanitizeTitle`, because the lead-in that provokes it lives there too — `sanitizeTitle`'s
  other caller cleans the user's own first line, where a `Title:` is part of what they wrote.
- `sanitizeTitle` learned to strip markdown decoration — `**`, `#`, backticks, `~`, a list dash
  — from the front of a title, and all of it but a closing `#` from the end: a title can end in
  one legitimately (`Learning C#`), while the closing `#` of an ATX heading is not something a
  chat model writes.
- The plain character cut `sanitizeTitle` capped a long title with was replaced by the
  word-boundary and surrogate-pair-aware cut the host's fallback title already used. That cut
  moved into core as `truncateTitle` and both paths now call it, so an emoji straddling the
  30-character boundary no longer leaves behind a lone surrogate — which has no UTF-8 encoding,
  and reaches SQLite and the SSE frame as U+FFFD — and a title cut at a space no longer keeps
  the space.

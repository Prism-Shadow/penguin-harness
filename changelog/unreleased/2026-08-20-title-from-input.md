# Session titles generate from the user input alone, with an immediate fallback

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `server`
- **PR:** [#367](https://github.com/Prism-Shadow/penguin-harness/pull/367)

[中文版](2026-08-20-title-from-input.zh.md)

Reworked automatic Session title generation so it never waits for model output. The moment a Task starts with user text, the first words of that text are persisted as a fallback title and pushed to the UI; the LLM title request fires at the same time, in the background, with the user input as its only material, and replaces the fallback when it lands. Previously the title appeared only after enough of the answer had streamed (or the Task finished), and the generation prompt could include assistant text.

## Details

- The fallback truncation became word-aware: long English input is cut at a word boundary instead of mid-word, CJK input is cut per character, and leading punctuation no longer consumes the length budget.
- A manual rename is final: the LLM result only ever replaces the fallback the generator itself wrote, and while that fallback is still standing after an LLM failure, the next Task start retries the request.
- A subagent's title now generates at registration, from the `run_subagent` prompt that spawned it, instead of at the end of the parent's run from the subagent's collected output — subagent titles appear while the run is still going.
- `session_title` now also rides the user-level event channel (the same delivery `session_state` uses), and the Web routes it into the session list from there; the draft flow re-fetches the row after the first task starts. Start-of-run titles fire before the new conversation's own channel has any subscriber, so without these the list kept showing the "New chat" placeholder.

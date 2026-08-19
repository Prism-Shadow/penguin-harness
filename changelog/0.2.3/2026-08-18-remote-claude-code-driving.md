# remote-claude-code skill v2: verbatim relay and capture-verified keystrokes

- **Date:** 2026-08-18
- **Type:** process
- **Scope:** `skills`, `docs`
- **PR:** [#317](https://github.com/Prism-Shadow/penguin-harness/pull/317)
- **Issue:** [#307](https://github.com/Prism-Shadow/penguin-harness/issues/307)

[中文版](2026-08-18-remote-claude-code-driving.zh.md)

The `remote-claude-code` library skill moved to v2, closing four gaps reported from real relayed sessions: the local agent answering in Claude Code's place, a "model + level" switch request read as one unknown model name, batched key sequences racing the TUI, and post-run suggestion text mistaken for the user's pending input. Troubleshooting rows, the verification checklist, the skill's frontmatter description and the bilingual `skills` docs tables were updated in sync, and a contract test was added over the new rules.

## Relay contract

- A new "Relaying a conversation" section made the relay literal: once a session is up, user messages reach Claude Code word-for-word, the local agent neither answers nor rephrases nor performs any part of the task itself, and it acts directly only on session control — switches, interrupt, attach and detach.
- Tool-permission prompts, clarifying questions and plan approvals became the user's call, carried out to the user and answered with the key they choose. The previous instruction to answer them through `send-keys` as they appeared was removed, and `--dangerously-skip-permissions` stayed the one standing approval.
- A message arriving mid-turn is held until the turn ends, or sent after a single `Escape` when the user wants the run stopped; a `capture-pane` failing with `can't find pane` or `no server running` was made a recognized dead session, rebuilt with `claude --continue`.
- Replies are read with scrollback (`capture-pane -p -S -200`) rather than a `tail` that returns a fragment, and the task/control boundary was drawn by subject: questions about the session are answered from a capture, everything about the work is forwarded unchanged.
- Input-line text surviving the end of a turn was documented as a Claude-generated suggestion that a capture cannot tell apart from real uncommitted input — never to be submitted, never to be reported as the user's unsent draft, and cleared by typing the new message.

## Verbatim transport

`send-keys -l` delivers an embedded newline as Return, splitting one user message into two Claude Code turns, and lets tmux's command parser swallow a `;` that ends the argument. Multi-line, long and punctuation-heavy messages were moved onto `load-buffer` plus `paste-buffer -d -p` from a quoted heredoc, and the delivery check was made exact — the input line must show the message and nothing else — with named recoveries for a merged line and for a paste that submitted itself.

## Keystroke stepping

Batched sequences such as `send-keys Up s` race the TUI and land keys on the previous selection. Every menu, picker and dialog was put under one key per `send-keys` call, a `capture-pane` between keys, and the expected state confirmed before the next key, bounded by an explicit failure branch: re-send a swallowed key once, correct a wrong move with the opposite key, and after two failed corrections stop and show the user the screen instead of improvising further keystrokes. The conversation examples in section 3 were split into text and Enter with a capture in between.

## Model and thinking level switches

"switch to fable5 max" was specified as two settings — the model and the thinking level — instead of one unknown model name, and is never forwarded as chat text. The rule was written for the shape of the request rather than that one example: it covers any language, including the Chinese phrasings the report was filed in, as well as level-only and model-only requests, with the level vocabulary spelled out and a closing capture required to show the requested value changed and the untouched one unchanged.

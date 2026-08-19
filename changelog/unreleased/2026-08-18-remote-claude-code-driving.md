# Remote Claude Code skill: relay verbatim, one keystroke at a time

The `remote-claude-code` library skill (v2) closes four gaps reported from real relayed sessions (#307): the local agent answering in Claude Code's place, "model + level" switch requests read as one unknown model, batched key sequences racing the TUI, and post-run suggestion text mistaken for pending user input.

## What changed

- **Pure relay contract** — a new "Relaying a conversation" section: once the session is up, user messages go to Claude Code word-for-word; the local agent never answers, rephrases, or does any part of the task itself, and only acts on session-control requests (switches, interrupt, attach/detach) directly.
- **Model and thinking level are two settings** — "switch to fable5 max" means switch the model (Fable 5) AND the thinking level (max); never one unknown model name, never forwarded as chat text. The rule is written for the shape of the request rather than that one example: it fires in any language (including the Chinese phrasings the issue itself was filed in), on level-only and model-only requests, with the level vocabulary spelled out, and the final capture must show the requested value changed and the untouched one unchanged.
- **One keystroke at a time** — batched sequences (`send-keys Up s`) race the TUI, landing keys on the previous selection. New rule for every menu/picker/dialog: one key per `send-keys` call, `capture-pane` between keys, confirm the expected state before the next key — with a bounded failure branch when the capture shows the expected state was not reached (re-send a swallowed key once, correct a wrong move with the opposite key, and after two failed corrections stop and show the user the screen instead of improvising more keystrokes). The section-3 conversation examples now split text and Enter with a capture in between.
- **Post-run composer text is a suggestion** — after a turn finishes, input-line text is usually a Claude-generated suggested next message and a capture cannot reliably distinguish it from real uncommitted input: never submit it or report it as the user's unsent draft; typing the new message makes the suggestion disappear on its own.

## Making the relay hold up in practice

The relay contract only means something if the transport preserves the message and the surrounding rules don't contradict it, so the same pass closes the gaps around it:

- **Verbatim survives the transport** — `send-keys -l` delivers an embedded newline as Return (splitting one user message into two Claude Code turns) and lets tmux's command parser swallow a `;` that ends the argument. Multi-line, long or punctuation-heavy messages now go through `load-buffer` + `paste-buffer -d -p` from a quoted heredoc, and the "it landed" check is exact — the input line must show the message and nothing else, with named recoveries for a merged line and for a paste that submitted itself.
- **Permission prompts are the user's call** — the previous "answer them through `send-keys` as they appear" contradicted the new relay contract, so tool-permission prompts, clarifying questions and plan approvals are now carried to the user and answered with the key they choose; `--dangerously-skip-permissions` stays the one standing approval.
- **Mid-run messages, interrupts and dead sessions** — a message arriving while a turn is running is held until the turn ends (or `Escape` once, never twice, when the user wants to stop now); a `capture-pane` that fails with `can't find pane` / `no server running` is recognized as a dead session and rebuilt with `claude --continue` instead of silently relaying into a context-less one.
- **Reports aren't truncated, and session questions are answered locally** — replies are read with scrollback (`capture-pane -p -S -200`) rather than a `tail` that hands back a fragment, and the task/control boundary is drawn by subject: questions about the session are answered from a capture, everything about the work goes through unchanged.

Troubleshooting rows and verification-checklist items cover all of it; the skill's frontmatter is bumped to `version: 2` / `updated: 2026-08-18`.

# Remote Claude Code skill: relay verbatim, one keystroke at a time

The `remote-claude-code` library skill (v2) closes four gaps reported from real relayed sessions (#307): the local agent answering in Claude Code's place, "model + level" switch requests read as one unknown model, batched key sequences racing the TUI, and post-run suggestion text mistaken for pending user input.

## What changed

- **Pure relay contract** — a new "Relaying a conversation" section: once the session is up, user messages go to Claude Code word-for-word; the local agent never answers, rephrases, or does any part of the task itself, and only acts on session-control requests (switches, interrupt, attach/detach) directly.
- **"switch to fable5 max" is two settings** — a model name plus a level word means switch the model (Fable 5) AND the thinking level (max); never one unknown model name, never forwarded as chat text. Both values are capture-verified before reporting done.
- **One keystroke at a time** — batched sequences (`send-keys Up s`) race the TUI, landing keys on the previous selection. New rule for every menu/picker/dialog: one key per `send-keys` call, `capture-pane` between keys, confirm the expected state before the next key. The section-3 conversation examples now split text and Enter with a capture in between.
- **Post-run composer text is a suggestion** — after a turn finishes, input-line text is usually a Claude-generated suggested next message and a capture cannot reliably distinguish it from real uncommitted input: never submit it or report it as the user's unsent draft; typing the new message makes the suggestion disappear on its own.

Troubleshooting rows and verification-checklist items cover all four; the skill's frontmatter is bumped to `version: 2` / `updated: 2026-08-18`.

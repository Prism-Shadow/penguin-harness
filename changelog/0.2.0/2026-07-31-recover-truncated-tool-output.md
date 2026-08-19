# Core: truncated tool output remains recoverable within its Session

- **Date:** 2026-07-31
- **Type:** feature
- **Scope:** `core`, `web`
- **PR:** [#145](https://github.com/Prism-Shadow/penguin-harness/pull/145)

[中文版](2026-07-31-recover-truncated-tool-output.zh.md)

Tool output still obeys each entry's `maxOutputLength` exactly as before: the Web/CLI stream, the complete `tool_call_output`, Trace, and the next model input remain byte-for-byte aligned, with truncation and terminal markers staying outside the cap.

When a tool call in an Agent Session actually exceeds that cap, Environment now also saves the text it received to the Session scratchpad (`scratchpad/<sessionId>/truncated-tool-output/`, created only on actual truncation, private permissions where the platform has them) and appends the recovery path to the same tool result seen by the frontend and the model. No model-facing tool or schema is added: the model inspects the file with the existing `read_file` (`offset`/`limit`) or targeted `rg`/`tail` commands.

The wiring is one generic Environment parameter rather than a feature-specific manager: `EnvironmentConfig.sessionScratchpadDir` names the Session-scoped storage root, Environment derives `truncated-tool-output/` from it internally, and the new `sessionScratchpadDir()` path helper becomes the single definition of `scratchpad/<sessionId>` (input images and the goal file already lived there and now derive from the same helper). Agent composition passes it automatically; standalone SDK embedders omit it and keep the previous truncation-only behavior, or opt in by passing a directory — no archive class crosses the public config surface.

The model-visible path is a plain absolute path, always the last element of the note — and the spelling rule now covers every path core composes for the model, through one `modelVisiblePath` helper exported from the package barrel: the system prompt's App Data Dir and CWD lines, `[attached image: …]` lines, the server's `[attached file: …]` lines, and the goal-file line. On Windows that spelling uses forward slashes: `exec_command` runs through (Git) Bash and Node's fs APIs accept them, so the model can re-emit the same spelling into JSON tool arguments and shell commands without backslash-escaping mistakes; harness paths are ordinary absolute paths (never `\\?\`-prefixed), so the swap is lossless, and POSIX paths pass through unchanged.

File tools stay compatible with Windows spellings on the consuming side: `path.resolve` accepts `C:\…` and `C:/…` alike (pinned by win32-only tests), tool messages echo the caller's own spelling, and the one system-composed path in tool output — `read_file`'s not-found workspace hint — uses the model-visible spelling too. The Web App's file cards follow suit: workspace-prefix stripping previously required the assistant's separators to match the Workspace's exactly, so on a Windows Workspace the forward-slash spelling produced no card at all; it now compares both sides on `/` with a case-insensitive drive letter, while POSIX Workspaces still never touch backslashes (legal filename characters there).

Each call archives at most 8 MiB — one byte under `read_file`'s 8 MiB scan cap, so the tool's final zero-byte read can still confirm end of file. Larger calls keep UTF-8-safe head/tail windows with an explicit `[archive middle truncated]` gap. Capture memory is bounded (Buffer chunks while exact, a fixed-capacity ring tail after promotion), surrogate pairs split across stream deltas are rejoined, and this is a per-call bound only: a Session has no aggregate archive quota. Recovery preserves what Environment received; text a producer already dropped upstream (e.g. an `[..., N chars of earlier output dropped ...]` marker from a bounded unread buffer) is not recoverable.

Recovery files contain unredacted tool text and live and die with the Session scratchpad — the existing explicit Session-deletion path removes them; no separate cleanup lifecycle is added, which can increase local at-rest retention of accidentally read sensitive data. Trace stores the same truncated result and absolute path, not a second copy of the archived bytes. An archive-write failure never changes the tool's `stop_reason`; the visible note and stderr warning carry a short errno code, not the path or raw error.

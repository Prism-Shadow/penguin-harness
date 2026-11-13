# A failing model request reads like the "[Aborted]" line, and its details can be copied or filed on GitHub

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `ui`, `web`, `ui-gallery`, `tooling`
- **PR:** [#1386](https://github.com/Prism-Shadow/penguin-harness/pull/1386)

[中文版](2026-10-29-retry-row-style.zh.md)

Every state of a model request's retry is now one muted line of text in the conversation, in the shape of "[Aborted]: aborted during reconnect backoff": a bracketed label, where it stands, and the cause in short, with bracketed text actions after it. "[Retrying]: attempt 2/10 in 2 s (network or service temporarily unavailable, HTTP 503) [Retry now] [Stop retrying] [Details]", then "[Retried]: attempt 2/10 sent (…)" once it went out, and "[Failed]: all 6 requests failed (…) [Retry] [Details]" when the run ends on it. Nothing hides behind a "?" any more. Details opens a dialog with a failure report to copy or to file as a GitHub issue.

## Details

- The line names the cause in words and the HTTP status when the provider's message names one; the provider's own message is in the details, not on the line. A fatal error's line reads the same way ("[Error]: the model request failed (credentials rejected, HTTP 401) [Retry] [Details]"). The countdown's seconds keep the width of the wait's widest number, so the line does not move from 10 s to 9 s.
- The details dialog (`ReportDialog`, new in `packages/ui`) shows the report as it would be shared, in English: what happened (the attempts so far, of how many), the error code and the request's status, the HTTP status and the request id when the provider's message names them, the provider and the model, the time in UTC, the PenguinHarness version, how it is installed (desktop app, server, or source checkout), the OS of the machine the Session runs on, and the provider's message. Key-shaped strings (`sk-…` keys, bearer tokens, `api_key=…` and similar named secrets, URL credentials, UUIDs, long random tokens) are taken out of the message, and the Workspace's path is replaced. No API key, base URL, prompt or conversation text is in it.
- Copy puts the report on the clipboard as Markdown. "File an issue on GitHub" opens the project's bug report form with its title, What happened (the failure), System info (version, how it is installed, OS) and Error output (the provider's message) filled in, so it can be submitted as it opens; a long provider message is cut to keep the link short, and the cut says so. In the desktop app the form opens in the system browser.
- The bug report form is bilingual (English and Chinese) and shorter: What happened and System info are the only required fields; Steps to reproduce, Error output and Others are optional, and the dropdowns are gone.
- Every press on these lines is a bracketed text action ("[Retry]"): a real button named by its word, now the one look of `TextAction`. The same look applies to the presses of the machine retry rows, the load-failure notice and Expand.
- The machine cards' retry row says its last failure after the sentence, in the muted ink, instead of behind a circled "?". `RetryStatus` is now the machine rows' alone; its `reasonTitle`, `reasonPlacement` and `frame` props and the `retried` phase are gone.
- When earlier messages fail to load at the top of a conversation, the chat shows a notice line, "[Load failed]: could not load earlier messages (…) [Retry]", instead of a red sentence that was itself the button. A folded tool output or thinking block whose full text could not be fetched says so the same way: "[Load failed]: could not load the full text (…) [Retry]".
- A new shared notice, `LoadFailed`, stands in for content that could not be loaded. When a conversation's history fails to load, the chat shows the danger cross, "Could not load the message history", the error on its own muted line, and Retry. A conversation on a machine that is out of reach uses the same notice with the machine's glyph.
- The gallery's Retry board shows every state of the conversation's lines, the details dialog, the machine rows and cards, and both forms of the load-failure notice.

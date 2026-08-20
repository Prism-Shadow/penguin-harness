# Service links on the background-process list

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`

[中文版](2026-08-20-process-service-url.zh.md)

The session details card's background-process list now shows the service URL a live process announced, as a clickable link next to its pid — a dev server the conversation started is one click away instead of a copy-paste from the transcript.

## Details

- The URL is detected from the transcript the page already holds: exec_command's promotion note and input_command's `process_id` argument bind a tool output to its process, and the last local URL that output printed (`localhost`, `127.0.0.1`, `[::1]`, or the listen-side wildcards `0.0.0.0` / `[::]`, the wildcards rewritten to `localhost`) becomes the row's link. ANSI color wrapping is stripped before matching, and nested subagent conversations are scanned too.
- Remote hosts are ignored — a URL in a log line pointing off-machine is not the process's own service.
- Exited rows carry no link: the service died with the process. The link opens in a new tab; the full URL sits in the tooltip while the row shows it without the scheme.

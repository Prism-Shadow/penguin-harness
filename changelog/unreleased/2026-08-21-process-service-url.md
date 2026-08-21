# Service links on the background-process list

- **Date:** 2026-08-21
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#376](https://github.com/Prism-Shadow/penguin-harness/pull/376)

[中文版](2026-08-21-process-service-url.zh.md)

The chat page's background-process list now shows a clickable link to the service a running process serves, next to its pid. Detection lives in core and has two sources: the command session scans its own output stream incrementally for local URLs (ANSI-stripped, wildcard hosts normalized to `localhost`, the latest hit wins — covering foreground and background runs alike, with no dependence on the model polling), and when the process printed no URL, a listen-port probe of its process group synthesizes `http://localhost:<port>` (linux `ss`+`ps`, macOS `lsof -g`, Windows `Get-NetTCPConnection` + the CIM process tree; multiple ports collapse to the smallest).

## Details

- The printed URL (which may carry a path) always outranks the probed origin. Probes run when the processes list is fetched, TTL-cached per session with a hard per-probe timeout; a failed probe keeps the previous result, a successful empty one clears it.
- The processes API's rows gained an additive optional `serviceUrl`; the Web App renders it on running rows only, opening in a new tab.

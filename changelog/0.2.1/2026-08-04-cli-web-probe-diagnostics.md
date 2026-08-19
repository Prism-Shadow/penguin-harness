# CLI: `penguin web` reports readiness-probe failures

- **Date:** 2026-08-04
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#169](https://github.com/Prism-Shadow/penguin-harness/pull/169)

[中文版](2026-08-04-cli-web-probe-diagnostics.zh.md)

`penguin web` used to discard every readiness-probe exception and print the same generic "not responding yet" line, which read as the server being slow even when the real cause was a firewall silently dropping loopback requests. The probe now retains the last nested Node/undici error, classifies it (connection timeout, refused, reset/socket, permission, DNS, unknown), and prints an actionable, localized diagnosis on stderr — the timeout case asks the user to allow PenguinHarness to communicate on the configured local port rather than telling anyone to disable a firewall. Any HTTP response still counts as ready, and the classification is covered by focused unit tests.

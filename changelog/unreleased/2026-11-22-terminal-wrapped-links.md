# Wrapped terminal URLs open in full

- **Date:** 2026-11-22
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#1698](https://github.com/Prism-Shadow/penguin-harness/pull/1698)

[中文版](2026-11-22-terminal-wrapped-links.zh.md)

Clicking any part of an HTTP or HTTPS URL that the terminal wraps across rows opens the full address, including its query and fragment. Reconnecting to a terminal preserves those wraps. URLs on separate output lines stay separate.

In side-by-side tmux panes, a vertical divider separates each pane’s URLs. A plain URL fragment that reaches the edge of a pane stays plain text when the next row could be a continuation.

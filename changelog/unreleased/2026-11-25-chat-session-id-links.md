# Session ids in chat become links that open the conversation

- **Date:** 2026-11-25
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1876](https://github.com/Prism-Shadow/penguin-harness/pull/1876)

[中文版](2026-11-25-chat-session-id-links.zh.md)

Session ids written in conversation text, tool output and Markdown now render as links: clicking one opens that conversation at `/chat/<sessionId>`.

## Details

- User messages and organization notices split their prose on session ids and render each id as a link; Markdown bodies and inline code in organization conversations recognize session ids the same way, with or without a project scope.
- A session id standing on a line of its own in a tool call's output renders as a jump badge under the card: deduplicated, at most five, none while the output is folded or still streaming, none for a bound subagent's card.
- In-app routes (`/chat/…`, `/org…`) and their localhost equivalents navigate in place through the app Router instead of being blocked by the external-link guard; a plain click navigates, a modified or middle click keeps the browser default.
- Routed session ids resolve by their full id, and a session opened from an organization ticket deep link lists itself in the sidebar's Temporary group once per visit.

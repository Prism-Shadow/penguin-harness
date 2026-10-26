# The browser panel stays with the Session it was opened in

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `web`

[中文版](2026-10-26-browser-panel-per-session.zh.md)

Switching from a Session whose dock showed the built-in browser to a conversation with no
browser tabs of its own opened the browser panel there too, on a fresh new-tab page. Going to a
new conversation (`/chat/new`) did the same. For one render during the switch the outgoing
Session's panel was still mounted, so the rule that keeps a tab open while the panel is on
screen opened a page for the incoming conversation, and that page brought the panel up in its
dock.

## Details

- The new-tab rule counts only the dock arrangement of the conversation on screen: a page is
  opened for a conversation only while its own arrangement shows the browser panel. Opening the
  browser in one Session no longer opens it in another, going back to a Session shows the panel
  as it was left, and a new conversation starts without it unless it is opened there.
- The stored dock layout (`penguin.dock.layout`) kept its shape; existing layouts load as before.

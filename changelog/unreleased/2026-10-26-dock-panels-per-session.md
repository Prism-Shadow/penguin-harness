# Dock panels stay with their own Session

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1335](https://github.com/Prism-Shadow/penguin-harness/pull/1335)

[中文版](2026-10-26-dock-panels-per-session.zh.md)

Every dock panel now belongs only to the Session on screen. Opening the built-in browser in one
Session opened it in the next conversation switched to, a new conversation (`/chat/new`)
included, and a few other automatic paths acted on the conversation switched to with the
previous one's data.

## Details

- Browser: switching away from a Session whose dock showed the browser left the outgoing panel
  mounted for one render, so the rule that keeps a tab open while the panel is on screen opened
  a page for the incoming conversation, and that page brought the panel up in its dock. The rule
  now counts only the dock arrangement of the conversation on screen.
- Agents panel: its automatic opening on a Task's first live subagent read the previous
  Session's stream for one render after a switch, so leaving a running Session that had spawned
  a subagent could open the agents panel in the Session switched to. The stream now names the
  Session its data describes, and the automatic opening waits for the new Session's own.
- First send and self-healed ids: when a draft's first send, or a Session's self-healed id,
  finished after the user had moved to another conversation, the arrangement on screen was the
  one handed to the new Session, and the draft's stayed behind for the next new conversation.
  Only the draft's (or the old id's) own arrangement moves now, and the docks on screen are left
  alone.
- A draft's first send and a self-healed Session id no longer take the user to the new Session
  when they have moved to another conversation meanwhile (a new draft included); only someone
  still on the draft or the old id is taken there. The new Session still appears in the sidebar,
  and its dock arrangement still moves with it, unless a new draft page of the same Project on
  screen is using it.
- Requests to panels (a file link, a memory row, a subagent chip) were cleared one render after
  a switch, so the next conversation's panels could act on the previous one's: the Memory panel
  landing on its entry, the agents panel focusing its child. They are now dropped as the route
  changes.
- A tab close that waits for a confirmation (the Files panel's unsaved edits) no longer closes
  the same panel in another conversation when the answer comes after a switch, and the terminal
  panel's close after its last shell ends checks the conversation the same way.
- The stored dock layout (`penguin.dock.layout`) kept its shape; existing layouts load as before.

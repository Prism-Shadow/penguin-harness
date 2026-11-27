# A remote conversation's reconnect status covers its input box

- **Date:** 2026-11-27
- **Type:** feature
- **Scope:** `web`, `ui`, `ui-gallery`
- **PR:** [#1924](https://github.com/Prism-Shadow/penguin-harness/pull/1924)

[中文版](2026-11-27-machine-reconnect-overlay.zh.md)

While the machine a conversation lives on is out of reach, the machine's state now covers that conversation's input box instead of standing at the top of the conversation. The transcript stays readable where the reader left it, and what was typed in the box stays under the cover.

## Details

- The cover names the machine and its state. While the machine reconnects, it shows the attempt, the countdown, Retry now and Stop retrying. Once retrying stops or fails, it offers Retry and Go to Machines. A refused password, a stopped server, a machine that is not connected or not on the list offer Go to Machines. An install or restart running on the machine shows its current step. A last line says messages can't be sent until the machine is back and that what was typed is kept, and says when the transcript shown is the copy from the last sync.
- Only that conversation's input box is covered, along with the Agents panel's box for a subagent on the same machine. The shell, the sidebar, docked panels and conversations on this server are left as they are.
- When the machine drops while the conversation is open, the transcript keeps its scroll position and turns read-only, and the input box keeps its size, text, attachments and picked Skills. When the machine is back, the box says the conversation is being updated and returns once it is. Before this change the transcript was redrawn from the bottom and the box was removed, losing the typed text.
- If the input box had focus, focus moves to the cover's first action and returns to the text when the cover goes. The cover is a polite status region.
- `ComposerCard` in `@prismshadow/penguin-ui` takes a `cover`, laid out by the new `ComposerCover`. The component gallery shows it on the retry board, and its app frames can seed a conversation on a machine and move that machine's connection through these states (`remote=1`).

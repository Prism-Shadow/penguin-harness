# Restore a Session's fullscreen panel when returning to it

Date: 2026-10-14
Type: fix
Scope: web
PR: [#1128](https://github.com/Prism-Shadow/penguin-harness/pull/1128)

[中文版](./2026-10-14-session-dock-fullscreen.zh.md)

Switching away from a Session and back restores its fullscreen panel. Each Session keeps its own fullscreen state, and a draft passes that state to the Session created by its first message.

Panel width and bottom-panel height remain shared across Sessions. Exiting fullscreen, hiding the panel or closing its last tab clears its fullscreen state. Reloading the page or crossing the narrow-layout breakpoint returns panels to their normal size.

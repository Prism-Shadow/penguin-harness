# Text selected over a program that owns the mouse stays selected

- **Date:** 2026-09-09
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-09-selection-survives-the-pointer.zh.md)

Nothing could be copied out of a Claude Code terminal. Selecting appeared to work and then the highlight vanished as soon as the hand left the mouse, so Ctrl+C — which copies a selection and otherwise means interrupt — always meant interrupt.

Two rules met badly. xterm drops the selection on any user input, which is right for a keystroke: the highlight is stale the moment you type. But a mouse report counts as user input too, and a program in any-event tracking (`?1003h`, which Claude Code turns on) is sent a report for every bare mouse move, cell by cell. The selection was being wiped by the pointer drifting over it.

A bare move is no longer reported while a selection stands. The program loses hover for exactly as long as the highlight is up — clicks, drags and the wheel still report, and a keystroke still clears the selection the way xterm intends. It is a terminal-wide fix: the dock, the standalone terminal page and a Session's surface all get it.

macOS could not select at all inside such a program: xterm asks for Option+drag there *and* for an option that is off by default. It is on now, so a Mac has the same escape hatch every other platform had.

What has not changed is who owns a drag: a program that takes the mouse still gets it, so starting the selection still means holding Shift (Option on a Mac). That default is worth revisiting on its own.

# A finger scrolls a terminal a program has taken over

- **Date:** 2026-09-08
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-08-terminal-scrolls-under-a-finger.zh.md)

A terminal on a phone scrolled under a finger only while nothing was running in it. The moment a full-screen program took the mouse — Claude Code does, and so does every TUI like it — the drag went dead: xterm turns its own touch scrolling off for exactly those programs, and they are the ones that need it most. Claude Code draws on the alternate screen, where the terminal has no scrollback to scroll at all, keeps the transcript itself, and moves it only when a wheel reports. A phone has no wheel, so everything above the newest line was out of reach.

A one-finger drag is now that wheel. The travel becomes wheel events at the finger's position, dispatched through xterm so they are encoded in whatever mouse protocol the program actually asked for, one line per line of travel — the transcript follows the finger instead of being flung by it. A tap is still a tap: nothing scrolls until the travel passes a slop threshold, so tap-to-click still reaches a program that answers clicks. Where the mouse is free, xterm's own touch scrolling is untouched and still scrolls the scrollback.

The terminal also stops handing the gesture to the browser (`touch-action: none` on the surface, touch devices only): a drag that the page decides is a page scroll or a pull-to-refresh stops being cancellable mid-gesture, and the terminal loses it.

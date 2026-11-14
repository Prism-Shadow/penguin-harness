# The bottom dock no longer covers the composer

- **Date:** 2026-10-25
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1325](https://github.com/Prism-Shadow/penguin-harness/pull/1325)

[中文版](2026-10-25-dock-composer-overlap.zh.md)

At its largest docked size the bottom dock, and the merged dock below the narrow breakpoint, now stops above the composer. It used to reach 85% of the chat column, toolbar included, which on most windows left the composer too little room: the composer slid under the dock and could not be clicked, and with a wallpaper the two showed through each other.

The docked maximum leaves the composer its full height and a strip of messages above it, tall enough for the launcher ball with its caption and for the back-to-bottom button. When the composer grows (more lines, attachments, a notice) or the window gets shorter, the dock gives way at once and comes back when the room returns; the stored height stays as it was. In a very short window the message strip gives way first, then the dock's own minimum height, and the composer never does. A boundary drag stops at the new maximum, stores the height the dock shows, and still snaps into fullscreen when pulled past it. Fullscreen still covers the composer.

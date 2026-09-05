# A terminal a finger can drive

- **Date:** 2026-09-04
- **Type:** feature
- **Scope:** `web`
- **PR:** [#613](https://github.com/Prism-Shadow/penguin-harness/pull/613)

[中文版](2026-09-04-terminal-touch.zh.md)

A phone's soft keyboard has no Esc, no Tab, no arrows and no Ctrl, so a terminal on one was readable and not usable. Under `(pointer: coarse)` — and only there — the terminal surface now carries a key bar: Esc, Tab, a sticky Ctrl, the four arrows, `^C`, paste, a soft-keyboard toggle, and Alt at the end. Both hosts get it, the `/terminal` page and the dock's terminal tabs. Ctrl and Alt are one shot: a tap arms the modifier and the next character typed composes with it. The caps write their own sequences, so an arrow follows the terminal's cursor-key mode and a modified one carries xterm's modifier parameter, rather than arriving in a full-screen program as literal text.

The soft keyboard also stops covering the bottom of the page: the App asks Chrome to shrink the layout viewport when a virtual keyboard is up, and the `/terminal` page sizes itself to the visual viewport for the browsers that do not implement that. Its header compacts to a phone's width — the working directory truncates, and the status shows as its dot, which names itself.

A long press no longer pastes. It raises the same event a right click does but it is not one, and a finger that meant to select text was pushing the clipboard into a live shell; touch pastes from the key bar instead.

The dock's own chrome follows: its header buttons and tab closes grow to a finger's size, and the bottom dock gains a height toggle — the boundary you drag to resize it is a 4px line, which a mouse can hit and a finger cannot.

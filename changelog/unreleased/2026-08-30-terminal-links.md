# Links in a terminal open where they point

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `web`
- **PR:** [#556](https://github.com/Prism-Shadow/penguin-harness/pull/556)

[中文版](2026-08-30-terminal-links.zh.md)

Clicking a URL in a terminal opened `about:blank` instead of the address, and a hyperlink written by a program — the way `gh` and the agent CLIs print a pull request — first asked "Do you want to navigate to …? WARNING: This link could potentially be dangerous" and then did nothing either way.

## Details

- Both paths shared one cause: each opened a **blank** window (`window.open()` with no address) and then assigned its `location`. That is a browser idiom for dropping the opener, but the desktop shell routes a window by the address it is handed, so what it received was `about:blank` — an external address, handed to the system browser, with the real link discarded. The terminal now opens the address itself in one step, with `noopener,noreferrer`.
- Hyperlinks written by a program (OSC 8) had no handler at all, which is why xterm was falling back to that warning prompt. They go through the same opener now, so both kinds of link behave alike.
- Clicking a link inside a full-screen program — an agent CLI, anything with a spinner — did nothing at all, with or without the above: such a program redraws every frame, and xterm only activates a link when the object under the pointer at mouseup is the same one it saw at mousedown, which a redraw replaces. Any click a human can make spans a redraw. The terminal now decides a click by position instead, the way Windows Terminal does: xterm's own providers still say where the links are, and a click whose down and up both land on one opens it — a fact a redraw does not change, since the program redraws the same link in the same place. A drag across a link is still a selection.
- Only `http:` and `https:` are opened. Terminal output belongs to a program, not to the reader, and `javascript:` or `data:` is as easy for it to print as an ordinary address; anything else is ignored silently.

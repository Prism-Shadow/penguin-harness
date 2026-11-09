# Host commands ship by push, carry their own words, and include DevTools

- **Date:** 2026-09-06
- **Type:** feature
- **Scope:** `desktop`, `server`, `web`

[中文版](2026-09-06-host-commands-and-devtools.zh.md)

## The command leaves the runtime

`/api/command` was mounted above the platform's HTTP seam, which made it runtime code: its shape could only change by rebuilding and redeploying every installation. That is what the runtime layer is not for — it carries mechanism, and what a host command is, what it is called and who may run it is policy.

It is now served by the platform, so it ships by push like every other business API. What stays in the runtime is the message port itself: the last frame the host sent is published as `platform.shellFrames`, unread, and the platform interprets it. The frame has to be published rather than held by the platform because the host announces itself once per wiring — a platform holding it in its own memory would lose it at the next push and never be told again.

The other compatibility path is in the pushable half too: a runtime older than the holder is read through its own service instead. The runtime does not keep its own copy of the routes — a platform too old to take the `/api/command` prefix simply has no host-command route at all.

## The command carries its own words

The command palette asks the host what it can do. Until now the answer was a list of ids, and the page looked each one up in a table it shipped with — so the only commands it could ever show were the ones it already carried. A host offering anything else got nothing for it, and an id the page had never heard of threw while the actions were built, which blanked the whole App.

The host now sends the words with the command: `GET /api/command` answers `offers`, each an id with a label in both languages, and the page renders what it is given. Neither the server nor the page checks an id against a list of its own; the only question either asks is whether the host offered it.

This matters because the three programs ship apart — the desktop shell reaches users through an installer, the server and the page through a hot push — so a shell newer than the page it serves is the ordinary case, not an edge one.

A command the page *does* know keeps the page's own words: they are translated properly and carry search terms, and they can be improved by a push instead of an installer. The host's words are the floor. A page older than `offers` reads the narrower `commands` field, which is pinned to the ids that page can safely look up.

## DevTools from the command palette, and from F12

"Open DevTools" is now a command palette entry (⌥⌘P / Ctrl+Alt+P by default) in the desktop app, beside installing the `penguin` command and checking for updates. **F12** opens it too, and so does Ctrl+Shift+I.

The View menu has always carried DevTools, but the menu bar is hidden on Windows and Linux, so reaching a console error meant knowing a binding nobody is told about — and the menu's own accelerator is not dependable: Chromium offers every key to the page before firing one, so a page that consumes Ctrl+Shift+I keeps it. The shell now takes F12 and Ctrl+Shift+I on `before-input-event`, ahead of the page, the way F10 already reveals the menu bar; the palette entry makes the same action findable without a key at all.

It opens as a separate window rather than a docked pane, so the page underneath is not reflowed while its errors are being read, and asking again focuses the window that is already open.

The entry appears only under the desktop shell: it is the host that opens DevTools, over the same `/api/command` relay the other shell actions use, and a plain server offers no host commands at all. In a browser, the browser's own DevTools are the answer.

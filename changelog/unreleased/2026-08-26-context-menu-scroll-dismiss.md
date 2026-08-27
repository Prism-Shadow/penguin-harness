# A Session row's context menu survives a streaming conversation

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `web`

[中文版](2026-08-26-context-menu-scroll-dismiss.zh.md)

Opening the context menu on a sidebar Session row while a conversation was streaming closed it again immediately, and kept closing it for as long as output kept arriving. A pointer-anchored panel now dismisses only for a scroll that moved the content it was anchored to.

## Details

- The panel listens for `scroll` in the capture phase, because scroll events do not bubble. That reaches every scrolling element in the document, including ones the panel is nowhere near: the message list scrolls itself on every streamed chunk, and each of those scrolls dismissed a menu anchored in the sidebar, which had not moved.
- The dismissal itself is kept. A pointer anchor is a position rather than an element, so once the content under that position moves there is nothing left for the panel to follow. `Dropdown` gained an `anchorOwner` accessor naming the element the anchor was measured from, and dismisses only when the scrolled container contains it — so scrolling the sidebar's own list still closes the menu.
- A page-level scroll targets `document`, which contains every node in the page, so full-page scrolling still dismisses without a case of its own.
- A window resize still dismisses unconditionally: it moves every anchor point on the page.
- A caller that supplies no `anchorOwner` keeps dismissing on any scroll, unchanged.

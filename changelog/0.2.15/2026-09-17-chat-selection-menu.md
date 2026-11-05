# Selected conversation text gets a right-click menu: Copy, and Add to conversation

- **Date:** 2026-09-17
- **Type:** feature
- **Scope:** `web`
- **PR:** [#784](https://github.com/Prism-Shadow/penguin-harness/pull/784)

[中文版](2026-09-17-chat-selection-menu.zh.md)

Text selected in a conversation's message stream now answers a right-click with the app's own
menu instead of the browser's. The desktop app, where Electron shows no context menu of its own,
gained a way to copy conversation text through it.

## Menu

- The menu opens at the pointer when the selection is not blank and lies wholly inside the message
  stream: user messages, replies and tool output all count. Shift+F10 or the Menu key opens it at
  the end of the selection, and Escape hands focus back to where it was.
- **Copy** writes the selected text to the clipboard and confirms with a "Copied" toast.
- **Add to conversation** stages the selection as a chip above the composer's text box, the same
  way the Files panel stages a quoted range. The chip is labelled with the start of the excerpt
  and its tooltip shows the whole excerpt. Nothing already typed changes and nothing is sent; on
  send, the excerpt goes as a Markdown blockquote ahead of the typed text.
- The text stays selected after either action.
- While the menu is open, the stream stops auto-scrolling to follow new output, so during a live
  reply the menu stays where it opened. Scrolling the stream yourself still closes it. Closing the
  menu resumes following, and a view that was at the bottom catches up to it.
- The browser's own menu stays where the app's does not apply: with nothing selected, when the
  selection runs outside the stream (into the composer, for example), when it is built from
  several ranges (Firefox's Ctrl+drag), and on editable fields. A touch or pen press-and-hold is
  left to the operating system's selection menu.
- In the Agents panel, a child conversation's stream offers the same menu, and Add to conversation
  stages into that child's composer.

## Details

- `ComposerReference` gained an `excerpt` kind with no path. The composer chip moved into its own
  `ReferenceChip` component, which draws the excerpt with the quotation glyph.
- `restoreSelection` moved out of the Files panel into a shared module that both menus use.
- The stream's follow model (`stream-follow.ts`) gained a hold. While held, no streaming update
  snaps the view to the bottom; the user's own scrolling still decides whether the view follows.
- A new dictionary key `common.copy` ("复制" / "Copy") labels the Copy row. The add row reuses
  `files.addToChat`.

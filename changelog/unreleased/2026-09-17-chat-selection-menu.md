# Selected conversation text gets a right-click menu: Copy, and Add to conversation

- **Date:** 2026-09-17
- **Type:** feature
- **Scope:** `web`

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
- The browser's own menu stays where the app's does not apply: with nothing selected, when the
  selection runs outside the stream (into the composer, for example), and on editable fields.
  A touch or pen press-and-hold is left to the operating system's selection menu.
- In the Agents panel, a child conversation's stream offers the same menu, and Add to conversation
  stages into that child's composer. A stream without a composer offers Copy alone.

## Details

- `ComposerReference` gained an `excerpt` kind with no path. The composer chip moved into its own
  `ReferenceChip` component, which draws the excerpt with the quotation glyph.
- `restoreSelection` moved out of the Files panel into a shared module that both menus use.
- A new dictionary key `common.copy` ("复制" / "Copy") labels the Copy row. The add row reuses
  `files.addToChat`.

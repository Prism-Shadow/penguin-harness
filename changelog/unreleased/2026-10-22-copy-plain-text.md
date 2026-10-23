# Copying selected text pastes as plain text, without the theme's colours

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1283](https://github.com/Prism-Shadow/penguin-harness/pull/1283)

[中文版](2026-10-22-copy-plain-text.zh.md)

Copying selected text out of the Web App now puts only plain text on the clipboard — the text
the selection reads — however the copy is made. Before, ⌘C / Ctrl+C (and the desktop app's Edit ›
Copy) let the browser add an HTML copy with the page's computed style inlined, so a paste into
Word, Notes or Feishu carried the dark theme's light text on grey and black blocks, while the
conversation menu's Copy row pasted plain text. Both now paste the same.

## Details

- One `copy` listener on the document covers every read-only surface: the conversation and the
  subagent panel's conversation, the Files panel preview (Markdown and source), channel
  messages, the Trace panel, memory, and the Markdown readers. It writes the selection's text as
  `text/plain` and cancels the browser's HTML; the plain text is what the browser wrote before.
- The conversation menu's Copy row writes through the same module, so the two gestures cannot
  drift apart.
- Copies the app writes itself (the Copy row, the copy buttons, Copy path) are plain text alone
  on a plain-HTTP address too, where the browser's copy command used to add an HTML copy of the
  hidden element it copied from.
- Left as they were: a copy inside a field (the composer, the Files editor, form inputs), the
  terminal's own copy, a copy another handler already took, a selection that is blank or made of
  several ranges, and copies inside another document — the built-in browser's pages and the Files
  panel's HTML and PDF previews.
- Pasting no longer brings lists, bold, links or tables along as structure; the docs site and
  the blog are unchanged.

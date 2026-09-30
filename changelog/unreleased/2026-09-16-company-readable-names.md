# Company mode shows names and folders where it showed ids and paths

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `web`
- **PR:** [#753](https://github.com/Prism-Shadow/penguin-harness/pull/753)

[中文版](2026-09-16-company-readable-names.zh.md)

Three company-mode surfaces stopped making people read machine spellings: an `@` picked in a
channel composer writes the Agent's name instead of its id, a data path in a ticket renders as a
folder capsule, and the organization's status sits beside its name as a text capsule.

## Mentions in the channel composer

- Picking from the `@` menu wrote the display name into the box (`@Ada Lovelace`), tinted the way
  a sent message's mention chip is, where it had written the id. The message sent still carries the
  id (`@ceo`, `@user:alice`, `@all`), so the server, delivery and `mention_not_member` did not
  change.
- A picked mention became one block. Backspace right after it or Delete right before it removed
  the whole name at once, and so did a word delete, a cut or a typed-over selection that reached
  into it. The caret stepped over the name, and a click or a selection that ended inside it moved
  to its edge. Ctrl+Z after that Backspace or Delete brought the mention back whole, and an input
  method's composition that reached into a name removed it when the composition ended.
- A copy, a cut or a drag of text holding picked mentions carried them along: pasted or dropped
  into a channel composer, each came back as a mention, while other apps received the names as
  plain text. A mention came back only when its name was still what that channel shows for its
  id, so `@Name` text from anywhere else stayed plain.
- A mention glued to the text around it (`x@Ada`, `@Ada.md`) went out with a space that sets its
  token apart, so it was still delivered, and so was an `@id` typed right after it (`@张三@ceo`).
  Employees who share a name stay apart, and a typed or pasted `@id` works as before.
- The menu also matched names typed in any script (`@张`), and an IME's Enter while composing after
  the `@` stopped picking a candidate.

## Paths in tickets

- The ticket dialog's goal, acceptance criteria, progress lines, result and blocked reason drew
  data paths as capsules: a folder or file glyph and the last segment, the full path on hover, and
  a click that copies the path exactly as written, the glyph turning into a check. The stored text
  did not change.
- A path is `<app_data_dir>/…`, or an absolute path that passes through the Project's
  `organizations/` or `agents/` directory, with `/`, `\` or both as separators, so the paths a
  Windows server writes (`C:\Users\…\.penguin\data\…`) count too. In prose it is made of ASCII
  file-name characters, so it stops at a space, CJK text or punctuation, and a trailing full stop
  stays outside it. A path that runs on through a non-ASCII segment (`…/workspace/调研报告.md`)
  or in from one (`C:\Users\张三\…`), and this server's own routes
  (`/api/projects/…/organizations/…`), stay text. An inline code span holding one path and nothing
  else becomes a capsule verbatim; fenced blocks, commands in code spans and link labels stay as
  written. A trailing separator, or a last segment without an extension, reads as a folder; a last
  segment with an extension, as a file.
- In the Markdown fields a path written with backslashes was copied as the source writes it,
  although Markdown reads a backslash before punctuation as an escape and drops it from the text.

## Organization status

- The organization switcher's trigger showed the status as a text capsule to the right of the name
  — 运行中 / 已暂停 / 配置无效, in English Running / Paused / Invalid configuration — in place of the
  dot before it. The name truncates first, and the status joined the trigger's accessible name.
- The English label for an organization that is not paused changed from "Active" to "Running"
  everywhere it appears.

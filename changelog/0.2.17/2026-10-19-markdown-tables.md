# One base style for Markdown tables: a scroll box, no needless wrapping, stripes and hover

- **Date:** 2026-10-19
- **Type:** feature
- **Scope:** `ui`, `web`, `docs`, `landing`, `ui-gallery`
- **PR:** [#1222](https://github.com/Prism-Shadow/penguin-harness/pull/1222), [#1224](https://github.com/Prism-Shadow/penguin-harness/pull/1224)

[中文版](2026-10-19-markdown-tables.zh.md)

Markdown tables in chat replies, channel bubbles, the Markdown readers, the docs site and the blog share one base style, produced by one rendering pass and one stylesheet in the UI package instead of a set of rules per site. A table fills its column, keeps short cells, figures and code on one line, and scrolls sideways inside its own box once it is wider than the column; its rows are ruled and striped, and the row under the pointer is lit.

## Details

- Every Markdown table sits in its own horizontal scroll box, and the table element stays a table. A table fills the width of its text column, and its columns take their share by content; a table wider than the column scrolls inside the box instead of squeezing its columns or widening the page.
- Cells are classified by what they hold. A column whose body cells are all figures (thousands separators, a sign, a currency, a percent sign or a short unit such as `ms` or `KB`) is right-aligned in tabular figures, its header included; a dash or `n/a` in it does not change that. A cell of at most 36 display columns (a CJK character counts as two) stays on one line; a longer cell or one with a line break wraps, but never narrower than 20rem (15rem in a channel bubble), so a long note in a table that scrolls takes two or three lines rather than a tall stack. Inline code never breaks inside a cell. An alignment the author wrote with GFM colons always wins.
- The header is set in the muted ink at medium weight, over a rule in the stronger line colour; each body row is closed by a rule in the muted line colour. There is no outer frame, no vertical rule and no header fill.
- Even rows carry a faint tint of the text colour, and on a device with a pointer the hovered row a slightly deeper one. Both are tints of the ink, so they read alike on the three themes, in light and dark mode, inside a channel bubble and over a custom background, and leave text contrast unchanged. In the app, inline code in a table cell is drawn on a tint of the ink too, so its chip stays one step deeper than a striped or hovered row instead of disappearing into it.
- The pass runs while a reply is still streaming, so a table has its box and its column kinds from its first row, and the settle render changes neither.
- The blog's bordered tables with a filled header row, and the docs site's full grid, gave way to the shared style.
- `NO_REHYPE_PLUGINS` was renamed `STREAMING_REHYPE_PLUGINS`; `SITE_REHYPE_PLUGINS` was added, and `SiteMarkdown` appends the table pass after a host's own rehype plugins.

## Gallery

- The content board has a Tables group: a wide eight-column table and a short key/value table in the Markdown body, and a table in the Markdown reader sample.
- The chat demo's hooks reply carries a second, wide table, and the site board's article a wide table.

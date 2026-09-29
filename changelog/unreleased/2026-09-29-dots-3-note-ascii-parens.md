# TokenDance's Dots3-Note Preview is named with ASCII parentheses

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `core`

[中文版](2026-09-29-dots-3-note-ascii-parens.zh.md)

## What changed

- The built-in catalog names `dots-3-note-preview` **Dots3-Note Preview (Free)** instead of **Dots3-Note Preview（Free）**. The full-width parentheses came from the seller's Chinese listing and showed as-is in the English UI, since a catalog name is not translated. The words stay the seller's; only the punctuation changes, matching every other parenthesised row.
- Projects that never renamed the row show the new name at once, because a preset's name is read from the catalog rather than stored. A name the user set themselves is left alone.
- A catalog test now rejects CJK punctuation in any display name.

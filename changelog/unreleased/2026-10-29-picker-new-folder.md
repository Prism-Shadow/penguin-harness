# The Workspace picker makes a new folder and selects it

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#1387](https://github.com/Prism-Shadow/penguin-harness/pull/1387)

[中文版](2026-10-29-picker-new-folder.zh.md)

The Workspace picker's toolbar gained a New folder button at its far end. It opens a name row at the top of the list for a folder inside the one on screen: Enter makes it, Escape or the row's × closes the row without closing the picker. The new folder is listed and selected rather than opened, so one press of Choose takes it, and double-click or Enter still opens it. It is made through the Files panel's directory-addressed create, on this server or, while another machine is browsed, on that machine's own server.

## Details

- A name is refused under the field, before anything is sent, when it holds a path separator, starts with a dot (a hidden folder the list would not show), or is already in the folder. On Windows the same goes for `\ : * ? " < > |`, a trailing space or dot, and reserved device names such as `CON`. A refusal from the server is said there too, and the row keeps the name.
- A folder of that name made elsewhere since the listing is read back and selected, with the reason kept under the row. The new folder is found in the listing read back even when the disk stores its name decomposed, or in another case where the disk ignores case. If the listing does not show it at all, the row stays open and says so, instead of leaving Choose on the folder around it.
- While the create is on its way the row cannot be closed. The button is unavailable while a listing is loading or the folder on screen could not be read, and its hint says why when the server may not read the folder. It is a glyph with its name in the hint: the dialog is no wider on a large screen, and a word there would take the path's room.
- `files/create` (both the Session route and the directory route) answers a folder the server may not write in, or a read-only volume, with 403 `dir_write_denied` instead of a 500 internal error; the Web App says so in both languages, in the Files panel too.

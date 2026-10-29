# The Workspace picker makes a new folder and selects it

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#1387](https://github.com/Prism-Shadow/penguin-harness/pull/1387)

[中文版](2026-10-29-picker-new-folder.zh.md)

The Workspace picker's toolbar gained New folder at its far end. It opens a name row at the top of the list for a folder inside the one on screen: Enter makes it, Escape or the row's × closes the row without closing the picker. The new folder is listed and selected rather than opened, so one press of Choose takes it, and double-click or Enter still opens it. It is made through the Files panel's directory-addressed create, on this server or, while another machine is browsed, on that machine's own server.

## Details

- A name holding a path separator (and on Windows `\ : * ? " < > |`), one starting with a dot (a hidden folder the list would not show), or one the folder already lists is refused under the field before anything is sent. A refusal from the server is said there too, and the row keeps the name.
- The button is unavailable while the folder on screen could not be read, and its hint says why when the server may not read it.
- `files/create` (both the Session route and the directory route) answers a folder the server may not write in, or a read-only volume, with 403 `dir_write_denied` instead of a 500 internal error; the Web App says so in both languages, in the Files panel too.

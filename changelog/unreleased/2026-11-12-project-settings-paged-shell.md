# Project settings scroll their page, not their tab rail

- **Date:** 2026-11-12
- **Type:** fix
- **Scope:** `web`, `ui`, `ui-gallery`

[中文版](2026-11-12-project-settings-paged-shell.zh.md)

The Project settings dialog moved onto the Settings dialog's shell, `PagedDialog`. Its tab rail had sat inside the dialog body's one scroller, so a long page (the security policy's rule table) carried the rail and the heading away as it scrolled. Now the rail stays put beside the pane, and only the pane scrolls, with its own scrollbar the full height of the dialog, on every tab.

## Details

- The dialog takes the shell's look: no title bar, the open page's name as the pane heading with its "?", and the close cross beside it. The rail, its icons and the leave-with-unsaved-edits question are unchanged.
- `PagedDialogFoot` (`@prismshadow/penguin-ui`) is the row a page holds to the bottom edge of the pane while its content scrolls beneath it. The security page's pager and Save use it in place of offsets matched to the old dialog body's padding.
- The gallery's paged dialog opens on a page longer than the dialog, with a foot holding Save.

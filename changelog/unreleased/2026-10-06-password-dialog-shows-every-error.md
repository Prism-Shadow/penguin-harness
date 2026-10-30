# The change-password dialog shows every failed save

- **Date:** 2026-10-06
- **Type:** fix
- **Scope:** `web`

[中文版](2026-10-06-password-dialog-shows-every-error.zh.md)

A failed save in the change-password dialog could show nothing at all. Every error other than a weak new password was placed under the old-password field, and a first-login session and the desktop shell's own window do not show that field.

- A failure that belongs to no field — a refused request, a failed network call, a server error — now appears on a line of the dialog's own, above the buttons.
- A wrong current password still appears under the old-password field, and on the dialog's line when that field is not shown.
- A weak new password still appears under the new-password field.

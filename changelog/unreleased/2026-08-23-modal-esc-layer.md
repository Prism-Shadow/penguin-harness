# Escape inside a dialog's menu closes the menu, not the dialog

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `web`

[中文版](2026-08-23-modal-esc-layer.zh.md)

`Modal` reads its `onClose` through a latest-callback ref, so the Escape-layer it registers is
pushed once when the dialog opens instead of being re-pushed on every render. Call sites pass an
inline arrow for `onClose`; the re-push moved the dialog's layer back above a menu opened inside
it, and Escape then closed the whole dialog — discarding whatever had been filled in — rather than
just the menu.

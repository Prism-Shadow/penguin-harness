# Dialogs hold on to keyboard focus, and hand it back

- **Date:** 2026-09-03
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-03-modal-focus-trap.zh.md)

The Web App's `Modal` primitive, which every dialog in the app is built on, now contains
keyboard focus for as long as it is open and returns it when it closes.

## Details

- Opening a dialog moves focus to its first focusable control, or to the dialog itself when
  it has none. A dialog whose content sets `autoFocus` keeps that choice.
- Tab and Shift+Tab cycle within the dialog, wrapping at both ends, rather than walking out
  into the page behind the overlay.
- Closing returns focus to the element that held it before, on every path: Escape, the close
  button, a click on the overlay, the `open` prop going false, and the dialog unmounting.
- `role="dialog"` and `aria-modal="true"` now sit on every dialog. They had been set only on
  the headerless variant — confirmations and `PagedDialog` — so a titled dialog was announced
  as a plain container with no name.
- A titled dialog is named by its own heading through `aria-labelledby`, not by a second copy
  of the title string.
- A menu or popover opened from inside a dialog still owns its own focus and its own Escape,
  and Escape still closes one layer at a time.

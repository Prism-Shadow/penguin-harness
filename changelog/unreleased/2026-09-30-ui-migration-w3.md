# Menus, dialogs, tooltips and toasts move into the shared UI package

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-09-30-ui-migration-w3.zh.md)

W3 of the UI-package migration moves the Web App's overlays into `@prismshadow/penguin-ui`: menus and dropdowns, tooltips, dialogs and sheets, and toasts.

## What moved

- **Menus:** `Dropdown`, `FormPicker`, `useRowContextMenu`, and a new `Menu` family (`Menu`, `MenuItem`, `MenuRadioItem`, `MenuLabel`, `MenuSeparator`) that the account, project, organization, list-settings, dock, permission and file menus now share in place of hand-built rows.
- **Tooltips:** `Tooltip`, `TooltipLayer` and `TooltipPanel`, with the rule that hides a hint repeating text already shown whole.
- **Dialogs:** the Esc layer stack (`pushEscLayer`, `useDialogLayer`, `useEscLayer`), `Modal`, `ConfirmModal`, `PagedDialog`, `Drawer`, `Sheet` and `Lightbox`, with the spring and sheet physics they animate by.
- **Toasts and notices:** `Toaster` with its store (`toastSuccess`, `toastInfo`, `toastAttention`, `toastError`) and `NoticeStrip`.
- **On code that came from main during the migration:** `Modal` keeps the Workspace finder's full-screen phone layout (`fullScreenOnPhone`); the Esc layer stack reports whether any layer is open (`hasEscLayers`), which the Web App installs as its shortcut blocker so no global shortcut runs behind a dialog or menu; `FormPickerTrigger` (the model picker's and the Workspace finder's trigger) moves with `FormPicker`; the conversation's link menu, the built-in browser's overflow menu and the Workspace finder's context menu use the `Menu` rows.

## Details

- `ConfirmModal` takes its confirm and cancel labels from every caller; the package no longer supplies a default.
- The package's accessibility fallbacks gain the toast stack's name and its dismiss hint.
- Menu rows carry menu roles (`menuitem`, `menuitemradio`) instead of plain buttons.
- The component gallery's frame keeps its height when a bottom sheet or drawer opens; it used to grow without end.

## Visible changes in the default theme (Primer)

- **Menus:** every menu row shares one padding and hover (`px-3 py-1.5`, a fainter hover fill); the current choice is filled and checked; row labels truncate to one line instead of wrapping; section labels are 12 px; danger rows are one step darker red.
- **Project and organization switchers:** the current row is filled, medium weight and checked instead of only bold; "+" and Settings get glyphs; the organization group label is no longer uppercase.
- **Dock add-menu:** rows lose the inset rounded hover; ink is darker and glyphs are smaller.
- **Tooltip:** text one step darker in light and lighter in dark.
- **Confirmation dialog (danger):** the warning mark sits on a neutral disc instead of a red one.
- **Paged dialog:** the rail's active and hover fills are one step fainter; group headings take the eyebrow style.
- **Lightbox:** a lighter backdrop (the shared dialog backdrop) and a token-drawn close button.
- **Notice strips and toasts:** borders become neutral gray and text one step lighter in light; the dark toast fill is less saturated.
- A few 11 px captions in dialogs and menus become 12 px.

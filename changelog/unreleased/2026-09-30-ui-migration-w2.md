# The form controls move into the shared UI package

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-09-30-ui-migration-w2.zh.md)

W2 of the UI-package migration moves the Web App's form controls into `@prismshadow/penguin-ui`, and adds the few controls the app kept spelling by hand.

## What moved

- **The shared menu panel** (`menuPanelClass`, `menuRowClass`, `menuRowTone`, `ChoiceCheck`): the panel, row states and check mark every menu and picker shares.
- **Fields and inputs:** `Field` with its label, hint and error, `RequiredMark`, `Input` and `Textarea` (with in-field affixes), `PasswordInput`.
- **Pickers:** `Select`, `OptionMenu`, `PickerList` (the search box over a keyboard-walkable list, lifted from the model picker), `Segmented`, `Switch`, `SwatchPicker` (the accent swatches), and the settings rows `PrefRow`, `SettingRow` and `SettingsSection`.
- **Overlays pulled forward from W3:** `usePortalPanel`, `InfoPopover` (the "?" beside a label) and `HelpFold`.
- **New controls:** `Checkbox` (with an indeterminate state), `Radio` and `RadioGroup`, `SearchInput` (field, panel and menu shapes with a clear button), and `ToggleRow` in place of eight hand-built switch rows.
- **On code that came from main during the migration:** the model picker dialog's search field and the sidebar's session search are `SearchInput` (a ref reaches its input, which the search shortcut uses); the built-in browser's clear-data and import dialogs use `Checkbox` and `Radio`.

## Details

- The package's own accessibility fallbacks gain show/hide-password, clear-search and "more info" strings, supplied by the Web App in the interface language.
- `FormPicker` stays in the Web App until W3 moves the dropdown it wraps.

## Visible changes in the default theme (Primer)

- Checkboxes and radio buttons are drawn by the theme (14 px, accent-filled) instead of the browser's native widgets.
- Search boxes share one look with a clear button; in the skill and machine pickers and the model picker dialog the first Esc clears the query and the second closes the picker.
- Menu rows: the hover and current-choice fill is one step fainter, and option ink one step darker.
- Field labels one step lighter; an error drops its red fill and keeps a red outline.
- Segmented controls have 4 px of padding (4 px taller); in dark the selected segment is darker.
- Swatches no longer grow on hover; they take a border instead.
- A handful of 11 px captions (option descriptions, the proxy probe URL, schedule id suffixes) become 12 px.

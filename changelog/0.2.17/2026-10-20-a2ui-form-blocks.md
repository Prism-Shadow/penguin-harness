# A2UI form and choice blocks drawn through the UI package's controls

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1257](https://github.com/Prism-Shadow/penguin-harness/pull/1257)

[中文版](2026-10-20-a2ui-form-blocks.zh.md)

The form block draws all eleven field kinds, and the form and choice blocks draw through the UI package's controls instead of their own styling, so they follow the three themes.

## Rendering

- Each field kind has its control: a text box capped at its length, a three-line textarea, `NumberInput`, `Slider`, a segmented control or a radio group for one option, `ChoiceGroup` chips or a checkbox column for several, a dropdown whose empty first row reads "Choose…" unless the model wrote a placeholder, a switch row titled like the form's other fields, and the native date, time and date-and-time inputs.
- The form's button stays off until every required field is answered and every answer is valid. While an answer breaks its rule, the control takes the danger colour and the line under it turns into the error: the field's hint, else the broken rule in symbols, else "Not a valid value". Mod+Enter in a textarea fills the form, as Enter does in a one-line box.
- A field starts at its default; a slider starts at its minimum and a switch off. A restored draft takes back only what each field accepts, and an untouched form writes no draft.
- The choice block draws its options with `ChoiceGroup`.
- The UI strings and the Web App's dictionaries gained the dropdown's empty row and the fallback error line in zh and en.

## Gallery

- The A2UI reply board shows every field kind across two forms, since a form holds at most six fields.

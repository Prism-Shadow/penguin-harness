# The UI package's choice group, number input and slider

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `ui`, `ui-gallery`
- **PR:** [#1256](https://github.com/Prism-Shadow/penguin-harness/pull/1256)

[中文版](2026-10-20-ui-form-controls.zh.md)

The shared UI package gained the form controls it lacked: a group of pressable options drawn as chips or cards, a number input with a stepper, and a slider. A fieldset legend and the radio's disc became components of their own. All of them draw with the themes' existing roles, so they follow Primer, Frost and Console in light and dark mode without new tokens.

## Details

- `ChoiceGroup` draws options as chips in a wrapping row or as cards in a column, for one answer or several. A single choice acts on the press. Its options are buttons with `aria-pressed`, and the group keeps a radio group's keyboard: one tab stop, resting on the option the caller names, then on the pressed option, then on the first one. The arrow keys on either axis, Home and End move the stop; it wraps at the ends and passes over disabled options. A card leads with the radio's disc, filled on the pressed option, or with a mark the caller passes in. In a multiple choice, chips are toggle buttons with a tab stop each, led by the checkbox's box and ticked when pressed, and cards are real checkboxes, so a multiple choice never reads as a single one. Every change reports the options that are on, in the options' order. An option can be muted (an "Other…" entry), disabled on its own, or closed with the whole group.
- `NumberInput` draws a number box with the unit inside it, and a minus and a plus that step the value and are disabled at the bounds. The range under the box is written in symbols (`1–10`, `≥ 1`) unless the caller passes a hint. An error takes the hint's place and draws the box's danger line. The step arithmetic is exported as `stepNumber` and `rangeText`.
- `Slider` is a native range input. The track is filled in the accent up to the thumb and shows the switch's off track beyond it. The thumb takes the accent with the switch knob's hairline. Disabled, the fill and the thumb turn grey. A readout in tabular figures shows the value and its unit, and the slider's `aria-valuetext` carries the same words. The keyboard focus ring sits on the thumb.
- `FieldLegend` is the field-label look as a fieldset's `<legend>`, with the required mark, and `RadioGroup` draws its legend through it. `RadioDisc` is the radio's disc as a decorative drawing, from the same classes the native radio uses.
- The checkbox's corner is capped at a quarter of its side, so it stays a square in every theme. In Frost it had been drawn as a circle that read as a radio. `CheckboxBox` is the box as a decorative drawing, from the same classes as the native checkbox.

## Gallery

- The inputs board has a Number group: a number input with a unit, one at the top of its range, a disabled one and one with an error. It also has a Date and time group with the native date, time and date-and-time inputs.
- The pickers board has a Slider group (a percentage, a 0–1 range in steps of 0.1, a disabled slider) and a Choice group group. The choice group shows chips that act on the press with a recommended option, chips that toggle, cards led by the disc with a muted "Other…", checkbox cards, and an answered question with every option closed.

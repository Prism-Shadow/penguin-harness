# Answered A2UI forms and choices show their answers after a reload

- **Date:** 2026-10-22
- **Type:** feature
- **Scope:** `core`, `ui`, `web`, `ui-gallery`, `skills`
- **PR:** [#1287](https://github.com/Prism-Shadow/penguin-harness/pull/1287)

[中文版](2026-10-22-a2ui-answered-forms.zh.md)

Once a reply's form or choice has been answered, its read-only block shows the answers the reader sent instead of the model's defaults, and keeps showing them after a reload or in a Trace read back from history. The answers come from the message that followed the reply; nothing new is stored, so conversations from before this change show their answers too.

## Reading the answers back

- `@prismshadow/penguin-core/a2ui` exports `parseFormFill` and `parseChoicePick`, the inverse of the fill texts. `parseFormFill` finds each field's `label: answer` line by its label, in any order and in either language's colon, list separator and Yes / No. It undoes what the fill did: an option's value back to its label, a list split on either separator (an option label that contains the separator still reads as one option), the unit off a number or a slider, a datetime's space back to `T`, a multi-line answer's two-space indent. Each answer is held to its field's rule, and one the field would not accept is left out. A message that names no field is not the form's answer.
- `parseChoicePick` reads a pick back from the option's value or label; a multiple choice may list several, joined by either separator. An answer the reader wrote themselves ("Other…") picks nothing.

## Rendering

- `A2uiActions` has an `answeredWith` field: the text of the message that answered the reply. A read-only form shows the answers read back from it, and a field without an acceptable line shows unanswered. A slider or a switch cannot show "no answer", so one without a line stands at its starting answer. A read-only choice shows the picked options. A message that is not the block's answer leaves the block as asked, and the open question ignores `answeredWith`.
- The Web App hands every reply other than the open question the text of the first message the person wrote after it: a prompt's own words without its source blocks and attachment lines, or a steer's. Harness inputs (a goal round, a hook's continue, a scheduled or organization trigger, a background completion) are passed over. Each reply's actions object keeps its identity while its answer and the interface language stay the same, so a stream frame does not re-render the blocks.

## Skill

- The bundled checker `scripts/check.mjs` was rebuilt because the a2ui sources it hashes changed; only its source-hash header differs. The `a2ui` skill's version is `2026.10.22.1`, and its text and description are unchanged.

## Gallery

- The A2UI reply board shows the database choice, the release-checks multi-select and the deployment form a second time, answered: read-only, with the answers read back from a sample message in the gallery's language.

# A2UI grammar: eleven form field kinds, one answer rule, and no checks on plain text

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `core`, `skills`
- **PR:** [#1253](https://github.com/Prism-Shadow/penguin-harness/pull/1253)

[中文版](2026-10-20-a2ui-forms-grammar.zh.md)

The A2UI grammar gained every basic form field kind and one rule for whether an answer is valid, and the checker stopped checking the text outside the blocks. The `a2ui` skill's bundled `check.mjs` was rebuilt from the grammar.

## Forms

- Eleven field kinds: `text`, `textarea`, `number`, `slider`, `single`, `multiple`, `select` (a dropdown of 2–30 options, with a warning past 12), `switch`, `date`, `time` and `datetime`. A slider needs `min` and `max`.
- New field options: `hint` (the line under the control, which is also the error line), `maxLength` (text up to 500, textarea up to 2000), `pattern` (text only, matched against the whole answer) and `default` (the starting answer, typed by kind).
- New checker codes: `not_for_kind` replaces `number_only` for any field placed on a kind that does not read it, and `default_invalid` refuses a default that breaks its own field's rule. A `placeholder` on a kind without one, and a `description` on a dropdown's option, warn and are dropped.
- Whether an answer is valid became one rule, `fieldProblem`, which names the broken rule in symbols such as `1–10`, `≤ 500` or `YYYY-MM-DD`. A field's `default` is checked by the same rule.
- The fill text keeps one `label: answer` line per field. A switch fills `Yes` / `No` (是 / 否), a number or a slider its figure with the unit (a percent sits tight to it, as in `70%`), and a datetime its day and time with a space. Text of several lines starts on the next line, each line indented two spaces.
- As text (CLI, messaging channels), each field's bullet says what it takes: its options, range, format or yes / no, followed by its default and its hint.

## Checker

- The checks on the prose outside the blocks were removed: long sentences and paragraphs, passive voice, vague words, deep lists and walls of text. The report has two sections, errors and block warnings, and the rubric lost its naturalness question.
- The total is the L2 score when there is no error, and the gate stays at 70, so a reply passes with at most two block warnings.
- The reply's language is detected from the lines outside the blocks, with inline code and bare URLs left out; `--lang` sets only the rubric's language.

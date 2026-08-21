# One way to mark a required field

- **Date:** 2026-08-21
- **Type:** refactor
- **Scope:** `web`
- **PR:** [#396](https://github.com/Prism-Shadow/penguin-harness/pull/396)

[中文版](2026-08-21-settings-field-markers.zh.md)

Settings panels marked mandatory fields three different ways: a red `*`, the word "optional"
appended to the neighbouring label, or nothing at all. They now follow one rule — **a required
field carries the red `*`, an optional field carries no mark, and no label or placeholder says
"optional"**. Explanations that had been folded into a label moved out of it, following the split
[the disclosure pass](2026-08-21-settings-disclosure.md) set: what shapes a value stays visible as
the field's hint.

## Marks that did not match the behaviour

- **Upload limits** (System settings): both the per-attachment and the per-message MB fields are
  refused when empty, and neither was marked. Both now carry the `*`.
- **Add a memory** (Agent settings → Memory): the content field gates both actions of the dialog
  and was not marked. It now carries the `*`.

## Labels that carried their own marker

- **Security policy** (Project settings): the rule editor identified its three fields by
  placeholder alone, so the only sign that a name and a pattern are mandatory was the word
  "optional" on the description. All three now have real labels, and the two mandatory ones carry
  the `*`.
- **New Project**: the display name read "Display name (optional, defaults to the Project id)".
  The label is now just the name, and the fallback is a hint below the field — the same way the
  Create agent dialog has always spelled it.
- **Schedules** (Agent settings): "End at (optional)" and "Workspace (optional; a temporary
  workspace is created when empty)" lost the wording; the workspace fallback became a visible
  hint, matching the identical field in Project settings → Defaults.

## One asterisk

The mark had been re-typed by hand in three places, one of which had dropped its dark-mode ink and
rendered a brighter red than every other copy. It is now a single `RequiredMark`, which the models
add-group and model dialogs use through `FieldLabel` for their custom label rows, and which the
trace viewer's tool-schema table uses for required properties.

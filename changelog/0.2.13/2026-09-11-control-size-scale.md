# Form controls take their font size from one record

- **Date:** 2026-09-11
- **Type:** refactor
- **Scope:** `web`, `skills`
- **PR:** [#689](https://github.com/Prism-Shadow/penguin-harness/pull/689)

[中文版](2026-09-11-control-size-scale.zh.md)

The Web App's form controls spelled their font size in four places that had drifted apart, and four
dialog fields sat a tier above their neighbours because no call site had said which tier it wanted.
The rung now comes from a single record, `sizeTextClass` in `components/ui/input.tsx`, and every
control names the one it takes.

## Details

- `sizeClass` split into `sizeTextClass` (the font rung) and its padding. `Select`'s menu rows,
  `OptionMenu`'s row titles and `Textarea` read the rung instead of re-spelling it — `Textarea` had
  its own literals and matched only by coincidence, and now keeps just the padding as an explicit
  override, a multi-line box wanting more room than a one-line input.
- The rename-chat, rename-workspace, context-threshold and shortcuts dialogs pass `sm`, matching the
  controls beside them; the shortcuts dialog had an `Input` at `text-base` directly above a
  `Textarea` at `text-xs` inside one stack.
- The login card keeps `text-base` and now asks for it by name (`size="base"`), the sole deliberate
  caller of that rung; its submit Button dropped a redundant `text-sm`.
- `Input`, `Textarea`, `Select`, `OptionMenu` and `PasswordInput` default to `sm` instead of `base`,
  joining `FormPicker`, so a forgotten `size` lands on the rung its neighbours are already on rather
  than the roomiest one — which is how the four fields above had drifted. Every call site names its
  rung regardless; the default only decides where the next omission lands.
- `FormPicker` gained a `size` prop defaulting to `sm`, in place of a hard-coded tier, and
  `protocol-suffix.tsx`'s hand-rolled option menu imports `OptionMenu`'s row records rather than
  duplicating them.
- Four raw elements moved onto the family's rung: the machines page's search box (which also gained
  the autofill opt-out the app's other four search boxes carry), the goal-budget input in the chat
  composer's popover, the memory-import radio rows, and the trace-import file picker.
- Every `Modal` footer button dropped from `Button`'s `md` default to `sm`, so a dialog's buttons
  read at the same size as the fields above them — which is what `ConfirmModal` already did, and the
  two dialog families had disagreed. 21 footers, 56 buttons, plus three in dialog bodies (the
  speed-test dialog's hand-built action row and the OAuth dialog's authorize link). Page-level
  buttons — a list header's create action, an empty state's action, the login card's submit — keep
  `md`.
- The chat composer and the Workspace file editor stay off the scale — one a prose surface, one a
  code surface — and now say so where they are written.
- `packages/web/test/control-size.test.ts` parses the JSX and fails, naming file and line, on a
  font-size class in a `className` passed to `Input`, `Textarea`, `Select`, `OptionMenu`,
  `PasswordInput` or `FormPicker` — such a class either does nothing or freezes the control against
  the user's font-size setting, and neither shows up in review — on a `Modal` footer button that does
  not ask for `sm`, and on a font size spelled in a control module outside the two records.
- `.agents/skills/penguin-harness-frontend/SKILL.md` gained a "Control sizes" section recording the
  rungs, the stylesheet-order hazard behind the rule, and the one grandfathered bracket value.

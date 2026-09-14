# Buttons take the rung of what they stand beside, and the menu search box gets a record

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `web`
- **PR:** [#699](https://github.com/Prism-Shadow/penguin-harness/pull/699)

[中文版](2026-09-11-control-unification.zh.md)

A second pass over the form controls, on the rule
[#689](https://github.com/Prism-Shadow/penguin-harness/pull/689) set: a size comes from one record,
and the rule is checked rather than remembered.

## Details

- Four buttons in the settings dialog stood a rung above the fields beside them — Account's "change
  password", Proxy's and Uploads' "save", and the admin Users page's "create". All four are dialog
  *body* buttons, which #689's rule already put on `sm`; they kept `Button`'s `md` default because
  nothing checked them. `control-size.test.ts` now names the settings dialog's pages in
  `DIALOG_BODY_MODULES` and fails on a Button in one of them that does not ask for `sm`.
- The Agents page header gained a search box — name, id and description, case-insensitive — in the
  Models page header's shape: the same `flex-wrap` title row, the same
  `min-w-0 flex-1 sm:w-56 sm:flex-none` box, the same `Input size="sm"`. Its create action drops
  from `md` to `sm` so it reads at the size of the box beside it. An empty result says so rather
  than reading as "no agents".
- The Models page's "sync presets" action appears only while a sync is waiting, in the accent. A
  sync with nothing to sync is a no-op, and the permanent button spent the header's width on one.
  The update dot goes with it: it marked this button as the end of the models trail, and on a
  button that exists only when the trail does, it would be lit every time it was seen.
- The four raw `<input>` search boxes that do not go through `Input` — the model picker, the Skill
  picker, the Workspace browser and the machines picker — read `menuSearchClass` or
  `panelSearchClass` from `components/ui/input.tsx` instead of each spelling its own look. The four
  copies had drifted apart on radius, padding, focus colour and whether the border transitions at
  all. Padding stays with the caller, the one thing that legitimately differs.
- The machines page's install action was the last page-header button still on `md`, beside the
  machine picker. `CreateButtons` defaulted its `size` to `md` while both call sites passed `sm`,
  so the default was unreachable — a trap for the next caller; it defaults to `sm` now.
- The three `<label>`s that a file picker needs, and that had each respelled the Button look by
  hand — two of them byte-identical — read `labelButtonClass(variant, size)` from `button.tsx`,
  built from the same two records `Button` itself reads.
- `.agents/skills/penguin-harness-frontend/SKILL.md` records the button rule as "a button takes the
  rung of whatever it stands beside", with the three places that means `sm`.

# Button labels stay on one line

- **Date:** 2026-10-02
- **Type:** fix
- **Scope:** `ui`, `web`
- **PR:** [#954](https://github.com/Prism-Shadow/penguin-harness/pull/954)

[中文版](2026-10-02-button-labels-nowrap.zh.md)

A button's label no longer breaks onto a second line. In Chinese, the Save button of Project settings › General stood one character a line at every window width. An audit of every page, the Settings and Project settings dialogs and the main dialogs — at 390, 1024 and 1440 px, in both languages, at the M and XL text sizes, in all three themes — found the rest.

## Details

- **Buttons:** `Button` and the button look a file picker wears keep their label on one line, and so do a segmented control's options: they share its width evenly while they can, and never get narrower than their own label. The text buttons drawn by hand across the app (toggles, row actions, links that act) do the same.
- **The layout around a button makes the room:**
  - Project settings › General: the display-name field keeps its intended width, which leaves Save the room it needs.
  - Dialog footers and the settings pages' action rows start a second row when a phone-width dialog cannot hold all their buttons in one.
  - Settings › Profile: at phone width the avatar and nickname controls wrap onto a second line, right-aligned, instead of running out of the dialog.
  - Organization overview: the KPI strip goes two by two, and the first-steps cards take fewer columns, when the main column is too narrow for their buttons (a large text size at a laptop width). The board's count buttons keep their labels.
  - Terminal page: a long connection error is cut short, with the whole of it in the tooltip, instead of pushing the New terminal button out of the bar.
- **The rule is written down:** `.agents/skills/penguin-harness-frontend/SKILL.md` states that a button label never wraps and that the layout around it makes the room, with the four ways to do that.

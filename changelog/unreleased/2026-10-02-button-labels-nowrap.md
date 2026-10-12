# Button labels stay on one line

- **Date:** 2026-10-02
- **Type:** fix
- **Scope:** `ui`, `web`
- **PR:** [#954](https://github.com/Prism-Shadow/penguin-harness/pull/954)

[中文版](2026-10-02-button-labels-nowrap.zh.md)

Button labels were kept on one line. In Chinese, the Save button of Project settings › General had stood one character a line at every window width. An audit of every page, the Settings, Project settings and App info dialogs and the main dialogs — at 390, 1024 and 1440 px, in both languages, at the M and XL text sizes, in all three themes — found the rest.

## Details

- **Buttons:** `Button` and the button look a file picker wears kept their label on one line, and so did a segmented control's options: they shared its width evenly while they could and no longer got narrower than their own label. A segmented option could also take a shorter label for phone width, with the full one kept as its name. The text buttons drawn by hand across the app (toggles, row actions, links that act) followed the same rule.
- **The layout around a button made the room:**
  - Project settings › General: the display-name field got its intended width, narrower on a phone, which left Save the room it needed.
  - Dialog footers, the settings pages' action rows and every variant of the notice, action group included, started a second row when their buttons did not fit one.
  - The composer's context-window notice put its two buttons on a row of their own on a phone, instead of leaving its sentence a few characters a line.
  - Settings › Profile: at phone width the avatar controls wrapped, right-aligned, instead of running out of the dialog.
  - Organization overview: the KPI strip went two by two, and the first-steps cards took fewer columns, when the main column was too narrow for their buttons (a large text size at a laptop width). The board's count buttons kept their labels.
  - Organization finance: on a phone the period switch took a full-width row under the title and showed each period's month alone.
  - Terminal page: a long connection error was cut short, with the whole of it in the tooltip, and held to half the bar, instead of pushing the New terminal button out of it.
- **The rule was written down:** `.agents/skills/penguin-harness-frontend/SKILL.md` gained a section stating that a button label never wraps and that the layout around it makes the room, with the four ways to do that and the trap of a segmented control in a settings row.

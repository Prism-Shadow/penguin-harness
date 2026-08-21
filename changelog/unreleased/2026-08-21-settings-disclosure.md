# Settings explanations moved behind the circled "?"

- **Date:** 2026-08-21
- **Type:** refactor
- **Scope:** `web`
- **PR:** [#392](https://github.com/Prism-Shadow/penguin-harness/pull/392)

[中文版](2026-08-21-settings-disclosure.zh.md)

The settings surfaces carried their explanations as gray paragraphs and sub-labels that
every visit had to scroll past. They were moved onto the rule the rest of the Web App
follows: what a page or a row *means* is disclosed by the circled "?" beside its title,
and only what shapes a value stays on screen.

## Project settings

- The security-policy page opened with a five-sentence paragraph covering both shell entry
  points, the fixed denial text the model receives, the matching algorithm and the evasion
  caveat. It was cut to two sentences behind a "?" on the page heading; the rule editor
  keeps its visible "Regular expression" placeholder.
- The dialog's pane heading gained an optional explanation slot, so any of its pages can
  carry one.
- On the same page, adding a rule opened its form below every existing rule. The factory
  set alone makes the list taller than the dialog's scroll box, so the form landed
  off-screen and the click read as inert. It now opens directly under the Add button that
  asked for it, with the caret in the first field; the rule it applies stays at the head of
  the list, where it was typed.

## System settings

- Every preference row — language, currency, CLI sessions, theme, terminal theme, font
  size, accent, change password — moved its sub-label to a "?" beside the row title.
- Proxy options moved its page-level paragraph to a "?" on the pane heading, which the
  paged-dialog shell now draws; the shared page frame lost its explanatory-line slot with
  it.
- Upload limits split its single paragraph in two: the accepted MB range moved under each
  of the two fields, where it is read while typing, and the fixed per-message attachment
  count and the separate inline-image cap moved to a "?" on the pane heading.

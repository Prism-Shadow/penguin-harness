# The harness's own workbenches are easier to use on a first visit

- **Date:** 2026-11-21
- **Type:** fix
- **Scope:** `plugins`
- **PR:** [#1684](https://github.com/Prism-Shadow/penguin-harness/pull/1684)

[中文版](2026-11-21-workbench-usability-pass.zh.md)

A first-time pass over AI Slides, Reading Desk and the five everyday workbenches, fixed in each app's own page:

- **Action Minutes and Party Charades:** "Delete meeting" and "New match" now ask in a dialog of the page's own and then act. The app frames a workbench without permission for the browser's `confirm()`, which answered no without showing anything, so both buttons did nothing.
- **AI Slides:** on a Project with no default model, "Create with AI" and Send open the model picker and say why, instead of failing with "[object Object]". The model button reads "Choose a model" rather than "Project default" when there is no default. "Import a presentation…" and "Download as a web page (.html)" replace the Bento file-format names on the buttons; the import button's hint still names the formats.
- **Reading Desk:** importing a book and highlighting work when the app is opened over plain HTTP from another computer, where the browser has no `crypto.randomUUID`. "Highlight" stays clickable and says how to select a passage. At phone width the header buttons keep their labels on one line, the reading area no longer draws a focus ring around the whole text, and the progress figure stays clear of the full-page exit control.
- **Everyday workbenches:** the page says "Loading…" until its data arrives. Fridge Keeper's empty list says how to add the first ingredient, Action Minutes' first screen says what the app is for, and Party Charades tells the team to finish the turn once time is up and makes that the main button.

Every changed workbench carries a new dated version, so installed copies show an update.

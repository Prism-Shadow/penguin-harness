# Company mode: an employee's model is its desk session's

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#915](https://github.com/Prism-Shadow/penguin-harness/pull/915)

[中文版](2026-09-30-desk-model-follows-session.zh.md)

An employee's model was read from its chart entry, while its desk session could be moved to another model in place (the in-session switch of [#748](https://github.com/Prism-Shadow/penguin-harness/pull/748)): the chart kept the old model, and the employee's ticket sessions and its next desk still opened on it. The employee's model is now the model its current desk session runs on.

## Server

- Switching the model inside an employee's current desk session — the toolbar's model picker, `/switch-model`, or the API — is the employee's switch: when it completes, the server writes the new model to the employee's entry in `org_chart.yaml`, so a desk renewed later opens on it. A switch made in a ticket session, or in a desk that has already been replaced, changes that session only.
- Ticket sessions open on the model the employee's current desk session runs on at that moment. The chart's `model` (then the organization's, then the Project default) is used only for an employee that has no desk.
- The chart's `model` is what a desk is opened on, at hire or on renewal. Writing it alone (`penguin org employee set --model-id … --provider …`) leaves the open desk and its ticket sessions where they are.
- The session manager tells subscribers when a Session's model moves (`onModelChanged`), after the row carries the new model.

## Docs

- `company-mode` ("Desk sessions") and `cli` (`employee set`), in both languages.

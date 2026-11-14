# Importing a model group lets you pick the models

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#1385](https://github.com/Prism-Shadow/penguin-harness/pull/1385)

[中文版](2026-10-29-import-pick-models.zh.md)

**Add group → Import models** on the Models page no longer imported every model an endpoint listed in one step. Its action became **Fetch model list**, which showed the endpoint's models under the fields, one model id per row with a checkbox, in the endpoint's order and all ticked. The action then read **Import {n} models** and saved only the ticked models into the new group, as before with the group's base URL, protocol and key written once. It was unavailable while no model was ticked.

## Details

- The list showed how many models were ticked out of how many were listed, with **Select all** and **Select none**. A list of more than 10 models added a filter box by model id; the two bulk actions acted on the rows the filter showed, and filtering never changed the tick of a row it hid.
- The rows scrolled inside their own box, so a long list kept the fields above it and the dialog's buttons in place.
- Ids the import could not hold (empty, over 200 characters, carrying control characters) and repeats were left out of the list and still counted as skipped in the result. Unticked models were not counted as skipped.
- The list was hidden while the API key, base URL or protocol differed from what it was fetched with, and came back with its ticks when all three matched again.
- While the list was being fetched or the models saved, the API key and the protocol were locked like the base URL, and the second click of a double-click on **Fetch model list** did not import.
- The English result and progress messages said "1 model" and "1 entry" in the singular.

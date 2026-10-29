# Importing a model group lets you pick the models

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `web`, `docs`

[中文版](2026-10-29-import-pick-models.zh.md)

**Add group → Import models** on the Models page no longer imported every model an endpoint listed in one step. Its action became **Fetch model list**, which showed the endpoint's models under the fields, one model id per row with a checkbox, in the endpoint's order and all ticked. The action then read **Import {n} models** and saved only the ticked models into the new group, as before with the group's base URL, protocol and key written once. It was unavailable while no model was ticked.

## Details

- The list showed how many models were ticked out of how many were listed, with **Select all** and **Select none**. A list of more than 10 models added a filter box by model id; the two bulk actions acted on the rows the filter showed, and filtering never changed the tick of a row it hid.
- The rows scrolled inside their own box, so a long list kept the fields above it and the dialog's buttons in place.
- Ids the import could not hold (empty, over 200 characters, carrying control characters) and repeats were left out of the list and still counted as skipped in the result. Unticked models were not counted as skipped.
- Editing the API key, base URL or protocol after the list arrived put the list away until it was fetched again.
- The English result and progress messages said "1 model" and "1 entry" in the singular.

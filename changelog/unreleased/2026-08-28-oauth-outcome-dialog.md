# Authorizing a key says so where you are looking

- **Date:** 2026-08-28
- **Type:** fix
- **Scope:** `web`, `server`
- **PR:** [#532](https://github.com/Prism-Shadow/penguin-harness/pull/532)

[中文版](2026-08-28-oauth-outcome-dialog.zh.md)

Minting a provider key with **Authorize key** sends the user to the provider's own page in
another tab. The key landing was announced with a toast fired the moment the poll saw it — in a
window nobody was looking at, and faded by the time they switched back. The one step a user
leaves the app for was the one step with no visible result.

The dialog now stays open and reports the outcome itself: it names the provider and how many
models the key was written to, and is dismissed deliberately.

## Details

- Gave the dialog a `done` phase, reached by both paths a key can land through — the redirect
  flow's poll seeing `status: "done"`, and a manually pasted code answering `ok`. The flow's
  controls and the manual/redirect switch leave with it, so what remains is the sentence and one
  button, which dismisses.
- Added `applied` to the flow-status response, so both paths report the count the server wrote
  rather than one of them counting the table in hand. The redemption route already answered with
  it; the status route computed it and dropped it.
- Moved the model table's reload from the moment the key lands to the dismissal, and stopped
  rendering the dialog behind the table's loaded-rows guard. The reload runs only when a key
  actually landed, because it also drops the Project's speed-test measurements.
- Removed the toast string the flow no longer uses.
- Pinned the rule in `test/model-oauth-outcome.test.ts`: both success paths settle into `done`,
  neither the dialog nor its caller toasts the outcome, the sentence carries the provider and the
  count in both dictionaries, the done footer offers no cancel, and the dialog is neither gated on
  the loaded rows nor reloaded from the success handler.

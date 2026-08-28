# Authorizing a key says so where you are looking

- **Date:** 2026-08-28
- **Type:** fix
- **Scope:** `web`

[中文版](2026-08-28-oauth-outcome-dialog.zh.md)

Minting a provider key with **Authorize key** sends the user to the provider's own page in
another tab. The key landing was announced with a toast fired the moment the poll saw it — in a
window nobody was looking at, and faded by the time they switched back. The one step a user
leaves the app for was the one step with no visible result.

The dialog now stays open and reports the outcome itself: it names the provider and how many
models the key was written to, and is dismissed deliberately.

## Details

- The dialog gained a `done` phase, reached by both paths a key can land through — the redirect
  flow's poll seeing `status: "done"`, and a manually pasted code answering `ok`. The flow's
  controls and the manual/redirect switch leave with it, so what remains is the sentence and one
  button.
- Done is an outcome rather than a choice, so the footer is a single dismissal: a cancel beside
  it would offer to undo a key the server has already stored.
- The model table reloads when the dialog is dismissed, not when the key lands, and the
  dialog does not render behind the table's own loaded-rows guard. Reloading blanks the rows
  for the length of a request, so a dialog gated on them would be unmounted mid-flow by the
  very success it was reporting — and remounting starts a fresh authorization, handing the
  user back the page they had just finished. Waiting for the dismissal keeps the masked key
  arriving with the reload and keeps the outcome on screen until it is read.
- `test/model-oauth-outcome.test.ts` pins the rule rather than leaving it to memory: both success
  paths settle into `done`, neither the dialog nor its caller toasts the outcome, the sentence
  carries the provider and the count in both dictionaries, the done footer offers no cancel, and
  the dialog is neither gated on the loaded rows nor reloaded from the success handler.
  It reads the real source — the dialog is module-private, and exporting it so a test could mount
  it would widen the module's surface to check a rule about its own text.

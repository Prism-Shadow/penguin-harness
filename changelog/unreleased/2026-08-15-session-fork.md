# Fork Sessions from completed replies

- **Date:** 2026-08-15
- **Type:** feat
- **Scope:** `web`, `server`, `docs`
- **PR:** [#297](https://github.com/Prism-Shadow/penguin-harness/pull/297)
- **Issue:** [#293](https://github.com/Prism-Shadow/penguin-harness/issues/293)

[中文版](2026-08-15-session-fork.zh.md)

Completed root assistant replies now have a **Fork** action beside Copy. The new Session keeps the same Project, Agent, model, Workspace, approval mode, and title while truncating its transcript at the selected completed Task.

Forks own independent Trace shards and a recursive scratchpad snapshot. Local image/file marker paths are rewritten to the new Session id, so attachments keep rendering after either Session is deleted. The server rejects forged or unsafe Trace positions and refuses to fork while the source is running or compacting.

## Fork asks before it duplicates

The fork action sits to the **right of the copy button**, and clicking it opens a confirmation dialog (the shared `ConfirmModal`) explaining that the conversation is duplicated into a new chat up to that reply. The fork request only fires on Confirm; plain copy stays an unconfirmed one-click action.

## Deleting a Session no longer re-fetches it

Deleting the conversation you are looking at — the normal way to discard a fork you just tried — left one `[http] session_not_found` record behind on every delete, visible in the Cost Center's error panel.

The chat page resolves a routed Session that is missing from the paged list with a direct lookup, which is right for a deep link but guaranteed to 404 for a row this client had just deleted. The Session list now tombstones ids it deletes, and that lookup consults the tombstones first and skips the request. The ordering between pruning the list and changing the route is deliberately no longer the mechanism: the list lives in a zustand store whose updates are not subject to React's transition lanes, so scheduling cannot sequence the two reliably.

# Fork Sessions from completed replies

Completed root assistant replies now have a **Fork** action beside Copy. The new Session keeps the
same Project, Agent, model, Workspace, approval mode, and title while truncating its transcript at
the selected completed Task.

Forks own independent Trace shards and a recursive scratchpad snapshot. Local image/file marker
paths are rewritten to the new Session id, so attachments keep rendering after either Session is
deleted. The server rejects forged or unsafe Trace positions and refuses to fork while the source
is running or compacting.

Review follow-up: the fork action now sits to the right of the copy button, and clicking it opens
a confirmation dialog (the shared ConfirmModal) explaining that the conversation is duplicated into
a new chat up to that reply — the fork request only fires on Confirm, while plain copy stays an
unconfirmed click. Also fixed: deleting the open chat (the standard way to discard a tried fork)
no longer re-fetches the just-deleted Session — the sidebar's list removal used to commit one
render ahead of the router's navigation transition, and the chat page's deep-link probe GET-ed the
deleted id in between, logging a spurious `session_not_found` on the server for every fork
deletion.

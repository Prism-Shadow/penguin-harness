# Fork Sessions from completed replies

Completed root assistant replies now have a **Fork** action beside Copy. The new Session keeps the
same Project, Agent, model, Workspace, approval mode, and title while truncating its transcript at
the selected completed Task.

Forks own independent Trace shards and a recursive scratchpad snapshot. Local image/file marker
paths are rewritten to the new Session id, so attachments keep rendering after either Session is
deleted. The server rejects forged or unsafe Trace positions and refuses to fork while the source
is running or compacting.

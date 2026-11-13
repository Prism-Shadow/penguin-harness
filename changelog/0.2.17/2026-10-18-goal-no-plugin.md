# Goal mode without its plugin no longer leaves an empty conversation in the list

- **Date:** 2026-10-18
- **Type:** fix
- **Scope:** `web`, `server`, `cli`
- **PR:** [#1205](https://github.com/Prism-Shadow/penguin-harness/pull/1205)

[中文版](2026-10-18-goal-no-plugin.zh.md)

Sending a goal from a new conversation on an Agent without the goal plugin could leave a row in the sidebar that opened to "No Sessions yet": the server created the Session, refused its first Task, and the page deleted it — but the sidebar's own refresh, started when the Session was announced, had already read it and put it back. The composer now says the plugin is missing as soon as goal mode is engaged and installs it in one click, and a conversation whose first Task is refused leaves nothing behind.

## Details

- With the goal chip engaged, the composer checks the plugins installed on the conversation's Agent (on the machine that holds it, for a machine's Agent). While the goal plugin is missing, a notice above the input says goal mode needs it and offers **Install on this Agent**, and Send is held; nothing is created until it is installed. A failed install says why in a toast and the notice stays. A check that cannot be read holds nothing, and the server's refusal still applies.
- A Session created for a first Task that is then refused or fails — on the new-chat page, from `/model` and from `/agent` — is taken out of the list before it is deleted on the server, and the list no longer shows a Session it knows was deleted, whatever answer carries it. A deletion heard while the list is being fetched discards that fetch and fetches again, so the counts stay right too.
- The server refuses a goal on an Agent without the goal plugin's hook package before it loads the Session, instead of loading it only to answer `goal_plugin_not_installed`.
- `penguin chat`: when the server refuses the first message of the Session it just created (a 4xx, such as a goal without the plugin or a model without a credential), that Session is deleted and the message is kept, as it is when creating the Session fails; the next Enter creates a new one with the same settings. It no longer stays behind as an empty conversation in every Web sidebar.
- A Playwright scenario (`packages/web/e2e/goal-no-plugin.spec.mjs`) sends a goal that the server refuses while the sidebar's answer is delayed and checks that no row is left, then installs the plugin from the notice and sends. It runs with the whole browser suite (`pnpm --filter @prismshadow/penguin-web test:e2e`), not in CI's smoke job.

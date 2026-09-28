# GitHub Copilot, built in

- **Date:** 2026-09-25
- **Type:** feat
- **Scope:** `server`, `web`

**Models → Built-in** is a new tab for agents Penguin downloads, runs and updates itself.
Its first is GitHub Copilot: an admin pastes a fine-grained personal access token with the
**Copilot Requests** permission and clicks **Set up**, and Penguin downloads the Copilot
program for the server machine from npm, checks it against its published checksum, and
registers "GitHub Copilot (built-in)" as a coding agent. It then appears in the chat model
picker and the activity editor's Generation agent list, and runs like the other coding
agents, with nothing installed by hand.

The version is pinned with each Penguin release; when a newer one is pinned, the card
offers **Update**. **Replace token** and **Remove** are on the card. The built-in agent
keeps its own Copilot settings folder, apart from any Copilot login on the machine.
Setting the `PENGUIN_NPM_REGISTRY` environment variable points the download at a mirror.

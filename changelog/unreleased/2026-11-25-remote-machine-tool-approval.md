# New conversations on a machine start from that machine's Sandbox default

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1862](https://github.com/Prism-Shadow/penguin-harness/pull/1862)

[中文版](2026-11-25-remote-machine-tool-approval.zh.md)

Fixed tool calls in a new conversation on another machine never raising an approval request when that machine's Sandbox default preset asks first. The new-chat page had sent the approval mode it read from this server's Sandbox settings with every create request. It was changed to read its permission menu and default from the machine the Session will run on, and to name an approval mode only when the person picked one or the Project's new-chat defaults set one, leaving every other case to that machine's own default preset.

## Details

- Until that machine's settings arrived, the new-chat page's permission button showed "…" and did not open, instead of showing a mode taken from another server.
- The new-chat draft stopped saving an approval mode nobody picked.
- More… in the permission menu opened the Agent Sandbox page of the conversation's own machine, on the new-chat page, in a conversation and in the subagent panel.

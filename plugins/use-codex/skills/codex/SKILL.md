---
name: codex
description: Connect a ChatGPT subscription and delegate explicit coding tasks to Codex through Penguin's MCP tools and ACP. Use for Codex sign-in, model discovery, coding delegation, progress, approvals, cancellation, and follow-up tasks.
---

# Codex delegation

Penguin owns the parent task and final review. Codex runs its own delegated agent loop through the maintained Codex ACP adapter. Use only when the user asks to connect or delegate to Codex. This uses the ChatGPT subscription through Codex; it does not add an OpenAI provider or a model-picker entry.

## Before you start

If invoked without a task, ask whether the user wants to connect or delegate and which workspace to use. For an explicit task, proceed within its scope. **Codex has workspace write access and can edit files without a separate approval prompt.** Use Penguin's own tools for work requiring a read-only execution guarantee. The adapter's legacy `read-only` mode ID means workspace-write with on-request human approvals; never describe it to the user as read-only.

## Connect once per project

Requires Node 24+ on the Penguin server. The plugin includes pinned `@agentclientprotocol/codex-acp` 1.12.0 and its compatible Codex runtime; no globally installed Codex executable is needed.

If `mcp__codex__codex_status` is available, call it. Otherwise add an MCP entry in the Agent's **Settings → Tools → MCP**. Resolve the packaged server from the Penguin installation directory (where its core or CLI package can resolve plugin dependencies):

```sh
node -p "require.resolve('@penguinharness/use-codex/server')"
```

For a source checkout the server is `<repository>/plugins/use-codex/src/server.mjs`. Runtime files stay in the plugin package so their dependencies resolve normally; they are not copied into the installed skill directory. Use the absolute resolved path:

```json
{
  "name": "codex",
  "config": {
    "command": "node",
    "args": ["<absolute packaged server.mjs path>", "--project-dir", "<App Data Dir>"],
    "timeoutMs": 60000,
    "maxOutputLength": 180000
  }
}
```

`<App Data Dir>` is the Penguin project data directory from Penguin's environment, not the repository. All sessions in that project share its subscription. Preserve other MCP entries. Leave the working directory unset so Penguin supplies the session workspace. Do not set `permission: "r"`; starting tasks and answering approvals are write operations. Start a new session after saving.

Call `codex_connect`, then poll `codex_status` for the verification URL and message containing the device code. Show both to the user and wait for sign-in. Poll until connected or failed. Device login may need enabling in ChatGPT security settings. Never authorize on the user's behalf, read/copy `auth.json`, or ask for tokens. Codex stores and refreshes credentials under `<App Data Dir>/coding-agents/codex`; host API keys and desktop Codex credentials are not inherited. `codex_disconnect` cancels pending login and signs out; if login is still starting, poll and retry.

## Delegate and follow up

1. Call `codex_models` to discover model IDs. This opens and closes an unprompted ACP session; it does not run inference.
2. Call `codex_run` with a bounded prompt specifying scope, deliverable and checks. Tasks use workspace-write, on-request approvals and a human reviewer. No automatic approval or unrestricted mode is exposed. There is no `sandbox` argument.
3. Retain `task_id` and `thread_id`. Poll `codex_poll` with the last cursor, communicating meaningful progress. `truncated: true` means older output was dropped; do not treat it as a complete review.
4. Relay pending requests to the human. For permissions, `codex_respond` takes `decision: "accept"`, `"decline"` or `"cancel"`; only one-time options are supported. For form questions, relay the message and schema, then send the user's `answers` object with `decision: "accept"`. Never infer consent or invent answers. Requests expire after five minutes and interrupt the task. Unsupported requests, including task-time URL elicitation, are cancelled.
5. Poll until `completed`, `stopped`, `failed` or `interrupted`. `stopped` can mean a token limit or refusal; inspect the reported stop reason. `codex_cancel` requests interruption; wait for terminal status before editing the same files. Tasks have a thirty-minute limit with termination fallback. Closing MCP cancels work. One task runs per connection; avoid simultaneous edits from separate Penguin sessions.
6. Review results and diffs, run appropriate checks through Penguin, and report actual verification. Resume with the saved `thread_id`; task IDs are local to the MCP connection, while Codex sessions persist in the project home.

ACP subscription limits are unavailable (`limits: null`); do not invent limits or dollar costs. This plugin makes Penguin an ACP client for delegation. It does not implement an editor-facing `penguin acp` agent endpoint.

References: [Codex ACP adapter](https://github.com/agentclientprotocol/codex-acp), [ACP](https://agentclientprotocol.com/).

---
name: codex
description: Connect a ChatGPT subscription and delegate explicit coding tasks to Codex through Penguin's MCP tools. Use for Codex sign-in, model discovery, coding delegation, progress, approvals, cancellation, and follow-up tasks.
---

# Codex delegation

Penguin owns the parent task. Codex runs a separate delegated coding task through the official `codex app-server` stdio API. Use this skill only when the user asks to connect or delegate to Codex. This is subscription access through Codex, not an OpenAI API key or a model in Penguin's model selector.

## Before you start

If the user only invokes this skill without a task, ask whether they want to connect their subscription or delegate a coding task, and which workspace to use. For an explicit task, proceed within its scope.

## Connect once per project

The bridge was verified against Codex CLI 0.146.0 and its generated v2 schema. If a different release rejects a protocol field, report the mismatch; do not weaken its approval or sandbox settings to make it run.

Requires Node 24+ and the official Codex CLI on the server machine. On Windows use an actual `codex.exe`, not a `.cmd` or `.ps1` shim. If necessary set `PENGUIN_CODEX_EXECUTABLE` in the MCP entry's `env` to the absolute executable path. Do not download or select a different executable without identifying it to the user.

If `mcp__codex__codex_status` is already available, call it. Otherwise configure an MCP server in this Agent's **Settings → Tools → MCP** using the following fields. Resolve the paths from this installed skill's location and the **App Data Dir** line in Penguin's environment. `--project-dir` is the Penguin project data directory, NOT the workspace/repository, so all sessions in this project share one Codex sign-in. Do not use another project's directory.

```json
{
  "name": "codex",
  "config": {
    "command": "node",
    "args": ["<absolute path to this skill>/scripts/server.mjs", "--project-dir", "<App Data Dir>"],
    "timeoutMs": 60000,
    "maxOutputLength": 120000
  }
}
```

Keep the MCP working directory unset: Penguin supplies the session workspace. Preserve other MCP entries. Do not set `permission: "r"`; task starts and approval answers must remain read-write tools. Start a new session after saving to load the tools. The bridge's scripts are copied with the skill when the plugin is installed.

Call `codex_connect`, show its verification URL and device code, then wait for the user to sign in. Call `codex_status` to confirm the connected account. Device login may need enabling in ChatGPT security settings. Never authorize on the user's behalf, read/copy `auth.json`, or ask for a token. Codex stores and refreshes credentials under `<App Data Dir>/coding-agents/codex`. All project members using this connection share the subscription. `codex_disconnect` cancels a pending login and signs out this project's account.

## Delegate and follow up

1. Call `codex_models` when selecting a model; use returned IDs, never a static list.
2. Call `codex_run` with a bounded prompt specifying scope, expected deliverable, and checks. Default `sandbox` is `read-only`; choose `workspace-write` only for a user-authorized editing task. Codex still asks for approvals according to its own policy. No unrestricted sandbox is exposed.
3. Retain both `task_id` and `thread_id`. Poll `codex_poll` with the last returned `cursor` every few seconds, communicating meaningful progress. Output is bounded; `truncated: true` means some older events are no longer retained. Do not treat truncated output as a complete review.
4. When `requests` is nonempty, relay the request and options to the user. Call `codex_respond` with their decision and the exact `request_id`; never invent an answer. Command/file approvals accept `accept`, `decline`, or `cancel` for one request. User-input requests take `answers: { "question-id": ["user answer"] }`. Requests expire after five minutes, interrupting the task. Unsupported request types fail closed.
5. Poll until `completed`, `failed`, or `interrupted`. Task launch is not completion. `codex_cancel` requests interruption; poll until it takes effect. Tasks have a 30-minute limit and stop when the MCP connection closes. One task runs per connection; avoid simultaneous editing of the same files from different Penguin sessions.
6. Review Codex's result and repository diff, run appropriate checks through Penguin, and report what was actually verified. For follow-ups, pass the saved `thread_id` to `codex_run`; task IDs belong to the current MCP connection, while Codex threads persist in its project home. After a reconnect, explicitly resume the saved thread, never silently start a fresh one.

Keep subscription usage in its own units (`codex_status` reports limits). Do not invent dollar costs or claim unlimited usage. No ACP or provider emulation is involved.

Official references: [app-server](https://learn.chatgpt.com/docs/app-server), [authentication](https://learn.chatgpt.com/docs/auth).

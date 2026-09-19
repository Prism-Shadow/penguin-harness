# Use Codex

Install **Use Codex** from Penguin's Plugins library onto an agent, then follow the installed **codex** skill to configure the packaged MCP server and connect a ChatGPT subscription with a device code. Node 24+ is required. The package pins `@agentclientprotocol/codex-acp` 1.12.0 and ACP SDK 1.4.0; the adapter supplies its compatible Codex runtime.

The execution path is Penguin MCP tools → reusable ACP client → maintained Codex adapter → Codex. Penguin retains the parent task, its own tool approvals and final review. Codex owns the delegated task's agent loop. AgentHub and Penguin's model picker are unchanged. The ACP client lives in `src/acp-client.mjs`; Codex-specific process settings and its authentication-status extension live in `src/codex-profile.mjs`.

**Delegated tasks can write workspace files.** The fixed policy is workspace-write, on-request approvals and a human reviewer. The adapter calls this mode `read-only`, but it is not a read-only sandbox. Ordinary workspace edits may proceed without a prompt. Automatic approval and full-access modes are not offered.

Tools: `codex_status`, `codex_connect`, `codex_disconnect`, `codex_models`, `codex_run`, `codex_poll`, `codex_cancel`, `codex_respond`. Progress uses bounded cursor-based polling. Each connection runs one task at a time. Save the returned thread ID for explicit resumption after reconnecting. Human requests expire after five minutes; tasks are limited to thirty minutes, with cancellation and termination fallback. Permission responses allow/reject once; forms relay schema-validated human answers. Unsupported requests are cancelled. Subscription limits are not available through this adapter integration.

Credentials are managed by Codex under `<Penguin project data directory>/coding-agents/codex`, shared by that project's sessions. The subprocess does not inherit desktop Codex credentials, host API keys or adapter overrides. Keep the directory private; normal OS permissions apply.

The runtime stays in this npm package so its SDK dependencies resolve. Locate it with `require.resolve('@penguinharness/use-codex/server')` from the Penguin core/CLI installation directory, or use `plugins/use-codex/src/server.mjs` in a checkout. The installed skill contains instructions, not a copied runtime. No Coding Agents page or editor-facing ACP agent endpoint is included. Live sign-in and subscription-backed work require the user's account after installation.

Run `pnpm --filter @penguinharness/use-codex test` for bridge and SDK transport tests. Set `PENGUIN_TEST_CODEX_ACP=1` to additionally initialize the published adapter in an isolated temporary home; that smoke test performs no login or inference.

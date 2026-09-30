# The sandbox confines hook scripts and the file tools, with the scratchpad writable

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `core`, `server`, `plugins`, `docs`
- **PR:** [#TBD](https://github.com/Prism-Shadow/penguin-harness/pull/TBD)
- **Breaking:** yes — in a confining sandbox mode the file tools and hook scripts are confined like commands and cannot write memory or Agent State; `scriptStopHook` / `scriptPreToolUseHook` / `scriptUserPromptHook` take an options object

[中文版](2026-09-29-sandbox-hooks-and-file-tools.zh.md)

The Session's sandbox policy, which had confined only the commands an agent runs, was extended to the hook scripts its Session runs and to the file tools `read_file`, `edit_file` and `write_file`. Under `workspace-write`, the Session's scratchpad (`<agent>/scratchpad/<session_id>`, where the plan file, a goal's state file and the attachments live) became writable beside the Workspace and the temporary directory, for all three.

## Details

- **One policy, two seams.** The policy stayed the `SandboxSettings` snapshot on the Session's row (mode, network, masked paths, writable temp), shared by its subagents. It reached core through `confineSpawn` for everything core spawns, and through a new `CreateAgentOptions.sandboxPolicy(ctx)` for the file tools: the same shape as `confineSpawn`, evaluated with the Session's coordinates, re-read at every call and inherited by subagents' Agents, then passed on as `EnvironmentConfig.sandboxPolicy`. The server's `SessionEnv` gained `sandboxPolicy(ctx)`, answered from the per-Session snapshot the confiner reads (`policyOf` in `runtime/session-manager.ts`) and forwarded through `session-service.ts` and the core Session loader.
- **Hook scripts.** `runHookScript` took `confine?: (argv) => ConfinedSpawn` and spawned the argv it returned, with the runner's environment entries laid over the script's. `scriptStopHook`, `scriptPreToolUseHook` and `scriptUserPromptHook` took an options object, `ScriptHookOptions`: `timeoutS`, `pathPrepend`, a `confineSpawn` getter re-read at every run, and `scope: { workspaceDir, scratchpadDir }`, plus `trigger` for the user-prompt adapter. `Agent.sessionHooks` bound the Session's confiner and scope into every installed command, so a script was confined as `node <script>` with its package directory as cwd. A confiner that threw failed the hook with a `sandbox: …` error, recorded as `hook failed: sandbox: …` like any hook failure; the script did not run.
- **File tools.** They run in the harness process, so core applied the policy itself: `SandboxFileAccess` (`environment/tools/file-access.ts`), built per call from the policy as it stood and handed to the tool as `ToolExecutionContext.fileAccess`. `denyWrite` decided on the real path where the write lands, following symlinks and resolving a missing tail through its deepest existing ancestor. Under `workspace-write` it allowed the Workspace, the scratchpad and the temporary directory; under `read-only`, the temporary directory alone; the temporary directory only while `writableTemp` was not `false`. A masked path was refused for reading and writing in every mode (`denyRead`), and `read_file`'s http(s) source followed the network level (`denyUrl`): nothing under `none`, loopback hosts under `local`. A refusal ended the call `fatal` with one sentence for the model starting `Denied by the sandbox:` and naming the mode and the writable directories. With no policy, or the sandbox off, nothing was refused.
- **The scratchpad reached the backends.** `SpawnConfiner`'s options gained `scratchpadDir`, and the server's `confinerFor` put it into a new optional field of the plugin contract, `SandboxPolicy.writableRoots`. Under `workspace-write`, bwrap and Seatbelt added it to their writable roots, and WSL bound it into the distro at its translated path when the distro could reach it. A backend that ignores the field confines more narrowly, not more widely, so no dimension guards it.
- **Docs and skill.** The Settings (Sandbox), Tools & Approval (File tools), The Agent Loop (Hooks), Skills & Plugins (Hook packages), Core Interfaces and Server Boot and Subsystems pages described the three executors, the writable directories and the new seams. The `agent-initialization` skill said that a hook runs under the Session's sandbox, and its hooks reference listed the `sandbox:` failure.

## Not covered

- MCP Servers started over `stdio` stayed unconfined; the host spawns them from the configuration.
- Memory and Agent State (`AGENTS.md`, `system_config.yaml`, the vault, Skills, hook packages, scheduled tasks) stayed outside the writable directories of both confining modes. A confined agent could not write memory, write its own Skills or hook packages, or change its configuration, and so could not add an MCP Server either; those took full access.
- A change the injected `penguin` CLI makes through the server API (a scheduled task, a plugin install) travels over the network, not the file system, so only the network level bounds it: under `none` that route is closed.
- The DSH adaptor passed DSH only the mode and the Workspace, so under DSH commands and hook scripts could not write the scratchpad.
- Under the WSL backend hook scripts could not run, because the distro has no Node for `node <script>`: every hook failed there instead of running unconfined.

## Compatibility

- A Session whose policy confines has its file tools and hook scripts confined from their next call, open conversations included. Writes to memory, Skills, hook packages and the agent's configuration are refused; switch a conversation that needs them to full access with its **Permissions** button. Nothing changes for a Session whose sandbox is off.
- Under DSH, hooks that write the scratchpad fail, goal mode's among them; under WSL, every hook fails. A conversation that needs its hooks there runs with full access.
- SDK: pass the former `timeoutS` and `pathPrepend` arguments of `scriptStopHook`, `scriptPreToolUseHook` and `scriptUserPromptHook` as the fourth argument, `{ timeoutS, pathPrepend }`.

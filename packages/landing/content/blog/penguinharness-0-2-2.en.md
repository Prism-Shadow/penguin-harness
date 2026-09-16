---
title: "PenguinHarness 0.2.2: long-term memory and MCP Server support"
date: 2026-08-11
category: news
excerpt: 0.2.2 gives agents long-term memory across Sessions, with a Memory tab to manage it, and adds MCP Server support over three transports. Prompt sections become editable and switchable, agent configs gain a kernel version, and a Trace corruption bug is fixed.
---

PenguinHarness 0.2.2 is out. Earlier releases gave agents their working tools: file tools, subagents, Skills and scheduled tasks. This release gives them a memory, so what an agent learns in one Session is there for the next. It also adds MCP Server support, prompt sections you can edit and switch off, and a version stamp for the agent configuration itself.

## Memory

Each agent keeps long-term notes under `agent_state/memory/`, in two scopes. The user scope is read by every Session. Workspace scopes are tied to the directory the agent works in, so notes about one project never leak into another. A temporary Workspace gets no scope of its own, because no later Session would ever come back to read it.

Only the `MEMORY.md` indexes enter the context, capped at 200 lines and 25,000 characters per scope, with an explicit truncation note past the cap. Topic files stay on disk until the model opens them with its ordinary file tools.

Writing works the same way. The model saves and merges its own notes by editing files, and the harness keeps those writes inside the memory directories. No new tool was added for any of this.

Agent settings gain a **Memory** tab that lists every memory grouped by scope. You can view a memory, delete it (its index line is removed at the same time), or edit it through a prefilled chat with the agent itself. The two memory prompts are editable at the bottom of the tab.

Agents created before Memory existed are unaffected: a template without the `{{MEMORY}}` placeholder injects nothing. The tab points this out and offers a one-click insert.

## MCP Servers

Agents can now use tools from MCP (Model Context Protocol) servers. Support is built on the official TypeScript SDK v2 and covers three transports: stdio, Streamable HTTP and legacy SSE.

Server tools appear as `mcp__<server>__<tool>` and follow the existing execution and approval rules. A tool that the server marks with `readOnlyHint` gets read-only permission. Vault values never reach an MCP server process.

The **MCP Servers** section of the agent's **Tools** tab, which used to show the configuration as read-only JSON, now manages servers with forms: add, edit and delete them, and test a connection on the spot. An unreachable server is skipped with a warning instead of stalling Session creation. While servers connect, the chat shows the progress as step rows instead of silently hanging on your first message.

This is the release's one breaking change: the toolset record moves from `session_meta.tools` to a new `tool_list_ready` event. Traces written before the change no longer display their embedded tool record.

## Prompt sections you can edit and switch off

Memory's way of injecting its prompt now covers the three other subsystems that add text to the system prompt: Vault, Skills and Schedules. For these sections, the system-prompt template now holds only the placeholders `{{VAULT}}`, `{{SKILLS}}` and `{{SCHEDULES}}`. Each one expands to a prompt stored with the agent, which you can edit at the bottom of the matching tab, behind an enable switch at the top.

The switch only controls what the model sees. Turning a section off removes it from the system prompt, but the feature keeps working: Vault values still reach shell subprocesses as environment variables, installed Skills can still be invoked explicitly, and scheduled tasks still fire on time.

### Schedule tasks from chat

The default Schedules prompt is new. It teaches the model to manage the TOML files under `agent_state/schedule/` with its file tools. The prompt spells out the field rules, the five-minute minimum period, and that the server picks up changes within about thirty seconds, and it comes with the list of existing tasks. You can now ask for something like "run the test suite every morning at nine" in chat, and the model writes the file itself.

### Existing agents

Existing agents baked the old template sections in when they were created, and those templates keep working as they are. Where the stock wording is intact, the tab offers a one-click migration to the placeholder form. Hand-edited sections are left alone.

## A kernel version for agent configs

An agent's `system_config.yaml` is fixed when the agent is created and never upgraded behind your back. That keeps behavior predictable, but until now it also meant newer defaults only reached new agents.

0.2.2 stamps each config with a kernel version: a date that records which generation of built-in defaults the config came from. Creating or restoring the config writes the stamp, and ordinary edits leave it alone. A guard test in CI fails whenever the defaults change without a new date, so the stamp cannot fall behind.

On the agent overview, **Update kernel** now sits beside **Restore default configuration**. It merges field by field:

- Values that still match any recorded generation move to the new default.
- Customized values are kept and listed by readable names.
- Values of unknown origin are kept, to be safe.

**Restore default configuration** is still there when you want a full reset.

## Core runtime

The default `max_turns` is now -1, which means no turn limit. Request caps and the compaction threshold now derive from the model's context window, so small-window vLLM-class deployments no longer need hand tuning.

The LLM retry ladder now starts at two seconds, and every failure except a rejected credential is retried.

Trace appends are now serialized, with one `write(2)` per record, and resuming a Session repairs a tail torn by a crash. A large record can no longer be split at the 512 KiB chunk boundary, which is where the occasional Trace corruption some users saw came from.

## Desktop app and Web App

The desktop app gets penguin brand icons on every platform, system notifications when a Task finishes, an explicit single-user mode, and a bundled `penguin` CLI on PATH.

Administrators get a **Proxy options** dialog. The application and the agent environment each have their own switch, and both use one shared proxy address. An empty address follows the system proxy, and loopback traffic always bypasses the proxy.

The Web App collected a month of fixes. The ones worth naming:

- Header statistics fold into a details card, with a click-to-copy Session id and a list of background processes whose **Stop** button works.
- Starting a new chat with unsent text in the composer keeps that text as a draft in the sidebar.
- The initial-password banner can be dismissed for good.
- Clicking the locked-model chip now simply says **Type /model to switch models**.
- Agent detail tabs settle into **Overview**, **System Prompt**, **Runtime**, **Tools**, **Skills**, **Memory**, **Vault** and **Schedules**, and the stat icons in the agent list follow the same order.
- The agent overview is laid out as ruled sections, with a copyable state path.
- The shared toggle switch no longer keeps a gray halo after a click.
- Leaving a running conversation no longer makes the whole app flicker.

## Everything else

- The model catalog adds Thinking Machines Lab's Inkling on OpenRouter and Fireworks AI, and DeepSeek V4 Flash 0731 on Fireworks AI. The GLM-5.1 gateway listings are removed, while the Z.AI direct entry stays. OpenRouter prices are refreshed from its models API.
- The Skill library adds `humanizer`, a Skill you install manually that strips machine-writing tells from prose in any language.
- Dependency overrides force `@hono/node-server` to 2.0.5 or later, fixing a path-traversal advisory in `serve-static` on Windows that came in through the MCP SDK, and `nanoid` to 3.3.17 or later. `pnpm audit` now has nothing to report.
- The release workflow refuses a tag whose version does not match the repository.

The full list is in [changelog/0.2.2](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.2).

## Install or upgrade

Desktop app: download the installer for your platform at [penguin.ooo/download](https://penguin.ooo/download). Starting with this release, the macOS builds are signed and notarized, so Gatekeeper opens them directly. In this release, Windows builds are still unsigned: in SmartScreen, choose "More info → Run anyway".

CLI / server:

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

On Windows, run `irm https://penguin.ooo/install.ps1 | iex` in PowerShell. With Node >= 24, you can also install with `npm install -g @prismshadow/penguin-cli`. On Linux and macOS, upgrade an existing install with `penguin update`.

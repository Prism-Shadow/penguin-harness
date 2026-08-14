---
title: "PenguinHarness 0.2.2: Agents That Remember"
date: 2026-08-11
category: news
excerpt: 0.2.2 gives an agent long-term memory across sessions — a user scope and a per-workspace scope, indexes injected into context, bodies read on demand, a Memory tab to manage it all — plus MCP Server support over three transports. Skills, Vault and Schedules move behind Memory-style editable prompts with enable switches, agent configs gain a dated kernel version whose Update merges new defaults without losing customizations, the core runtime fixes a trace-corruption bug, and the dependency audit comes back clean. The details, item by item.
---

PenguinHarness 0.2.2 is out. Earlier releases gave the agent hands — file tools, subagents, skills, scheduled tasks. This one gives it a memory: what an agent learns in one session is finally there for the next. Alongside it come MCP Server support, switchable prompt injection, and a versioning scheme for the configuration itself.

## Memory

Each agent keeps long-term notes under `agent_state/memory/`, in two scopes. The user scope is read by every session. Workspace scopes are keyed to the directory the agent works in, so notes about one project never leak into another; a temporary workspace gets no scope of its own, since no later session would ever return to read it.

Only the `MEMORY.md` indexes enter the context, capped at 200 lines and 25,000 characters per scope with an explicit truncation note past the cap. Topic bodies stay on disk until the model opens them with the ordinary file tools. Writing works the same way: the model saves and merges its own notes through file edits, and the Harness confines those writes to the memory directories. No new tool was added for any of this.

Agent settings gain a Memory tab: every memory grouped by scope, with viewing, deletion (the index line is pruned in the same stroke) and editing through a prefilled chat with the agent itself. The two memory prompts are editable at the bottom of the tab. Agents created before Memory existed are untouched: a template without the `{{MEMORY}}` placeholder injects nothing, and the tab says so, offering a one-click insert.

## MCP Servers

Model Context Protocol support lands on the official TypeScript SDK v2, covering stdio, Streamable HTTP and legacy SSE transports. Server tools appear as `mcp__<server>__<tool>` under the existing execution and approval contract, with `readOnlyHint` mapping to read-only permission. Vault values never reach an MCP server process. An unreachable server is skipped with a warning rather than stalling session creation, and the connection wait streams into the chat as step rows instead of freezing the "new session" button.

Management is form-based: the agent settings page adds an MCP Server section with create, edit, delete and an on-the-spot connectivity test. The toolset record moves from `session_meta.tools` to a new `tool_list_ready` event — the one breaking change in this release. Traces written before the split no longer display their embedded tool record.

## Prompt injection: placeholders, switches, editable text

Memory's injection pattern now covers the other three prompt-borne subsystems. The system-prompt template carries only `{{VAULT}}`, `{{SKILLS}}` and `{{SCHEDULES}}` placeholders; each expands to a prompt stored with the agent, editable at the bottom of its tab, behind an enable switch at the top. The switch governs only what the model sees: turning a section off removes it from the system prompt while everything underneath keeps running, so Vault values reach shell subprocesses as environment variables and scheduled tasks fire on time whether or not the model is told about them.

The default Schedules prompt is new. It teaches the model to manage the TOML files under `agent_state/schedule/` with its file tools, spelling out the field rules, the five-minute floor on periods and the server's reconciliation within about thirty seconds, with the roster of existing tasks injected alongside. A request like "run the test suite every morning at nine" can now be made in chat, and the model writes the file itself.

Existing agents baked the old template sections at creation, and those templates keep working as they are. Where the stock wording is intact, the tab offers a one-click migration to the placeholder form; hand-edited sections are left alone.

## A kernel version for the config

`system_config.yaml` is frozen at agent creation and never upgraded behind the user's back. The behavior is predictable; the cost, until now, was that newer defaults only ever reached new agents. 0.2.2 stamps each config with a kernel version: a date recording which generation of built-in defaults it came from, written at creation and restore, untouched by ordinary edits.

Bumping that date on any substantive defaults change is not left to discipline. A guard test pins the hash of every leaf default to the latest entry of a version history table, so a defaults change without a registered bump fails CI. On the overview, an Update control sits beside "restore defaults" and merges field by field: values still matching any recorded generation advance to the new default, customized values are kept and reported by readable names, and values of unknown origin are conservatively kept. Restore remains the full-refresh escape hatch.

## Core runtime

The default `max_turns` becomes -1, request caps and the compaction threshold now derive from the model's context window, and small-window vLLM-class deployments no longer need hand tuning. The LLM retry ladder starts at two seconds, and every failure short of a rejected credential is retried.

Trace appends are serialized, one `write(2)` per record, and resumption heals crash-torn tails, so a large record can no longer be split at the 512 KiB chunk boundary. The occasional trace corruption some users hit came from exactly that seam, and this release closes it.

## Desktop and Web App

The desktop app picks up penguin brand icons on every platform, system notifications on task completion, an explicit single-user mode, and a bundled `penguin` CLI on PATH. Administrators get a proxy options dialog: separate switches for the application and the agent environment sharing one proxy address, an empty address following the system proxy, loopback always exempt.

The Web App accumulated a month of fixes; the ones worth naming: header statistics fold into a details card with a click-to-copy session id and a background-process list whose Stop button works; typed-but-unsent text parks as sidebar drafts; the initial-password banner can be dismissed for good; the locked-model chip now just says "type /model to switch models"; detail tabs settle into Overview, System Prompt, Runtime, Tools, Skills, Memory, Vault, Schedules, with the list's stat icons in the same order; the overview becomes ruled sections with a copyable state path; the shared toggle switch loses the gray halo it kept after every click; and leaving a running conversation no longer flickers the whole app.

## Everything else

The model catalog adds Thinking Machines Lab's Inkling on OpenRouter and Fireworks AI, and DeepSeek V4 Flash 0731 on Fireworks; GLM-5.1 gateway listings are delisted while Z.AI direct remains; OpenRouter prices are refreshed from the official API. The skill library gains `humanizer`, a manual-install skill that strips machine-writing tells from prose in any language — this post was drafted by its method. Workspace overrides force `@hono/node-server` to 2.0.5 or later (a path-traversal advisory in `serve-static` on Windows; the vulnerable copy came transitively from the MCP SDK) and `nanoid` to 3.3.17 or later, leaving `pnpm audit` with nothing to report. The release workflow now refuses a tag whose version disagrees with the repository. The full list is in [changelog/0.2.2](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.2).

## Install or upgrade

Desktop: grab your platform's installer at [penguin.ooo/download](https://penguin.ooo/download). As of this release the macOS builds are signed and notarized, so Gatekeeper opens them directly; Windows builds remain unsigned ("More info → Run anyway" past SmartScreen).

CLI / server:

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows (PowerShell): `irm https://penguin.ooo/install.ps1 | iex`; or with Node >= 24, `npm install -g @prismshadow/penguin-cli`. Existing installs: `penguin update`.

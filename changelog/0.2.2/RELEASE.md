PenguinHarness 0.2.2 — agents that remember and reach further: long-term Memory across sessions, MCP Server support on three transports, every prompt-borne subsystem behind an editable per-agent prompt with a toggle, dated config generations with a no-loss update, and a hardened core runtime.

## Install

**Desktop app**: grab your platform's installer from [penguin.ooo/download](https://penguin.ooo/download) — served from the OSS mirror when it is reachable, GitHub otherwise. Current builds are unsigned: on first launch use right-click → Open on macOS, and "More info → Run anyway" past Windows SmartScreen.

CLI / server (Linux, macOS; bundled Node runtime):

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows (PowerShell):

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

Or via npm (needs Node >= 24):

```sh
npm install -g @prismshadow/penguin-cli
```

## Highlights

**Memory.** An agent now keeps long-term notes between Sessions under `agent_state/memory/` — a user scope every Session reads, plus one scope per Workspace — each with a `MEMORY.md` index. Only the indexes enter the context (200 lines / 25,000 chars per scope), bodies are read on demand, and the model maintains it all through the ordinary file tools. Agent settings gain a Memory tab: memories grouped by scope with view / delete / edit-via-chat, the two Memory prompts editable in place, and a one-click placeholder insert for agents created before Memory existed.

**MCP Servers.** Model Context Protocol support lands on the official TypeScript SDK v2 with three transports — stdio, Streamable HTTP and legacy SSE. Server tools surface as `mcp__<server>__<tool>` under the unchanged execution and approval contract (`readOnlyHint` maps to read-only permission), the vault never reaches server processes, and unreachable servers are skipped with a warning. The agent settings page manages servers with forms and a connectivity test, and session creation no longer blocks on connects — the wait streams into the chat as step rows.

**Prompt injection you can see and switch.** Skills, Vault and Schedules adopt Memory's pattern: the system-prompt template carries only `{{SKILLS}}` / `{{VAULT}}` / `{{SCHEDULES}}` placeholders, each expanding to a per-agent editable prompt behind an enable switch on its tab — and the new Schedules prompt teaches the model to manage scheduled-task TOMLs itself with the file tools. Legacy baked templates keep working unchanged, with a one-click migration where the old default wording is intact.

**Config generations with a no-loss update.** Agent configs now carry a dated kernel version recording which generation of built-in defaults they came from; a hash-pin guard test forces a dated bump on any defaults change. An Update control beside "restore defaults" smart-merges newer defaults while keeping every user-customized field (reported by readable names), with outdated hints on the agent overview and list cards.

**Core runtime hardening.** The default `max_turns` becomes unlimited, request caps and the compaction threshold derive from the model's context window (small-window vLLM-class models work), the LLM retry ladder slows to a 2s base, and Trace appends are serialized with each record landing in a single write — crash-torn tails heal on resumption, so a big record can no longer be split mid-chunk.

## Notable in this release

- **Desktop app polish.** Penguin brand icons on every platform, task-completion system notifications, explicit single-user mode, and a bundled `penguin` CLI on PATH.
- **Admin proxy options.** One dialog with independent "application" and "agent environment" switches sharing one proxy address (empty follows the system proxy), loopback always exempt, live toggle, OS-proxy injection on desktop.
- **Web App UX.** Chat header statistics double as a details card with a copyable Session id and a live background-process list with working Stop; typed-but-unsent text parks as sendable drafts; the seeded admin password is re-printed framed on every start until changed; the schedule form adopts the Project-defaults pickers with a searchable session dropdown; leaving a running conversation no longer flickers the app with a phantom reload.
- **UI polish batch.** The initial-password banner gains a flat dismiss X persisted per user, the locked-model chip says just "type /model to switch models" with a pointer cursor, the agent list's Settings gear matches the sidebar's, detail tabs settle into Overview / System Prompt / Runtime / Tools / Skills / Memory / Vault / Schedules with the stat icons mirroring that order, the agent overview becomes ruled Agent State and Kernel sections with a copyable state path, and the shared toggle switch drops its lingering post-click halo for a snug, symmetric knob.
- **Models.** Thinking Machines Lab's Inkling joins on OpenRouter and Fireworks AI, Fireworks AI gains DeepSeek V4 Flash 0731, GLM-5.1 gateway listings are delisted (Z.AI direct stays), and OpenRouter prices are refreshed from the models API.
- **Skills.** New manual-install `humanizer` library skill — rewrites prose into book/newspaper/encyclopedia register with a measured diagnostic catalog.
- **Release tooling.** The release workflow refuses a tag whose version does not match the repo, ending update-nag drift.
- **Dependencies.** Workspace overrides force `@hono/node-server` ≥ 2.0.5 (path-traversal advisory, transitive via the MCP SDK) and `nanoid` ≥ 3.3.17; `pnpm audit` reports no known vulnerabilities.
- **Breaking (Traces).** The MCP toolset record moves from `session_meta.tools` to a `tool_list_ready` event; Traces written before the split no longer display their embedded tool record.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The desktop app and the CLI installers bundle their own runtime; installing from npm needs Node >= 24. All data stays under `~/.penguin/data`.

Full detail: [changelog/0.2.2/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.2).

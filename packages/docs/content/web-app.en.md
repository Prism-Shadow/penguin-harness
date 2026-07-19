---
title: Web App Guide
description: A page-by-page guide to the Web App — login, chat, Agent management, models, usage, and traces.
---

PenguinHarness ships with a ready-to-use Web App: multi-user login, streaming chat, Agent configuration, model and usage management all happen in the browser. This guide walks through the app page by page. For installation and first launch, see the [Quickstart](/quickstart).

## Source layout

```text
packages/web/src
├── api/          # fetch wrapper · one function per API (DTOs type-only from @prismshadow/penguin-server/api) · SSE wrapper
├── state/        # auth / project / sessions / theme / locale contexts
├── lib/omni/     # OmniMessage stream → view-model reducer; connect-first + dedup stream controller
├── components/   # ui primitives (modal / drawer / select …) and the app layout
└── features/     # chat / agents / skills / models / usage / traces / benchmark / admin pages
```

## Startup and Login

```bash
penguin web
# open http://127.0.0.1:7364
```

The initial account is `admin` / `admin123`. There is no self-registration: accounts are created by an admin on the user-management page, and every new user automatically gets an independent initial Project named `<userId>-default_project`. While the initial password is still in use, a banner prompts the user to change it.

Logins persist for 7 days with sliding renewal; an admin password reset invalidates all of that user's login sessions.

The interface language (中文 / English / system) and theme (light / dark / system) can be switched at any time.

## Chat (/chat)

### Creating a Conversation

A new conversation starts as a draft: pick the Agent, the Workspace (via a server-side directory browser), the approval mode, and the model before sending the first message. The Session is created on first send, and from then on its model and Workspace are locked.

There are four approval modes: `allow-all`, `deny-all`, `read-only` (only read-only tools pass), and `always-ask`. See [Tools and Approvals](/tools).

### Streaming Rendering

- Model text renders token by token; thinking blocks are collapsible;
- Tool cards expand to show arguments and output, with a live timer while running;
- Subagents appear as nested cards; context compaction shows a banner;
- After each Task, a stats line shows tokens, TPS, elapsed time, and cost.

### Input and Shortcuts

- Enter sends, Shift+Enter inserts a newline, and images can be pasted;
- Typing `/` opens the slash menu: trigger context compaction (`/compact`) or toggle installed Skills — chosen Skills are sent along with the message in a `<use_skills>` block;
- Typing `@` mentions another Agent to hand the conversation over to it;
- When human approval is required, tool calls show inline allow/deny buttons in the message stream; the approval mode can be changed mid-Session.

### Files Panel

The files panel browses the Workspace tree, previews files (Markdown / HTML rendered), uploads files (≤ 14MB each), and downloads them.

## Agent Management (/agents)

The list page creates and deletes Agents; clicking through opens the `/agents/:agentId` settings page, organized into tabs:

| Tab | Contents |
| --- | --- |
| Overview | Basic info, plus export / import of Agent State snapshots |
| Prompt | AGENTS.md and system_prompt |
| Runtime | Runtime parameters such as max_turns, model.*, compaction.* |
| Tools | Built-in tool table and MCP server JSON configuration |
| Vault | Environment-variable entries with masked values |
| Schedule | Scheduled tasks (TOML-defined): create, edit, toggle, delete |

Scheduled tasks fire on a fixed period (minimum 5 minutes) and run only while the service is running.

## Skill Library (/skills)

Browse the Skill library by group, install Skills onto an Agent, or quick-invoke one into a chat draft.

## Model Configuration (/models)

A per-Project model table grouped by provider. Models can be added and edited: identity is the `(provider, model_id)` pair, credentials are masked, and context window, pricing, and the vision flag are configurable. You can set the default model and the vision model (which reads images on behalf of session models without image input), and run a connectivity test on any entry. Only Project owners can edit. For concepts, see [Models and Providers](/models).

## Usage (/usage)

- Filters: Agent, model, date range;
- Summary cards: today / last 7 days / cumulative;
- Charts: per-Agent share, per-model success rates, daily Token and cost trends;
- A server error panel summarizing recent server-side error records.

## Trace Browser (/traces)

Drill down Agent → date → Session → Trace file. Per-turn cards show a context-occupancy donut and a cache breakdown, alongside a lane-based execution timeline and the full event list. For the storage model, see [Sessions and Traces](/sessions-and-traces).

## Benchmark (/benchmark)

Read-only scoreboards per Benchmark: switch the metric (score / cost / duration), drill into each Case's runs, and jump to the linked Session and Trace. Works together with the [Self-Improvement](/self-improvement) workflow.

## User Administration (/admin/users)

Admin only: list and create users, reset passwords, and delete users (the built-in admin cannot be deleted).

## Projects and Members

The sidebar provides a Project switcher and supports creating new Projects. Members have two roles, owner and member: owners manage membership and exclusively edit models, Vault, and Schedules, as well as perform deletions.

## Production Deployment

The server hosts the built SPA itself (same origin, SPA fallback), so a single `penguin web` or `penguin server` process is all production needs. The npm package bundles the frontend build; to serve a custom static directory, override it with `PENGUIN_WEB_DIST` — see the [Configuration Reference](/configuration).

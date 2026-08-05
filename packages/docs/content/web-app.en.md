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
└── features/     # chat / agents / skills / models / usage / memory / traces / benchmark / admin pages
```

## Startup and Login

```bash
penguin web
# open http://127.0.0.1:7364
```

The initial account is `admin`; its initial password (of the form `penguin-1234`) is printed in the server startup output on first start. There is no self-registration: accounts are created by an admin on the user-management page, and every new user automatically gets an independent initial Project named `<userId>-default_project`. While the initial password is still in use, a banner prompts the user to change it.

Logins persist for 7 days with sliding renewal; an admin password reset invalidates all of that user's login sessions.

The interface language (中文 / English / system) and theme (light / dark / system) can be switched at any time.

## Chat (/chat)

### Creating a Conversation

A new conversation starts as a draft: pick the Agent, the Workspace (via a server-side directory browser), the approval mode, the model, and the thinking level before sending the first message. The Session is created on first send, and from then on its model and Workspace are locked. Switching the thinking level or the model in the draft makes the switched-to value the new default: the level is written back to the selected Agent's `model.thinking_level` immediately, and the picked model carries over as the next conversation's default. Inside an active session the thinking level is a per-turn parameter: the composer's picker starts out showing the Agent config's level and auto-follows it until touched (sends omit the level, so config edits keep taking effect); a pick sticks for the session and rides on every subsequent send (never written back to the Agent config); the model stays locked per session — the `/model` command switches models the way the `/agent` handoff does: picking a model stages it as a chip in the composer, and **sending** opens a new session for the same Agent on the picked model, keeping the current Workspace, whose first message carries a `[model_switch_from]` source block (source session id, Trace file path, previous model) followed by whatever the composer held (an interface-language auto-line when empty). In the new session that block collapses into a "switched model" banner linking back to the source conversation, and the model reads the source Trace file itself when it needs the earlier history.

There are four approval modes: `allow-all`, `deny-all`, `read-only` (only read-only tools pass), and `always-ask`. See [Tools and Approvals](/tools).

### Streaming Rendering

- Model text renders token by token; thinking blocks are collapsible;
- Tool cards expand to show arguments and output, with a live timer while running;
- Subagents leave a full-width row in the stream, styled like the other collapsed step rows (agent avatar, name, short session id, running spinner, and an amber dot while one of their tool calls awaits approval); clicking it opens the agents side panel — a call graph of that row's Task on top (each node shows its elapsed time; click a node to switch) and the selected child's live conversation below — the child's own user prompts included — where nested tool cards and approvals work exactly as in the main chat. Panel visibility is task-scoped: sending a message that starts a new task closes it by default (entering a session starts closed too), and it comes back when you open it yourself or — on desktop — when the current task spawns a subagent (one auto-open per task; a manual close holds until the next task; never over an open files panel). Opening the panel from the toolbar, or switching sessions, shows the latest Task's graph; a row on an older turn brings back that turn's graph. The agents panel and the Workspace files panel never show together — opening one closes the other. Context compaction shows a banner;
- After each Task, a stats line shows tokens, TPS, elapsed time, and cost.

### Input and Shortcuts

- Enter sends, Shift+Enter inserts a newline, and images can be pasted;
- The "+" menu holds the input add-ons: **image upload**, **file attachment** and goal mode. An attachment can be any type (up to 20 at a time, ≤ 10MB each and 12MB in total; an oversize pick is refused before it is read, so nothing is uploaded to earn the rejection); selected files show as removable chips above the text body in the order they were picked, and a message with attachments and no text is sendable. On send the files are written into the Session's scratchpad — deleted with the Session — and the message gains an `[attached file: <path>]` line per file, which the conversation renders as an "Attached files" notice: the bytes never enter the conversation, the model opens each file by path with its ordinary file tools;
- Typing `/` opens the slash menu: trigger context compaction (`/compact`), hand the conversation over to another Agent (`/agent`), switch the model (`/model`) — both switch commands appear in an active session only, since a draft has nothing to switch and picks its Agent and model up front — or toggle installed Skills — chosen Skills are sent along with the message in a `[use_skills]` block;
- While a Task is running the input stays live and the toolbar keeps a single action button: an empty composer shows **Stop**, and typing turns it into **Send**, whose behavior follows the **mid-run send mode** from the toolbar's More-settings popover (a compact extensible settings panel, also available in draft state; the choice is remembered): **Steer** (default) delivers the text **and any attached images** mid-run as a `[user_steering]` user message with the next turn (an image with no caption sends on its own, and the delivered message renders as a steering chip with its images inside it), **Queue** holds the whole message server-side as a follow-up and auto-sends it as an ordinary new message when the run finishes (an "N queued" hint shows near the input until then; the queue survives page reloads). A draft steering cannot carry — selected skills, file attachments, or a staged `/agent` or `/model` pick, with no text and no image — falls back to the queue for that one send, so the button never sits disabled with Stop displaced;
- **Goal mode** (the "+" menu, or `/goal`) turns the draft into an objective the system loops Tasks against. Attached images ride along and are always sent as scratchpad paths (a goal objective is re-injected as text every round — see [Goal mode](/docs/goal-mode)); text is still required, since a picture alone states no objective, and file attachments are refused. Round 1's bubble shows the attachments in full, later rounds collapse them into a chip that expands on click;
- `/agent` and `/model` stage their pick instead of acting on it: the chosen Agent or model becomes a chip above the text body and nothing is sent yet, so you keep typing — Enter/Send is what hands the conversation over (a new chat for that Agent) or forks it onto the chosen model, carrying the text along; with an empty composer a default message is filled in, and the chip's × cancels. Both chips are cached with the draft, so they survive a reload or a trip to another conversation together with the text. A model fork additionally waits for the Session to be idle — it continues from the Session's Trace, which a running turn or a compaction is still writing — and a line above the composer says so while it waits;
- When human approval is required, tool calls show inline allow/deny buttons in the message stream; the approval mode can be changed mid-Session;
- While the engine waits out a reconnect backoff (≥2s), the retry line shows a live countdown to the next attempt with inline **Retry now** (skips the remaining wait) and **Give up** (the ordinary abort) controls;
- When the model API rejects the Session's credentials (an authentication failure), the composer grays out and disables — recoverably: the Session pins only the model reference, and credentials come from the current Project config. The notice's primary button opens the Models page; saving a new API key there unlocks the composer by itself (open tabs unlock live via a `credentials_updated` event, and after a reload the composer stays unlocked because the credential update is newer than the recorded auth failure). A "Retry" button clears the state manually for another attempt (it re-arms if the key is still bad), a completed request always clears it, and "New Session" remains as the escape to a fresh draft. The disabled composer keeps its draft selectable, so a long message that failed to send can still be copied out.

### Files Panel

The files panel browses the Workspace tree, previews files (Markdown / HTML rendered), uploads files (≤ 14MB each), and downloads them.

## Agent Management (/agents)

The list page creates and deletes Agents; clicking through opens the `/agents/:agentId` settings page, organized into tabs:

| Tab | Contents |
| --- | --- |
| Overview | Basic info, export / import of Agent State snapshots, and restoring the default configuration (overwrites customizations, keeping only name/description) |
| Prompt | AGENTS.md and system_prompt |
| Memory | Workspace Memory's Agent-level switch, the memory directory, and the way in to the [Memory page](#memory-memory) |
| Runtime | Runtime parameters such as max_turns, model.*, compaction.* |
| Tools | Built-in tool table (incl. per-tool call_description switches) and MCP server JSON configuration |
| Vault | Environment-variable entries with masked values |
| Schedule | Scheduled tasks (TOML-defined): create, edit, toggle, delete |

The Memory tab holds configuration only — memory's *content* is browsed and edited on the [Memory page](#memory-memory). Its switch writes immediately rather than joining the tab-level Save, so turning Memory off never drags an unrelated half-finished edit along with it. Turning it off keeps every file and leaves the Memory page fully usable: it only stops Memory from entering the agent's context and from preparing directories for new Sessions. The tab also warns when an agent is enabled but its prompt template carries no `{{MEMORY}}` placeholder — enabled, yet injecting nothing.

Scheduled tasks fire on a fixed period (minimum 5 minutes) and run only while the service is running.

## Skill Library (/skills)

Browse the Skill library by group, install Skills onto an Agent, or quick-invoke one into a chat draft.

## Model Configuration (/models)

A per-Project model table grouped by provider. Models can be added and edited: identity is the `(provider, model_id)` pair, credentials are masked, and context window, max output tokens (a per-model cap overriding the Agent's `model.max_tokens` — lower it for small-context models), pricing, and the vision flag are configurable. You can set the default model and the vision model (which reads images on behalf of session models without image input), and run a connectivity test on any entry. Only Project owners can edit. For concepts, see [Models and Providers](/models).

## Usage (/usage)

- Filters: Agent, model, date range;
- Summary cards: today / last 7 days / cumulative;
- Charts: per-Agent share, per-model success rates, daily Token and cost trends;
- A server error panel summarizing recent server-side error records.

## Memory (/memory)

Workspace Memory across the Project's Agents, as a tree: Agent → Workspace → topic file. The shared index `memory/AGENTS.md` is the Agent's own first child — one index covers every Workspace — and the right side edits whatever is selected. Create a topic file from the `+` on a Workspace row; rename and delete act on the selected file.

Editing here writes the same files the agent maintains itself with its file tools. Renaming or deleting a topic file also repoints or removes the index links that named it, so the index never lists a file that is gone. An Agent whose memory cannot reach the model is marked in the tree — **Off** for the switch, **No placeholder** for a prompt template with no `{{MEMORY}}` — and both link back to the Agent's Memory tab. For the storage model, see [Configuration](/configuration#workspace-memory).

## Trace Browser (/traces)

Drill down Agent → date → Session → Trace file. Per-turn cards show a context-occupancy donut and a cache breakdown, alongside a lane-based execution timeline and the full event list. For the storage model, see [Sessions and Traces](/sessions-and-traces).

## Benchmark (/benchmark)

Read-only scoreboards per Benchmark: switch the metric (score / cost / duration), drill into each Case's runs, and jump to the linked Session and Trace. Works together with the [Self-Improvement](/self-improvement) workflow.

## User Administration (/admin/users)

Admin only: list and create users, reset passwords, and delete users (the built-in admin cannot be deleted).

## Version and Updates

The sidebar user menu carries a manual "Check for updates" action directly below "Change password"; the running version sits muted on the right of that row, and its release date — stamped into the build by the release workflow, displayed without any network access — appears as the row's localized "Last updated Jul 26"-style tooltip (dev builds and releases that predate the stamping, v0.1.2 and earlier, have no date). The new-chat page shows the same identity as a version line under the brand. The app checks GitHub for a newer release once the menu has first been opened, and immediately — bypassing the cached result — when the manual action is clicked; the latter reports "You're on the latest version" when nothing newer exists. When a newer release is found, a dot appears on the user button, the version displays gain a small superscript "New version available" badge (the draft-page badge links to the release), and the menu gains a release-notes link, plus an "Update now" action for admins that runs `penguin update` on the server (the data directory is untouched). The service must be restarted afterwards for the update to take effect. Set `PENGUIN_UPDATE_CHECK=off` to disable the update check entirely — see the [Configuration Reference](/configuration).

## Projects and Members

The sidebar provides a Project switcher and supports creating new Projects. Members have two roles, owner and member: owners manage membership and exclusively edit models, Vault, and Schedules, as well as perform deletions.

## Production Deployment

The server hosts the built SPA itself (same origin, SPA fallback), so a single `penguin web` or `penguin server` process is all production needs. The npm package bundles the frontend build; to serve a custom static directory, override it with `PENGUIN_WEB_DIST` — see the [Configuration Reference](/configuration).

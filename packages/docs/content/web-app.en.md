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

The initial account is `admin`; its initial password (of the form `penguin-1234`) is printed in the server startup output — as a framed notice on every start — until it is changed. There is no self-registration: accounts are created by an admin on the user-management page, and every new user automatically gets an independent initial Project named `<userId>-default_project`. While the initial password is still in use, a banner prompts the user to change it. A forgotten password is reset by the admin on the user-management page; a forgotten **admin** password is reset offline with `penguin server reset-admin-password` (server stopped), which issues a fresh initial password.

Logins persist for 7 days with sliding renewal; an admin password reset invalidates all of that user's login sessions.

The interface language (中文 / English / system) and theme (light / dark / system) can be switched at any time.

## Chat (/chat)

### Creating a Conversation

A new conversation starts as a draft: pick the Agent, the Workspace (via a server-side directory browser), the approval mode, the model, and the thinking level before sending the first message. The Session is created on first send, and from then on its model and Workspace are locked. Switching the thinking level or the model in the draft makes the switched-to value the new default: the level is written back to the selected Agent's `model.thinking_level` immediately, and the picked model carries over as the next conversation's default. Inside an active session the thinking level belongs to the session: the composer's picker starts out showing the Agent config's level and auto-follows it until touched (sends omit the level, so config edits keep taking effect); a pick is **stored on the Session itself**, so it survives a page reload and shows up in another tab, applies to every later run of that conversation — a later Agent-config edit no longer moves it — and is still never written back to the Agent config. Changing the level mid-chat asks first, because switching mid-conversation lowers the prompt-cache hit rate and raises cost — the dialog offers three choices: **Compact, then switch** (recommended — it compacts the context exactly like `/compact` and applies the level once that compaction ends; a compaction that fails or is aborted still applies the level, with a notice that it did not finish), **Switch anyway** (applies immediately), and Cancel (keeps the current level). A compaction can only start on an idle conversation, so while a task is running the first choice is disabled with a note explaining why, and the other two stay available. A conversation with no messages yet, a re-pick of the displayed level, or a switch right after a successful compaction applies directly without asking; the model stays locked per session — the `/model` command switches models the way the `/agent` handoff does: picking a model stages it as a chip in the composer, and **sending** opens a new session for the same Agent on the picked model, keeping the current Workspace, whose first message carries a `[model_switch_from]` source block (source session id, Trace file path, previous model) followed by whatever the composer held (an interface-language auto-line when empty). In the new session that block collapses into a "switched model" banner linking back to the source conversation, and the model reads the source Trace file itself when it needs the earlier history.

There are four approval modes: `allow-all`, `deny-all`, `read-only` (only read-only tools pass), and `always-ask`. See [Tools and Approvals](/tools).

### The Conversation List

The sidebar's conversation list groups by Workspace or by Agent. Grouping and sort order are switched in the **List options** menu (the sliders icon in the section header), where each option carries its own icon: a folder for Workspace grouping, the Agent glyph for Agent grouping, a clock for most-recent order, and up/down arrows for the drag-reordered manual order.

A row's actions come at two levels:

- **Hovering** a row replaces the trailing last-active time with two icon buttons — archive and delete. They are reachable from the keyboard too: tabbing onto either one reveals it;
- **Right-clicking** a row opens the full menu at the pointer: pin, rename, archive, delete. A **long press** on touch and **Shift+F10** on the keyboard open the same menu, since neither hover nor a secondary click exists there. Escape, a click elsewhere, or scrolling the list dismisses it; the browser's own context menu is taken over on conversation rows only, and stays as usual everywhere else on the page.

Pinning is offered only in the active list — the archived, subagent and scheduled folders leave it out — and a pinned conversation sorts to the top of its group. The choice is remembered per Project in the browser.

### Streaming Rendering

- Model text renders token by token; thinking blocks are collapsible;
- Tool cards expand to show arguments and output, with a live timer while running;
- Subagents leave a full-width row in the stream, styled like the other collapsed step rows (agent avatar, name, short session id, running spinner, and an amber dot while one of their tool calls awaits approval); clicking it opens the agents side panel — a call graph of that row's Task on top (each node shows its elapsed time; click a node to switch) and the selected child's live conversation below — the child's own user prompts included — where nested tool cards and approvals work exactly as in the main chat. Panel visibility is task-scoped: sending a message that starts a new task closes it by default (entering a session starts closed too), and it comes back when you open it yourself or — on desktop — when the current task spawns a subagent (one auto-open per task; a manual close holds until the next task; never over an open files panel). Opening the panel from the toolbar, or switching sessions, shows the latest Task's graph; a row on an older turn brings back that turn's graph. The agents panel and the Workspace files panel never show together — opening one closes the other. Context compaction and the first-run MCP connect show a unified step row (the work-group header shell, sticky title bar included — running/success/failure only swap the icon and the one-line detail, with the wall time on the result; the MCP row leads with the discovered-tool count and names unavailable servers, and expands into one group per server — status, tool count and that server's connect time — each opening into its tool list or the failure detail);
- After each Task, a stats line shows tokens, TPS, elapsed time, cost, copy, and a **Fork** action to the right of copy. Fork asks for confirmation first — it duplicates the conversation into a new chat — and only then opens a new Session at that completed assistant reply with the same Agent, model, Workspace, approval mode, and retained transcript. Forks from different replies in one source chat share an increasing, language-neutral title sequence (`Source title (1)`, `Source title (2)`). Its Trace and scratchpad are independent snapshots: local images/files keep rendering even after the source chat is deleted;

### Header Stats and the Details Card

The toolbar's right edge shows the Session's cumulative stats (tokens, cost, elapsed time); clicking them opens the details card — model, Session id (with a copy button beside it), Workspace, creation time and per-line statistics. Below those:

- **Processes** — background processes the conversation started (`exec_command`s promoted past their yield window), one row each with the command, start time and pid. Running rows carry a **Stop** button (kills the whole process group and drops the row); exited rows keep their "exited" label and carry a **Remove** button that deletes the entry from the list. Removal is immediate and final: the entry leaves the runtime registry together with the output captured from that process, so afterwards the model can no longer be asked to read it — keep the row until you are done with its output.
- **Trace file** — the Session's current Trace file, shown as its file name on a single line: clicking the name opens the Trace Browser focused on this session, and the button beside it copies the full path.

Copy buttons across the app confirm at the button itself: the copy icon flips to a check mark for a moment (no "Copied" text label).

### Input and Shortcuts

- Enter sends, Shift+Enter inserts a newline, and images can be pasted — an image placed inline in the conversation is capped at 20MB, separately from file attachments and not raised along with them: an inline image enters the conversation and the Trace, where its size is paid again on every history page and every session resume, whereas an attachment is only ever read from disk by path;
- The "+" menu holds the input add-ons: **image upload**, **file attachment** and goal mode. An attachment can be any type (up to 20 at a time, and by default ≤ 100MB each and 120MB in total — an admin can change both sizes under **System settings → Upload limits**, see below; an oversize pick is refused before it is read, so nothing is uploaded to earn the rejection, and the message names the limit actually in force); selected files show as removable chips above the text body in the order they were picked, and a message with attachments and no text is sendable. On send the files are written into the Session's scratchpad — deleted with the Session — and the message gains an `[attached file: <path>]` line per file, which the conversation renders as an "Attached files" notice: the bytes never enter the conversation, the model opens each file by path with its ordinary file tools;
- Files can also be **dragged onto the chat area** — the conversation and the composer, on the chat page and the draft page alike: while a file drag is over that region a "Drop files to attach" overlay covers it (it hides as soon as the drag moves off; dragging text or anything that isn't a file is ignored), and releasing attaches the whole batch to the composer — images join the pasted-image pipeline, everything else becomes file attachments, with the same type and size validation and the same errors as the "+" menu. Dropping works while a Task is running too (the attachments then send per the mid-run send mode below); goal mode takes dropped images but refuses files with a notice. Only the chat area reacts: dropping a file on the sidebar, the top bar, the docked panels or any page without a composer attaches nothing and shows nothing — it is simply ignored, instead of the browser navigating away to the dropped file;
- Typing `/` opens the slash menu: trigger context compaction (`/compact`), hand the conversation over to another Agent (`/agent`), switch the model (`/model`) — both switch commands appear in an active session only, since a draft has nothing to switch and picks its Agent and model up front — or toggle installed Skills — chosen Skills are sent along with the message in a `[use_skills]` block;
- While a Task is running the input stays live and the toolbar keeps a single action button: an empty composer shows **Stop**, and typing turns it into **Send**, whose behavior follows the **mid-run send mode** from the toolbar's More-settings popover (a compact extensible settings panel, also available in draft state; the choice is remembered): **Steer** (default) delivers the text **and any attached images** mid-run as a `[user_steering]` user message with the next turn (an image with no caption sends on its own, and the delivered message renders as a steering chip with its images inside it), **Queue** holds the whole message server-side as a follow-up and auto-sends it as an ordinary new message when the run finishes (an "N queued" hint shows near the input until then; the queue survives page reloads). A draft steering cannot carry — selected skills, file attachments, or a staged `/agent` or `/model` pick, with no text and no image — falls back to the queue for that one send, so the button never sits disabled with Stop displaced. Each queued hint line — an undelivered steering message or a queued follow-up — ends in a **recall** control (a curved-back arrow, "Recall") that withdraws the message back into the input box (attachments included) for editing and resending; a steering message that already reached the model can no longer be recalled;
- **Goal mode** (the "+" menu, or `/goal`) turns the draft into an objective the system loops Tasks against. Attached images ride along and are always sent as scratchpad paths (a goal objective is re-injected as text every round — see [Goal mode](/goal-mode)); text is still required, since a picture alone states no objective, and file attachments are refused. Round 1's bubble shows the attachments in full, later rounds collapse them into a chip that expands on click;
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
| Memory | The Agent-level switch, then every memory grouped by scope — user memory first, then one group per Workspace, each group collapsible with an add entry — with view / delete / edit-via-chat actions per row |
| Runtime | Runtime parameters such as max_turns, model.*, compaction.* |
| Tools | Built-in tool table (incl. per-tool call_description switches) and MCP Server management: a table plus an add/edit form whose fields follow the transport (http by default; changes save immediately; full transport validation server-side; a permission control fixes the approval level of that server's tools at `auto` / `r` / `rw`, and the table shows each server's effective level); connectivity testing mirrors the models page — a standalone button in the form probes the current entry (toast with tool count and latency), and a section-level button tests every server in turn with a result badge on each row |
| Vault | Environment-variable entries with masked values |
| Schedule | Scheduled tasks (TOML-defined): create, edit, toggle, delete |

The Memory tab's switch writes immediately rather than joining the tab-level Save, so turning Memory off never drags an unrelated half-finished edit along with it. Turning it off keeps every file and the tab fully usable: it only stops Memory from entering the agent's context and from preparing directories for new Sessions. Scope groups collapse on header click, with the collapse state remembered in the browser per user × Project × Agent; each group header carries an **Add** text entry to its collapse arrow's left (the models page's group convention) — like editing, it goes through a bridge modal (a required content-or-source field plus a live prompt preview) into a new chat, where the agent organizes the content into that scope; the drafts stay deliberately minimal, since the save mechanics live in the Memory prompt. Rows are read-only on purpose, their actions icon-only like the skills tab's — **View** renders the body in a right drawer on desktop and a bottom sheet on narrow screens (the chat page panels' interaction, with half / full snap points), **Delete** confirms and also removes the file's `MEMORY.md` index lines, and **Edit** opens a bridge modal first (what to change plus a prompt preview), then jumps to a new chat with this agent; a Workspace scope's chat also pins that Workspace, so the Session reads the very index it is changing. Below the groups the two memory prompts (`memory.prompt` / `memory.workspace_prompt`) are edited in place, and when the prompt template carries no `{{MEMORY}}` placeholder (an agent created before Memory) it shows a hint with a one-click insert — an explicit, idempotent config write. The agent list cards' stat line also shows the memory count, deep-linking to this tab. For the storage model, see [Configuration](/configuration#memory).

Scheduled tasks fire on a fixed period (minimum 5 minutes) and run only while the service is running.

## Skill Library (/skills)

Browse the Skill library by group, install Skills onto an Agent, or quick-invoke one into a chat draft.

## Model Configuration (/models)

A per-Project model table grouped by provider. Models can be added and edited: identity is the `(provider, model_id)` pair, credentials are masked, and context window, max output tokens (a per-model cap overriding the Agent's `model.max_tokens` — lower it for small-context models), pricing, the vision flag, and fast mode (off by default: faster output at the provider's premium tier — the toggle is shown only for models whose AgentHub client can serve it, and switching it on confirms the premium billing first) are configurable. A model with fast mode on is badged in the list. You can set the default model and the vision model (which reads images on behalf of session models without image input), and run a connectivity test on any entry — the test carries the dialog's current fast-mode toggle, so a rejection surfaces before saving. Only Project owners can edit. For concepts, see [Models and Providers](/models).

## Usage (/usage)

- Filters: Agent, model, date range;
- Summary cards: today / last 7 days / cumulative;
- Charts: per-Agent share, per-model success rates, daily Token and cost trends;
- A server error panel summarizing recent server-side error records.

## Trace Browser (/traces)

Drill down Agent → date → Session → Trace file. Per-turn cards show a context-occupancy donut and a cache breakdown, alongside a lane-based execution timeline and the full event list. For the storage model, see [Sessions and Traces](/sessions-and-traces).

## Benchmark (/benchmark)

Read-only scoreboards per Benchmark: switch the metric (score / cost / duration), drill into each Case's runs, and jump to the linked Session and Trace. Works together with the [Self-Improvement](/self-improvement) workflow.

## System Settings

One dialog for the settings that belong to neither a Project nor an Agent, opened from the sidebar user menu's **System settings** row: a left rail of pages, each page a list of rows — title and a one-line explanation on the left, the control on the right.

The rail is grouped. **Personal** holds preferences that belong to the signed-in account and apply the moment they are touched — no Save button, nothing to lose by closing the dialog. **Server** holds the server-global surfaces: the settings written through `GET|PUT /api/admin/settings` and user management are admin-only — a non-admin gets neither those entries nor any hint they exist, and the APIs answer a non-admin with 403 whatever the browser rendered — while the Updates page is visible to every account outside the desktop app. In the desktop app the update and user-management pages are absent entirely (updating is the desktop shell's job, and the server runs single-user), and the shell's own window also has no Account page — it signs in through the shell's token and holds no password to change, while a browser signed into the same server with a password keeps it.

### General

Personal. **Language** (Chinese / English / follow the browser) and the **display currency** for prices (USD / CNY; storage is always USD — conversion happens only at the edge of the screen). **Show CLI sessions** (default off): off, the conversation list holds only Sessions created in the Web App and is served straight from the database; on, the Trace directories are scanned too and CLI-created Sessions are listed alongside them. Stored per user, and the Trace browser follows the same preference.

### Appearance

Personal. The app **theme** (light / dark / follow the system), the **terminal theme** — the terminal panel keeps its own light/dark and by default follows the app theme; pin it light or dark to decouple the two, for prompts and TUIs tuned to one screen — the interface **font size**, and the **accent color**.

### Account

The **Change password** action. The page exists only where a password exists to change: the desktop shell's own window signs in through the shell's one-shot token and never sees one.

### Users

Admin only, outside the desktop app: list and create users, reset passwords, and delete users (the built-in admin cannot be deleted).

### Proxy Options

Admin only, server-global. Two switches — **Application uses the proxy** (the server's own outbound traffic: LLM requests, the update check, image fetches) and **Agent environment uses the proxy** (agent command subprocess environments) — share one optional **proxy address**; empty means follow the proxy environment variables. The address accepts any proxy URL undici's dispatcher takes (`http://`, `https://`, `socks5://`, credentials allowed) or a bare `host[:port]`, which is stored normalized to `http://…`; anything else is refused with the reason under the input. Nothing is written until Save, which applies the whole form in one PUT, so a rejected address writes none of it. A save rebuilds the outbound dispatcher and takes effect on new connections with no restart; loopback always goes direct.

### Upload Limits

Admin only, server-global: two sizes — the **per-file attachment cap** and the **per-message total** — both whole MB, defaulting to 100MB and 120MB. Each may be set between 1 and 200MB, and the total may not sit below the per-file cap (that combination would make a legal single attachment unsendable). A value outside the range — "100GB" typed into a MB field as 102400, say — is refused with the reason shown under the input rather than accepted. Validation precedes every write: one bad field in a PUT leaves the other fields untouched too.

Saving takes effect immediately, with no restart: the attachment validators and the request body cap both read the setting per request. The body cap is not configured separately but derived from the total — attachments ride the request as base64 `data:` URLs, which inflates them by 4/3, so it has to rise with them or a request whose every attachment was individually legal would die at the HTTP layer instead.

Two numbers are deliberately not exposed. The per-message file **count** stays at 20: it bounds how usable the composer's chip row is, not what the server can survive — the byte budgets do that. And an inline **image** stays capped at 20MB rather than following the attachment limit up, because an image placed inline enters the conversation and the Trace, where its size is paid again on every history page and every session resume; the model side is lower still (providers commonly cap around 5MB, and the `read_image` tool at 5MB), so raising it to 100MB would only trade a clear refusal for a later, more confusing failure.

## Version and Updates

System settings → **Updates** carries the manual "Check for updates" action; the running version sits muted beside it, and its release date — stamped into the build by the release workflow, displayed without any network access — appears as the row's localized "Last updated Jul 26"-style hint (dev builds and releases that predate the stamping, v0.1.2 and earlier, have no date). The new-chat page shows the same identity as a version line under the brand. The app checks GitHub for a newer release once the sidebar user menu has first been opened, and immediately — bypassing the cached result — when the manual action is clicked; the latter reports "You're on the latest version" when nothing newer exists. When a newer release is found, a dot appears on the user button, the draft page's version line gains a small superscript "New version available" badge linking to the release, and the menu gains a "New version available" row that opens the Updates page, whose dialog carries the release-notes link, plus an "Update now" action for admins that runs `penguin update` on the server (the data directory is untouched). The service must be restarted afterwards for the update to take effect. Set `PENGUIN_UPDATE_CHECK=off` to disable the update check entirely — see the [Configuration Reference](/configuration).

## Projects and Members

The sidebar provides a Project switcher and supports creating new Projects. Members have two roles, owner and member: owners manage membership and exclusively edit models, Vault, and Schedules, as well as perform deletions.

## Production Deployment

The server hosts the built SPA itself (same origin, SPA fallback), so a single `penguin web` or `penguin server` process is all production needs. The npm package bundles the frontend build; to serve a custom static directory, override it with `PENGUIN_WEB_DIST` — see the [Configuration Reference](/configuration).

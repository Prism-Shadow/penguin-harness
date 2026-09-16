---
title: "PenguinHarness 0.2.13: a rebuilt Evaluation Center, a file manager, and a company-mode beta"
date: 2026-09-15
category: news
excerpt: "The Evaluation Center is rebuilt so one Benchmark can evaluate several agents. The Files panel becomes a working file manager, the desktop app keeps running in the system tray, and company mode arrives as a beta that an admin turns on."
---

PenguinHarness 0.2.13 rebuilds the Evaluation Center so that one Benchmark can evaluate several agents, and turns the Files panel into a working file manager. The desktop app now keeps running in the system tray after you close its window, a running tool call can be sent to the background, and three gateway bugs that used to end a Task mid-run are fixed. We are also shipping company mode as a beta: an admin turns it on, and then you can create an organization of agents inside a Project.

## A rebuilt Evaluation Center

A Benchmark no longer lives inside the agent it tests. It moved from `agents/<agent>/benchmarks/<id>/` to the Project's own `benchmarks/<id>/`, so one Benchmark can evaluate several agents, and each evaluation records which agent it tested.

- An evaluation is labeled `<agent_id> · <model_id> · <thinking_level>`, and the chart draws one series per label. Only comparable scores share a line, so successive versions of one agent on one runtime now form one connected trend.
- Opening a Benchmark now takes you to its own page at `/benchmark/:benchmarkId`. A row in the evaluation table opens an evaluation dialog, and a case opens a case dialog.
- Both dialogs end in an **Ask AI** button that hands what is on screen to a prefilled conversation. From an evaluation, that is the Benchmark id, series label, version, provider, model, thinking level, per-case scores and every run's Session id. From a case, it is the paths to the case's statement and rubric, and how the latest evaluation's runs scored it.
- A Benchmark carries a `status`. A `draft` stays masked while the `benchmark-design` Skill calibrates it, and the Skill publishes it once the tested agent's baseline scores below 85 on the 0–100 scale.
- Evaluation Sessions go into their own **Evaluations** folder instead of filling up the tested agent's active list.

![A Benchmark's page: the score chart drawing one labeled series per agent, model and thinking level, above the evaluation table](/blog-assets/penguinharness-0-2-13-benchmark-detail-en.png)

## The Files panel is now a file manager

The Workspace browser is renamed **Files**, and you can now manage a Workspace with it, not only browse it.

- Any tree row and the preview body have a context menu, which you open with a right-click, Shift+F10 or a long press. It offers copy path, add to conversation, upload, download, rename, move and delete.
- Renames and deletes carry the same check as the editor's save: if the agent rewrote the file while the dialog was open, the action is refused.
- Syntax highlighting moved to a background worker, which removed the size limits. Highlighting costs about four milliseconds per kilobyte of TypeScript, which is why the source view used to give up above 64KB and the editor above 32KB. Both limits are gone.
- A text preview now reads up to 1MB. On a 400KB file, the page holds a steady 60 frames per second while it highlights.
- The search box searches the whole Workspace on the server, rather than filtering only the rows the tree happened to have loaded.
- Soft wrap is now on by default.

![The Files panel with its context menu open over a tree row](/blog-assets/penguinharness-0-2-13-files-panel-en.png)

## The desktop app keeps running when you close the window

The desktop app now has a system tray icon on Windows, macOS and Linux. By default, closing the main window hides the app in the tray, and the embedded server and its background tasks keep running.

- Left-click the tray icon to bring the window back. Right-click it for **Open PenguinHarness**, **New Session**, **Models**, a **Keep running in the tray when the window closes** checkbox, and **Quit**.
- The **Tray icon** switch in **System settings** › **Appearance** turns the tray icon off, without a restart.
- **Show in folder** joins the header of the Files panel's preview. It appears only in the desktop app's own window, and the server enforces that: a browser signed in to the same server does not get it, even when the browser runs on that very machine. On macOS and Windows it selects the file; on Linux it opens the folder.

## Send a running tool call to the background

While an `exec_command` or `run_subagent` call is executing, its row offers **Send to background**. The call returns with a `process_id` or `subagent_id`, nothing is killed, and the turn continues instead of waiting for the command to finish.

- A subagent sent to the background keeps running and streaming after the turn that started it has ended.
- **Send to background** appears only after the call has been running for ten seconds, so it no longer flashes up and disappears on a command that returns within a few seconds.

![A running exec_command row offering Send to background](/blog-assets/penguinharness-0-2-13-send-to-background-en.png)

## Three gateway bugs that ended Tasks mid-run

Each of these bugs caused a provider to return a 4xx error that the engine treated as fatal, so the Task stopped where it stood. All three are fixed in AgentHub.

- AgentHub 0.4.12 moves an image read by `read_file`, or returned by an MCP tool, out of the `tool` message and onto the user message that follows the turn. That is the only placement Chat Completions documents, and a schema-validating gateway used to reject the whole request.
- AgentHub 0.4.14 fixes two DeepSeek failures: `400 invalid_json` on the request after the first tool call behind a strict Responses relay, and `400 The reasoning_content in the thinking mode must be passed back to the API` part-way through a long tool chain.
- AgentHub 0.4.15 fixes turns that call two tools in parallel through a gateway that opens every call before closing any. The whole turn used to be lost one request later, with `No function call found for function_call_output`.

## Shell commands can be confined

The harness gained a sandbox interface that confines shell commands along three dimensions: `fs-write`, `network` and `mask-paths`. Backends rewrite the command's argv and report honestly what they enforce. Routing fails closed: if no backend covers a requirement, the command is not started, rather than running unconfined.

No backend is built into the harness. Four ship as plugin packages named `@prismshadow/penguin-plugin-<backend>`, which a deployment installs and names in `plugins.json`:

| Backend | Platform |
| --- | --- |
| `sandbox-dsh` | Portable |
| `sandbox-bwrap` | Linux |
| `sandbox-seatbelt` | macOS |
| `sandbox-mxc` | Windows |

A default deployment names none of them and confines nothing.

## The model catalog

- All 43 OpenRouter presets now use the Responses API; before, only the ten `openai/*` rows did. The OpenRouter group itself pins the protocol, so a model you add to it by hand uses Responses too.
- `Atria-Dawn-Preview` joins the Custom group, with Anthropic Messages, a 256K context window and text only.
- The free `dots-3-note-preview` joins the TokenDance group, with a 512K context window and vision.
- Protocol detection no longer takes a typed URL literally. An extra `/v1`, a missing one, or a whole endpoint path copied from a provider's docs are all detected correctly, and the **Models** page writes the corrected URL back into the field.

## A Project can hold a company of agents

Company mode is a beta, and it is off until an admin turns it on under **System settings** › **Server** › **Company mode**. The switch takes effect the moment it is flipped. Company mode is marked **Beta** in the mode switch and under the master switch: it is new, and you may run into problems.

With company mode on, you can create an organization inside a Project, and a Project can hold more than one. Creating an organization takes one sentence, the mission, and produces only the CEO. A manager's budget covers everyone under it, so the CEO's default budget of 100 USD a month caps the whole organization from the first minute.

An organization has:

- a CEO at the root of a reporting tree, and one standing desk Session per employee
- a calendar
- a ticket board
- channels
- a monthly budget per employee, which warns at 80% and, at 100%, pauses the calendar of that employee and everyone under it

All of this is stored as files under `<project>/organizations/<org_id>/`. SQLite holds only caches, rebuilt from those files on every pass.

Six pages, **Overview**, **Org Chart**, **Calendar**, **Tickets**, **Finance** and **Handbook**, sit behind a **Development | Company** switch above the Project switcher. On the command line, `penguin org` covers the whole API, and every command takes `--json`.

![Company mode's overview page: the inbox, today's schedule and the budget alerts](/blog-assets/penguinharness-0-2-13-company-overview-en.png)

## The board, the calendar, and who decides

- The ticket board has five columns: `proposed`, `in_progress`, `review`, `done` and `rejected`.
- The CEO is meant to propose while you decide, but this is guidance, not a rule the server enforces. The CEO's Skill and the organization's handbook tell the CEO to post one proposal in the all-hands channel and wait for your answer before it hires (roles, budgets, models), sets or raises a budget, rejects someone else's ticket, closes a P0 or P1 ticket without review, or does anything outside the organization.
- A server-side scheduler reconciles every organization every 30 seconds, and again right after each API write. It fires due calendar events at desks, delivers channel mentions and recomputes budgets. An event that came due while the organization was paused is not run later when it resumes.
- Ticket changes never start a run. They queue up and reach the employee at its next calendar sweep, under `## Since your last sweep`.
- In a channel, a message reaches someone only through an `@` mention.
- A desk or ticket conversation is an ordinary conversation, with the same message list, tool cards and composer as development mode. Company mode has no chat view of its own.
- Desk and ticket sessions run unattended and never stop to ask a person for tool approval. An organization's approval mode is **Allow all** by default, and there is no always-ask option.

![The five-column ticket board: proposed, in progress, review, done and rejected](/blog-assets/penguinharness-0-2-13-company-tickets-en.png)

## Also in this release

- **The default system prompt has new guardrails.** Fourteen edits address four failure modes the old prompt allowed. "Cannot resolve" now has an observable trigger: the same error is still there after three different fixes. Independent tool calls go out together, commands run non-interactively, and a library counts as available only once the manifest lists it. A new `# Output` section rules out filler openers, narrating tool names and closing recaps.
- **Two concurrent edits of one file no longer lose one silently.** `edit_file` and `write_file` hold a per-file lock across the whole read-modify-write. The lock is keyed on the file's real path, so a symlink and its target share one lock.
- **Every account has a profile.** An avatar (128×128, re-encoded, refused over 128 KiB) and a nickname of 1–32 characters replace the raw user id in the sidebar, the rail and the admin list.
- **Proxy options can test reachability** for six targets: OpenAI, Anthropic, Gemini, DeepSeek and GLM's two hosts. The test runs from the server, sends no credential, allows five seconds per target, and fills in each row as its answer arrives. Any HTTP answer counts as reachable, 401 and 403 included, because a rejected credential still proves that the name resolved, TCP connected, TLS completed and the host replied.
- **A long Trace now loads.** Later rounds, including the compaction round, used to show an empty message list because only the first 1000 events were ever fetched. The view now pages through the whole file and renders as it goes.
- **Tool cards can use short names:** `read_file` shows as read, `exec_command` as exec and `run_subagent` as subagent. A switch in **Appearance** controls this, on by default, and the tooltip keeps the real name.
- **A compaction request uses the thinking level the Session pinned,** like every other request. It used to take the context's base level, which on DeepSeek could get the request rejected outright.
- **Sidebar folders reveal ten conversations at a time,** and **Show less** folds them back.
- **The context panel is easier to read.** The compaction cutter stays readable while you drag it, the room the model has but compaction will not let the Session use is hatched, and clicking a bar segment or a legend row pins its highlight.
- **Task-completion notifications actually work.** Nothing ever called `Notification.requestPermission()`, and Electron reports `granted` without asking anyone, so on macOS an app bundle that never requested authorization had its notifications dropped. A new switch in **System settings** › **General**, off by default, asks for permission when you turn it on. Browsers can now show these notifications too.
- **A used or expired one-time sign-in link** now lands on `/login` with a dialog explaining what happened, instead of a page of raw JSON.
- **Signing out asks first** and says what happens: this session ends, and running conversations keep going on the server.
- **The Code of Conduct moves to Contributor Covenant 3.0** in both languages. Each rung of the enforcement ladder now names the repair expected, not only the consequence. The reporting route is unchanged.

## Upgrading

- **Rename `extensions.json` to `plugins.json`, and its `"extensions"` key to `"plugins"`.** The old name is not read and not migrated. A deployment that configured plugins under it keeps running, but with none of them loaded and their capabilities silently unavailable.
- **Port plugins to the new contract.** Imports point at `@prismshadow/penguin-core/plugin` rather than `/extension`, and `activate(ctx)` is replaced by `Plugin { modules }`. An installed plugin written against the old contract fails to load with "the default export is not a Plugin". `@prismshadow/penguin-server` no longer exports `AppDeps`, `buildAppDeps` or `createApp`. The rename changes nothing about the wire format, the database or any document on disk.
- **Click Sync presets on the Models page.** Stored rows keep the protocol, display name and vision flag they were written with. The OpenRouter move to Responses, the `deepseek-v4-flash` text-only correction and the two new presets reach an existing Project only through a sync. A sync also fills in again any display name you deliberately cleared.
- **Turn on company mode if you want it,** under **System settings** › **Server** › **Company mode**. It is off by default and takes effect as soon as you flip it.
- **Two defaults changed.** Task-completion notifications are off until you turn them on, and the file editor's soft wrap is on for anyone who has never touched its **Wrap** toggle.
- **Move any Benchmark left under `agents/<agent>/benchmarks/` into the Project's `benchmarks/` by hand.** This version does not read the old location, and nothing migrates or deletes it.
- **Migrations 5, 6, 7 and 8** are additive and applied when the database opens. The profile page brings 5, and company mode brings 6, 7 and 8.

## Install

Desktop installers are at [penguin.ooo/download](https://penguin.ooo/download).

On Linux and macOS, install the CLI and server with:

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

On Windows, use PowerShell:

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

To run the server in Docker:

```sh
docker run -d --name penguin -p 127.0.0.1:7364:7364 -v penguin-data:/data hiyouga/penguinharness:latest
```

Full details for every change are in [`changelog/0.2.13/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.13).

PenguinHarness 0.2.12 is the release where a Project can become an organization. Company mode — a beta, off until an admin turns it on — turns a Project's Agents into a company with a CEO, a reporting tree, a calendar, a ticket board and channels, each of them a file on disk. Beside it, a Benchmark became a peer of an agent rather than something an agent owns, the Workspace browser became a working file manager, the desktop app took a place in the system tray, and three gateway bugs that used to end a task mid-run are gone.

## Install

**Desktop app**: grab your platform's installer from [penguin.ooo/download](https://penguin.ooo/download) — the page measures both sources on every visit and keeps GitHub unless the OSS mirror is measurably faster, with a manual selector beside the result. The macOS builds are Developer ID signed and notarized and the Windows installers are Authenticode-signed, so neither platform needs a first-launch unblock.

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

Or the official Docker image (`linux/amd64` and `linux/arm64`):

```sh
docker run -d --name penguin -p 127.0.0.1:7364:7364 -v penguin-data:/data hiyouga/penguinharness:latest
```

`latest` follows `main` and is rebuilt on every push, `0.2.12` is this release built from its own tag, and the example publishes the port on the host's loopback, so a fresh deployment answers only on the machine running Docker.

## Highlights

**Company mode: a Project's Agents as an organization.** An organization has a CEO at the root of a reporting tree, one standing desk session per employee, a calendar, a five-column ticket board (`proposed`, `in_progress`, `review`, `done`, `rejected`), channels where only an `@` mention reaches anyone, and a monthly budget per employee that warns at 80% and pauses that employee's calendar at 100%. Every one of those is a file under `<project>/organizations/<org_id>/`; SQLite holds only caches rebuilt from those files on every pass.

Creating an organization takes one sentence — the mission — and produces only the CEO, with a default budget of 100 USD/month compared on the cumulative line, so that one number caps the whole company from the first minute. The CEO then proposes: how it reads the mission, the first tickets, who to hire with what budget and model, how to split the workspace. It proposes and you decide — hiring, budgets, and closing a P0 or P1 ticket all wait for your confirmation in the all-hands channel.

A server-side scheduler reconciles every organization every 30 seconds and immediately after an API write. It fires due calendar events at desks, delivers channel mentions, and recomputes budgets. An event that came due while the organization was paused is not backfilled when it resumes. Ticket changes never start a run: they queue and arrive in the employee's next calendar sweep under `## Since your last sweep`.

A desk or ticket conversation is an ordinary conversation — the same message list, tool cards, approvals and composer as development mode. Company mode has no chat view of its own. Six pages (overview, org chart, calendar, tickets, finance, handbook) sit behind a Development | Company switch above the Project switcher, and `penguin org` covers the whole API from the command line with `--json` everywhere.

**Company mode is off until an admin turns it on**, in System settings › Server › Company mode, and it takes effect the moment it is flipped. It is marked Beta in the mode switch and under the master switch, because it is new and you will find things.

**The Evaluation Center, rebuilt around the loop.** A Benchmark moved from `agents/<agent>/benchmarks/<id>/` to the Project's own `benchmarks/<id>/`: one Benchmark can now evaluate several agents, and the agent under test is recorded on each evaluation. An evaluation's label is `<agent_id> · <model_id> · <thinking_level>`, and the chart draws one series per label — so only comparable scores share a line, and successive versions of one agent on one runtime finally form one connected trend.

Opening a Benchmark now enters it, at `/benchmark/:benchmarkId`. A table row opens an evaluation dialog, and both detail dialogs end in an **Ask AI** button that hands what is on screen — Benchmark id, series label, version, provider, model, thinking level, per-case scores and every run's Session id — to a prefilled conversation. A Benchmark carries a `status`: a `draft` is masked while `benchmark-design` calibrates it, and the publish gate is a fixed 85 on the 0–100 scale. Evaluation Sessions are filed into their own **Evaluations** folder instead of pouring into the tested agent's active list.

**The Workspace browser became a working file manager.** Renamed to Files, it gained a context menu on any tree row or the preview body — copy path, add to conversation, upload, download, rename, move, delete — reached by right-click, Shift+F10 or a long press. Renames and deletes carry the same precondition the editor's save does, so one is refused if the Agent rewrote the file while the dialog was open.

Highlighting moved to a worker, which is what removed the size ceilings: it costs about four milliseconds per kilobyte of TypeScript, which is why the source view gave up above 64KB and the editor above 32KB. Both ceilings are gone, a text preview now reads up to 1MB, and over a 400KB file the page holds a full 60 frames a second for the whole pass. The search box searches the whole Workspace on the server rather than filtering the rows the tree happened to have loaded, and soft wrap now defaults to on.

**The desktop app stays running when you close the window.** It takes a place in the system tray on Windows, macOS and Linux, and closing the main window hides it there by default, leaving the embedded server and its background tasks running. Left click brings the window back; right click offers Open, New Session, Models, a **Keep running in the tray when the window closes** checkbox, and Quit. A Tray icon switch in Settings › Appearance turns it off with no restart.

Beside it, **Show in folder** in the Files panel's preview header, drawn only in the desktop app's own window and enforced server-side — a browser signed into the same server does not get it, even when it is running on that very machine. macOS and Windows select the file; Linux opens the directory.

**Three gateway bugs that used to end a task mid-run.** Each of these produced a provider 4xx the engine classified as fatal, so the Task stopped where it stood. AgentHub 0.4.12 moves an image read by `read_file` or returned by an MCP tool out of the `tool` message and onto the user message that follows the turn, the one placement Chat Completions documents — a schema-validating gateway used to reject the whole request. 0.4.14 ends two DeepSeek failures: `400 invalid_json` on the request after the first tool call behind a strict Responses relay, and `400 The reasoning_content in the thinking mode must be passed back to the API` part-way through a long tool chain. 0.4.15 fixes a turn that calls two tools in parallel through a gateway that opens every call before closing any, which used to lose the whole turn one request later with `No function call found for function_call_output`.

**Send a running tool call to the background.** While an `exec_command` or `run_subagent` is executing, its row offers **Send to background**: the call closes with a `process_id` or `subagent_id`, nothing is killed, and the turn continues instead of waiting out the command. A detached subagent keeps running and streaming after the turn that started it has ended. The action appears once the call has been running for ten seconds, so a command that returns in a few seconds no longer flashes it and takes it away again.

**Two concurrent edits of one file no longer lose one silently.** The engine runs a turn's approved tool calls concurrently, so two `edit_file` or `write_file` calls on one file — from one turn, or from two subagents — both read the original bytes and the later rename won: one edit was lost while both calls reported success. Both tools now hold a per-file lock across the whole read-modify-write, keyed on the file's real path, so a symlink and its target fold onto one lock.

**Shell commands can be confined.** The harness gained a sandbox interface naming three dimensions — `fs-write`, `network`, `mask-paths` — with argv rewriting, honest enforcement reporting and fail-closed routing: a requirement no backend covers aborts the spawn rather than running the command unconfined. No backend is part of the harness; four ship as plugin packages a deployment installs and names in `plugins.json`: `sandbox-dsh` (portable), `-bwrap` (Linux), `-seatbelt` (macOS) and `-mxc` (Windows). A default deployment names none and confines nothing.

**The model catalog.** All 43 OpenRouter presets now speak the Responses API — only the ten `openai/*` rows did — and the group itself pins the protocol, so a hand-added OpenRouter model gets it too. Two new presets: `Atria-Dawn-Preview` in the custom group (Anthropic Messages, 256K context, text only) and the free `dots-3-note-preview` in the TokenDance group (512K context, vision). Protocol detection stopped taking a typed URL literally: an extra `/v1`, a missing one, or a whole endpoint path copied out of a provider's docs all detect correctly now, and the Models page writes the corrected URL back into the field.

## Notable in this release

- **What upgrading asks of you: two renames for one kind of user, one click for everyone else.** Plugin configuration was renamed and is not migrated — `extensions.json` is no longer read, so a deployment that configured plugins under the old name keeps running with none of them loaded and their capability silently unavailable; rename the file to `plugins.json` and its `"extensions"` key to `"plugins"`, and point any import at `@prismshadow/penguin-core/plugin` rather than `/extension`. The plugin contract changed with it: `activate(ctx)` is replaced by `Plugin { modules }`, an installed plugin written against the old one fails to load with "the default export is not a Plugin", and `@prismshadow/penguin-server` no longer exports `AppDeps`, `buildAppDeps` or `createApp`. Nothing about the wire format, the database or any on-disk document changes.

The click worth making is **sync presets** on the models page: stored rows keep the protocol, display name and vision flag they were written with, so the OpenRouter move to Responses, the `deepseek-v4-flash` text-only correction and the two new presets reach an existing Project only through a sync — though a display name you deliberately cleared is filled in again by it.

Two defaults changed: task-completion notifications are off until you turn them on, and the file editor's soft wrap is on for anyone who has never touched its Wrap toggle.

Company mode brings migrations 6, 7 and 8 and the profile page brings 5; all are additive and applied at open. Benchmarks left under `agents/<agent>/benchmarks/` are not read by this version and nothing migrates or deletes them — move them into the Project's `benchmarks/` by hand. Full detail in [`2026-09-09-backward-compatibility`](2026-09-09-backward-compatibility.md).

- **The default system prompt grew guardrails.** Fourteen edits against four failure modes the old prompt permitted: a stubborn error met with an open-ended run of variants, files read one per turn, a command sitting on a `y/n` prompt until the poll timed out, and a build reported but never run. "Cannot resolve" now has an observable trigger — the same error still there after three different fixes — independent tool calls go out together, commands run non-interactively, a library counts as available only once the manifest shows it, and a new `# Output` section kills filler openers, tool-name narration and closing recaps.

- **Every account gets a profile.** An avatar (128×128, re-encoded, refused over 128 KiB) and a 1–32 character nickname replace the raw user id in the sidebar, the rail and the admin list.

- **The proxy options page can test reachability** over six targets — OpenAI, Anthropic, Gemini, DeepSeek and GLM's two hosts — measured from the server, no credential sent, five seconds each, each row filling as its own answer lands. Any HTTP answer counts as reachable, 401 and 403 included: a rejected credential still proves the name resolved, TCP connected, TLS completed and the host replied.

- **A long Trace finally loads.** Later rounds, the compaction round included, used to show an empty message list because only the first 1000 events were ever fetched; the view now pages through the whole file and renders progressively.

- **Tool cards can use short names** — `read_file` → read, `exec_command` → exec, `run_subagent` → subagent — with an Appearance switch, on by default. The real name stays in the tooltip.

- **A compaction request runs at the thinking level the Session pinned**, like every other request. It used to take the context's base level, which on DeepSeek could get the request rejected outright.

- **Sidebar folders reveal ten conversations at a time**, with a Show less that folds them back.

- **The context panel's compaction cutter is readable while you drag it**, the room the model has but compaction will not let the Session use is hatched, and clicking a bar segment or a legend row pins its highlight.

- **Task-completion notifications actually work.** Nothing ever called `Notification.requestPermission()`, and Electron reports `granted` without asking anyone — so on macOS a bundle that never requested authorization had its notifications dropped and never appeared in System Settings. There is now a switch in System settings › General, off by default, which asks at the moment it is flipped; a browser is eligible for the first time.

- **A used-up or expired one-time sign-in link** lands on `/login` with a dialog explaining what happened, instead of a page of raw JSON.

- **Signing out asks first**, naming what happens: this session ends, running conversations keep going on the server.

- **The Code of Conduct moves to Contributor Covenant 3.0** in both languages. Each rung of the ladder now names the repair expected, not only the consequence; the reporting route is unchanged.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The desktop app and the CLI installers bundle their own runtime; installing from npm needs Node >= 24, or the official Docker image, which carries its own. All data stays under `~/.penguin/data` — the `/data` volume in the container.

Full detail: [changelog/0.2.12/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.12).
---
title: "PenguinHarness 0.2.10: a Files panel you can type into, a compaction cutter, hooks as plugins, and a server in Docker"
date: 2026-09-10
category: news
excerpt: The conversation grew a workbench. The Files panel became a two-pane browser with in-place editing and version-checked saves, the context ring now measures against the point compaction actually fires and its threshold is a cutter you drag, a shortcuts ball fans the dock open from the edge of the chat, and scheduled tasks moved in beside it. Hooks became a capability of the loop itself, with goal mode and continual learning shipping as installable plugins. An official Docker image makes a server one `docker run`, and DeepSeek V4.1 Flash is the model a new Project starts on.
---

PenguinHarness 0.2.10 turns the dock into a workbench: editable files, a movable compaction trigger, scheduled tasks, and an edge shortcut ball. Hooks become an agent-loop capability, an official container image simplifies server deployment, and the model catalog expands.

## The Files panel is a browser you can type into

- Workspace files panel is now two panes: lazy directory tree on the left, selected file on the right, draggable divider.
- Text files gain an **Edit** action with a monospace editor, **Wrap** toggle, and Ctrl+S save.
- Saves are version-checked via `ETag` / `ifVersion`. If the Agent changed the file, the server returns `409` without writing; the UI offers **Overwrite** and preserves your draft.
- Dropping OS files into the panel uploads them into the directory under the pointer.
- Unsaved changes prompt before switching files or removing the panel, but collapsing the dock keeps the draft mounted.

![The Files panel: a directory tree on the left beside an open file in the plain-text editor on the right](/blog-assets/penguinharness-0-2-10-files-panel-en.png)

## The context ring measures against compaction

- The composer ring now fills against the compaction trigger, not the model context window, so a 64k/128k threshold reads 50%.
- The panel bar remains scaled to the model window and shows the dashed compaction cutter.
- Dragging the cutter opens a confirmation with the proposed value prefilled and still editable.
- Context is assembled whole from Agent State under three tiers; compaction settings are re-read at each checkpoint, so running conversations honor changes.
- Added a second Top 5 view showing files with the most file-tool traffic in the current context.

![The context panel: a bar scaled to the model window with a draggable compaction cutter, and the Top 5 files view](/blog-assets/penguinharness-0-2-10-context-panel-en.png)

## A shortcuts ball on the edge of the conversation

- When no dock panel is open, a translucent round button floats on the right edge with a “Shortcuts” caption.
- Clicking it fans out a semicircular ring of dock panels plus terminal; names appear through the caption, not pills around the ball.
- Selecting an entry opens that panel and hides the ball.
- The ball drags along the edge, remembers position, carries the pending-approval dot, and can be dismissed; an Appearance setting brings it back.

![The shortcuts ball on the conversation's right edge, fanned open into a semicircular ring of panel entries](/blog-assets/penguinharness-0-2-10-shortcuts-launcher-en.png)

## Scheduled tasks, in the conversation

- New dock **Scheduled tasks** panel lists tasks for the current Session with search, state filters, enable switches, and plain-language schedule lines.
- Header offers **Create with AI**, which prefills this conversation’s composer without posting, and **Create manually**, which opens the form pinned to this Session.
- Sidebar rows show an alarm clock for Sessions with a bound upcoming task.
- Saving no longer claims tasks take effect in a new conversation; toasts reflect scheduler behavior.

![The scheduled-tasks panel in the dock with its Create with AI and Create manually buttons, and a sidebar session row wearing an alarm clock](/blog-assets/penguinharness-0-2-10-schedule-panel-en.png)

## Hooks are a capability, goal mode is a plugin

- Sessions gain hook points: **stop**, **pre_tool_use**, and **user_prompt**.
- Hooks are plain Node scripts installed into `agent_state/hooks/`, run as subprocesses, and may answer `continue`, `stop`, a `subagent` request, or nothing.
- Goal mode is now the `goal` plugin’s stop hook; `continual-learning` sends long-task findings to a background subagent that updates relevant `SKILL.md` files.
- Skill library becomes a **plugin library**: npm packages, dated versions, detail modal with file browser.
- Agent settings gain a **Hooks** tab with one `hooks.enabled` switch per Agent. Disabled Agents assemble no hooks while installed packages remain on disk.
- Per-package rows show hook-point chips, zip export/import, and chat import.

![The Agent settings Hooks tab: the enable-switch card, a package row with hook-point chips, and the import dialog entry](/blog-assets/penguinharness-0-2-10-hooks-tab-en.png)

## Create with AI, as a kit

- Every object created from a form is gaining an AI creation path. This release ships the kit: button pair, prompt panel with examples and folded full-prompt preview, and dialog sending the prompt to the Project’s default agent.
- Separate buttons: accented **Create with AI** with a wand, plain **Create manually** with a hand.
- The dialog only offers **Edit in a new conversation**; nothing is auto-sent. The prompt lands as a prefilled draft, and Send remains your action.
- Only kit and schedule surfaces ship this release; other creation forms follow later.

![A page header's Create with AI and Create manually button pair, with the Create with AI dialog open over it](/blog-assets/penguinharness-0-2-10-create-with-ai-en.png)

## A server on another machine

- Official container image: Docker Hub `hiyouga/penguinharness`, built from source for `linux/amd64` and `linux/arm64`.
- Runs `penguin server` on `0.0.0.0:7364` with `/data` volume. Tags: `latest` follows `main`; `X.Y.Z` follows release tags. Documented `docker run` publishes on host loopback.
- **Machines** records now live in `web.db`, belong to a Project, and each machine mints a 16-character id.
- Machine identity uses `penguin server status` over ssh. All traffic rides one held `ssh -T -D` session per machine; connected-machine API answers same-origin at `/server/<machineId>/api/…`.

## The model catalog

- **DeepSeek V4.1 Flash** ships as bare id `deepseek-flash`, new Project default; 1,000,000-token context, image input, Flash pricing with off-peak halving. Direct-vendor row pins a client and base URL.
- **Gemini 3.8 Flash** joins directly and on OpenRouter; 1,048,576-token window, image input. Launch-discount pricing is declared and derived; two incorrect rows corrected.
- **GPT-6 Astra** joins direct and OpenRouter; 1,050,000-token window, images, $1 / $12.5 / $50 per million tokens for cache read / cache write / output.
- Three **Doubao Seed** rows join TokenDance with 50% off.
- New **vLLM** group covers eight self-hosted models: zero price, no base URL, group-pinned protocol.
- Existing Projects pick this up via **sync presets**.

## Also in this release

- `exec_command` accepts `command` as well as `cmd`; tool rejections answer with the fault, parameters, and correct call shape. `read_image` and `describe_image` fold into `read_file`.
- Slow turns show `Elapsed 10.3s (API 5s, tools 5.3s)`, excluding approval wait.
- Sidebar marks Sessions with dev servers or background subagents; chat header gets a matching pill.
- Compaction shows status and wall time; thinking and summary stream into separate disclosure rows.
- `model.timeoutMs` is now an idle budget between upstream events, default 300000; retry ladder resets after received content.
- Updating runs through one dialog: check, release notes, download with progress, then **Restart and update**.
- Conversations open on the latest 50 turns; earlier turns load as you scroll up.
- Sidebar lists every Workspace from server-side counts.
- Terminals behave like terminals: link positioning after redraw, OSC 52 copy reaches the system clipboard.
- Plugin versions read `2026.09.10.1`; old dash spelling reads as the same version, so no false update badge.

## Upgrading

- First restart-only schema migration (`drop-goal-state`): hot push onto a running runtime is refused before touching the database. Normal install restarts and applies it. Downgrading to 0.2.9 still works.
- Install the `goal` plugin on pre-0.2.10 Agents, or goal mode returns `409 goal_plugin_not_installed`. One click per Agent.
- Update the kernel to `2026-09-10` for `read_file` images. Until then image tools get unknown-tool replies and image reads use the stored 30s timeout. Rename `skills` / `--skills` to `plugins` / `--plugins` in scripts.
- `POST /api/version/update` now returns job status instead of blocking. Machines routes moved under a Project, so 0.2.9 machine lists start empty; re-install from the owning Project to recover.

Desktop installers are at [penguin.ooo/download](https://penguin.ooo/download); the CLI and server install with:

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

```sh
docker run -d --name penguin -p 127.0.0.1:7364:7364 -v penguin-data:/data hiyouga/penguinharness:latest
```

Full detail for every change is in [`changelog/0.2.10/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.10).

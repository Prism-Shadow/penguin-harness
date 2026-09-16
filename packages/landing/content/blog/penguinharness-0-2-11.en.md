---
title: "PenguinHarness 0.2.11: editable files, a draggable compaction threshold, hooks, and a Docker image"
date: 2026-09-10
category: news
excerpt: The Files panel becomes a two-pane browser with in-place editing, the context ring measures against a compaction threshold you can drag, and scheduled tasks move into the dock. Hooks become part of the agent loop, and an official Docker image ships.
---

PenguinHarness 0.2.11 is out, and most of its changes are inside the conversation. You can edit Workspace files in a two-pane Files panel, the context ring measures against the point where compaction fires, scheduled tasks move into the dock, and a shortcuts ball on the conversation's edge opens the dock's panels. Hooks are now part of the agent loop, with goal mode and continual learning available as installable plugins. An official Docker image turns a server deployment into one `docker run`, and new Projects start on DeepSeek V4.1 Flash.

## The Files panel is a two-pane browser you can type into

The Files panel now shows a directory tree on the left and the selected file on the right, with a divider you can drag. The tree loads each directory's contents as you expand it.

- Text files gain an **Edit** action: a monospace editor with a **Wrap** toggle, and Ctrl+S to save.
- Saves are version-checked with `ETag` / `ifVersion`. If the agent changed the file after you opened it, the server returns `409` and writes nothing. The panel then offers **Overwrite** and keeps your draft.
- Dropping files from your operating system onto the panel uploads them into the directory under the pointer.
- If you have unsaved changes, the panel asks before you switch files or remove the panel. Collapsing the dock keeps your draft.

![The Files panel: a directory tree on the left beside an open file in the plain-text editor on the right](/blog-assets/penguinharness-0-2-10-files-panel-en.png)

## The context ring measures against compaction

The ring in the composer now fills up against the compaction threshold instead of the model's context window. With 64k used against a 128k threshold, it reads 50%.

The bar in the context panel still uses the model's window as its scale, and marks the compaction threshold with a dashed cutter. Drag the cutter to change the threshold: a confirmation opens with the new value filled in, and you can still edit it. Compaction settings are re-read at every compaction checkpoint, so a change also applies to conversations that are already running.

The panel also gains a second Top 5 view that lists the files with the most file-tool traffic in the current context.

![The context panel: a bar scaled to the model window with a draggable compaction cutter, and the Top 5 files view](/blog-assets/penguinharness-0-2-10-context-panel-en.png)

## A shortcuts ball on the edge of the conversation

When no dock panel is open, a translucent round button floats inside the right edge of the conversation, captioned **Shortcuts**. Click it, and the dock panels plus a terminal fan out around it in a semicircle. The entries are icons only; the caption shows the name of the one you point at. Picking an entry opens that panel and hides the ball.

You can drag the ball along the edge, and it remembers where you left it. It shows the pending-approval dot. The last entry on its ring dismisses the ball for good, and a setting under **Appearance** brings it back.

![The shortcuts ball on the conversation's right edge, fanned open into a semicircular ring of panel entries](/blog-assets/penguinharness-0-2-10-shortcuts-launcher-en.png)

## Scheduled tasks, in the conversation

A new **Scheduled tasks** panel in the dock lists the scheduled tasks bound to the current Session. It has search, state filters and enable switches, and it describes each schedule in plain language.

- The panel header offers **Create with AI**, which fills in this conversation's composer without sending anything, and **Create manually**, which opens the form already set to this Session.
- In the sidebar, a Session with a scheduled task still to fire shows an alarm clock.
- Saving a scheduled task no longer claims that it takes effect in a new conversation. The notifications now describe what the scheduler actually does.

![The scheduled-tasks panel in the dock with its Create with AI and Create manually buttons, and a sidebar session row wearing an alarm clock](/blog-assets/penguinharness-0-2-10-schedule-panel-en.png)

## Hooks are part of the loop, and goal mode is a plugin

Sessions now have three hook points: `stop`, `pre_tool_use` and `user_prompt`. A hook is a plain Node script installed into `agent_state/hooks/`. It runs as a subprocess, and a stop hook can answer `continue`, `stop`, a `subagent` request, or nothing.

- Goal mode is now the `goal` plugin's stop hook.
- The `continual-learning` plugin sends the findings of a long task to a background subagent, which updates the relevant `SKILL.md` files.
- The Skill library is now the **Plugin library**. Plugins are npm packages with dated versions, and each has a detail dialog with a file browser.
- Agent settings gain a **Hooks** tab with a `hooks.enabled` switch for each agent. When it is off, the agent loads no hooks, and installed packages stay on disk. Each package row shows its hook points as chips, and the tab offers zip export and import, plus import through a chat.

![The Agent settings Hooks tab: the enable-switch card, a package row with hook-point chips, and the import dialog entry](/blog-assets/penguinharness-0-2-10-hooks-tab-en.png)

## Create with AI, as a kit

Every object the Web App creates from a form is getting a second path: describe it to an agent. This release ships the kit behind that path. It includes the button pair, a prompt panel with examples and a folded preview of the full prompt, and a dialog that hands the prompt to the Project's default agent.

- The two buttons are separate. **Create with AI** is accented and shows a wand; **Create manually** is plain and shows a hand.
- The dialog's only action is **Edit in a new conversation**, and nothing is ever sent automatically. The prompt arrives as a draft in the composer, and pressing Send is up to you.
- Besides the scheduled-tasks panel, the Skills tab's import through a chat and the Memory tab's add and edit already use the kit. Other creation forms follow in later releases.

![A page header's Create with AI and Create manually button pair, with the Create with AI dialog open over it](/blog-assets/penguinharness-0-2-10-create-with-ai-en.png)

## A server on another machine

There is now an official container image on Docker Hub, `hiyouga/penguinharness`, built from source for `linux/amd64` and `linux/arm64`. It runs `penguin server` on `0.0.0.0:7364` with a `/data` volume. The `latest` tag follows `main`, and `X.Y.Z` tags are built from releases. The documented `docker run` command publishes the port on the host's loopback address, so a new deployment answers only on the machine running Docker.

The **Machines** page, which installs PenguinHarness on another machine over ssh, changed too:

- Machine records moved from a JSON file into `web.db` and now belong to a Project. Each machine mints its own 16-character id.
- PenguinHarness runs `penguin server status` over ssh to learn a machine's id and whether its server is up.
- All traffic to a machine goes through one long-lived `ssh -T -D` session per machine. A connected machine's API answers on the same origin, at `/server/<machineId>/api/…`.

## The model catalog

- **DeepSeek V4.1 Flash** ships under the bare id `deepseek-flash` and is the default model for new Projects. It has a 1,000,000-token context window, image input, and Flash pricing that halves off-peak. Its direct-vendor row pins a client and a base URL.
- **Gemini 3.8 Flash** joins directly and on OpenRouter, with a 1,048,576-token window and image input. Gemini 3.x Flash rows now store the list price and declare the launch discount instead of building it into the numbers, and two rows that billed the wrong price are corrected.
- **GPT-6 Astra** joins directly and on OpenRouter, with a 1,050,000-token window and image input, at $1 / $12.5 / $50 per million tokens for cache read / cache write / output.
- Three **Doubao Seed** rows join the TokenDance group at 50% off.
- A new **vLLM** group covers eight self-hosted models. The rows have a price of zero and no base URL, and the group pins their protocol.

Existing Projects pick up these rows with **Sync presets** on the models page.

## Also in this release

- `exec_command` accepts `command` as well as `cmd`. When a tool rejects a call, it now replies with the fault, the parameters and the correct call shape. `read_image` and `describe_image` fold into `read_file`.
- Slow turns show where the time went, such as `Elapsed 10.3s (API 5s, tools 5.3s)`. Neither part counts time spent waiting for approval.
- The sidebar marks Sessions that have dev servers or background subagents running, and the chat header shows a matching pill.
- The compaction row shows its status and how long it took, and the thinking and the summary stream into separate rows you can expand.
- `model.timeoutMs` is now an idle budget between upstream events, with its default raised to 300000, so a request times out on silence rather than on length. The retry ladder starts over once content has been received.
- Updating runs through one dialog: check, read the release notes, download with a progress bar, then **Restart and update**.
- A conversation opens on its latest 50 turns, and earlier turns load as you scroll up.
- Grouped by Workspace, the sidebar lists every Workspace, not only those its loaded conversations belong to.
- Terminals behave like terminals: a link still opens correctly after the screen redraws, and OSC 52 copy reaches the system clipboard.
- Plugin versions are now written like `2026.09.10.1`. A copy installed under the old spelling with dashes counts as the same version, so no false update badge appears.

## About 0.2.10

0.2.11 is 0.2.10 rebuilt with electron-builder 26.16.1, which makes signed macOS installer builds work again. 0.2.10 was tagged, and its npm packages and Docker image were published, but its signed macOS build failed, so it never got installers or a Release page. The per-change entries stay in [`changelog/0.2.10/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.10).

## Upgrading

- **One restart.** This release has the first restart-only schema migration, `drop-goal-state`. A hot push onto a running runtime is refused before it touches the database, while a normal install restarts and applies the migration. Downgrading to 0.2.9 still works.
- **Install the `goal` plugin on agents created before 0.2.10.** Without it, goal mode returns `409 goal_plugin_not_installed`. It takes one click per agent.
- **Update the kernel to `2026-09-10`** so that agents read images with `read_file`. Until then, calls to the old image tools get unknown-tool replies, and image reads use the stored 30s timeout.
- **Rename `skills` / `--skills` to `plugins` / `--plugins`** in scripts that create agents.
- **API changes.** `POST /api/version/update` now returns a job status instead of blocking until the update ends. Machines routes moved under a Project, so machine lists from 0.2.9 start empty; install again from the Project that owns the machine to get it back.

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

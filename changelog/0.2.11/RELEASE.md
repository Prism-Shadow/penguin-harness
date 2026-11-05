PenguinHarness 0.2.11 is a rebuild of 0.2.10 with one dependency updated so macOS installers sign again. While 0.2.10 was tagged and its npm packages and Docker image were published, the signed macOS build failed in the release pipeline and no Release page was created — install 0.2.11 instead.

It is the release where the conversation grows a workbench. A Files panel browses and edits the Workspace in place, the context ring measures against the point compaction actually fires and its threshold becomes a cutter you drag, scheduled tasks live in the dock beside the chat, and a shortcuts ball on the conversation's right edge fans the whole workbench open. Hooks became a capability of the loop itself, with goal mode and continual learning shipping as installable plugins; a shared Create with AI kit puts an agent behind the app's creation forms; an official Docker image makes a server one `docker run`; and DeepSeek V4.1 Flash is the model a new Project starts on.

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

`latest` follows `main` and is rebuilt on every push, `0.2.11` is this release built from its own tag, and the example publishes the port on the host's loopback, so a fresh deployment answers only on the machine running Docker.

## Highlights

**The Workspace is a two-pane file browser you can type into.** The Files panel now adds a lazy-loaded, arrow-key-navigable, filterable directory tree beside the preview, with a draggable divider that remembers its width and a toolbar toggle. Text files open in a monospace editor with a Wrap toggle and Ctrl+S. Saves are version-checked with ETags; if the Agent changed the file during the turn, the panel reports `409`, names the file, and lets you keep your draft either way. Dropping OS files onto the panel uploads them into the directory under the pointer. Drafts survive Session switches, a collapsed dock, and hidden tabs; only closing the panel outright asks.

![The Files panel: a directory tree on the left beside an open file in the plain-text editor on the right](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/releases/0.2.10/files-panel.png)

**The context ring measures against compaction, and its threshold is a control.** The composer's ring now fills against the conversation's actual compaction threshold, not the model's full window — so 64k against a 128k threshold reads 50%, not 6%. The panel bar keeps the full window as its scale and marks the trigger with a draggable dashed cutter; moving it sets that Agent's compaction threshold immediately, and the value is re-read at every compaction checkpoint. The panel also ranks the top five files by `read_file` / `edit_file` / `write_file` context traffic. Every model context is assembled whole from current Agent State under strict, soft, and unrestricted tiers.

![The context panel: a bar scaled to the model window with a draggable compaction cutter, and the Top 5 files view](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/releases/0.2.10/context-panel.png)

**A shortcuts ball on the edge of the conversation.** When no dock surface is up, a translucent round button floats inside the right edge under a "Shortcuts" caption. Clicking fans entries onto a semicircular ring — dock panels plus a terminal, glyphs only, with names read by the caption. Picking one opens that panel and hides the ball. The ball drags along the edge, remembers its place, shows the pending-approval dot, and its last entry dismisses it permanently; an Appearance setting brings it back.

![The shortcuts ball on the conversation's right edge, fanned open into a semicircular ring of panel entries](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/releases/0.2.10/shortcuts-launcher.png)

**Scheduled tasks moved into the conversation.** A new dock panel lists tasks bound to the current Session with search, state filters, plain-language schedule lines, enable switches, owner edit/delete, and suggestions. Its header has **Create with AI**, which pre-fills the composer without sending, and **Create manually**. A Session with a scheduled task still to fire wears an alarm clock on its sidebar row. Tasks fire on the scheduler clock; saving a task no longer claims it takes effect in a new conversation.

![The scheduled-tasks panel in the dock with its Create with AI and Create manually buttons, and a sidebar session row wearing an alarm clock](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/releases/0.2.10/schedule-panel.png)

**Hooks are a capability of the loop, and goal mode is a plugin.** Core codes the hook *points* — **stop**, **pre_tool_use**, **user_prompt** — while hooks arrive as packages: Node scripts installed into `agent_state/hooks/`. Goal mode left core and became the `goal` plugin's stop hook; a `continual-learning` package sends long-task findings to a background subagent. The skill library is now a **plugin library** with one npm package per plugin, dated versions, and a detail Modal with a file browser. Agent settings gained a **Hooks** tab with an enable switch, zip export/import, and a chat import dialog shaped like the Skills tab's.

![The Agent settings Hooks tab: the enable-switch card, a package row with hook-point chips, and the import dialog entry](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/releases/0.2.10/hooks-tab.png)

**Create with AI, as a kit.** Every object the Web App creates from a form is getting a second path. This release ships the shared machinery: the **Create with AI** button beside **Create manually**, a prompt panel with examples and full-prompt preview, and a dialog that hands the composed prompt to the Project's default agent as a prefilled draft. The only way out is **Edit in a new conversation**, and nothing is ever sent automatically. Skills import-via-chat, Memory add/edit, and Schedule already use it.

![A page header's Create with AI and Create manually button pair, with the Create with AI dialog open over it](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/releases/0.2.10/create-with-ai.png)

**A server on another machine, two ways.** An official container image `hiyouga/penguinharness` is available for `linux/amd64` and `linux/arm64`, running `penguin server` on `0.0.0.0:7364` with a `/data` volume, unprivileged under `tini`. Tags are `latest` from `main` and `X.Y.Z` from releases. A Docker quickstart covers first sign-in, upgrading by tag, reverse proxies, and forgotten-password rescue. The **Machines** family moved into `web.db` and now belongs to a Project; each machine mints a 16-character id and answers `penguin server status` / `penguin server stop` over ssh. All server-to-machine traffic rides one held `ssh -T -D` session per machine. A connected machine's API answers same-origin at `/server/<machineId>/api/…`; connecting a machine hands it the Model credentials of Projects that use it. A machine already on this release with different pushed state hot-updates over its own channel, with Restart as a control.

**The model catalog moved a long way.** DeepSeek V4.1 Flash (`deepseek-flash`) is now the default for new Projects: 1,000,000-token window, image input, peak CNY 0.04/2/8 per million tokens and half that off-peak, with TokenDance and OpenRouter rows. Gemini 3.8 Flash joined directly and on OpenRouter; Gemini 3.x Flash rows now store list prices and declare Google's launch discount rather than baking it in, correcting two misbilled rows. GPT-6 Astra joined direct and on OpenRouter, Doubao Seed joined TokenDance, and a new **vLLM** group covers eight self-hosted models with thinking switches, zero price, no base URL, and pinned protocol.

**A rejected tool call explains how to fix itself.** `exec_command` now accepts either `cmd` or `command`. Every built-in tool that rejects a call for its arguments now returns a correction guide: the fault, received argument names, undeclared arguments, schema parameters, and the shape of a correct call. Separately, `read_image` and `describe_image` folded into `read_file`: image files or HTTP(S) URLs return image content when the Session model reads images, otherwise the Project's vision model answers with an optional `prompt`.

## Notable in this release

- **The macOS installers are built with electron-builder 26.16.1.** This is the only change between 0.2.10 and 0.2.11, fixing signed macOS builds that failed in `security set-key-partition-list` because 26.15.3 unlocked its temporary signing keychain with the certificate's import password instead of the keychain's own, which the GitHub runner image of 2026-09-08 no longer tolerates. Per-change entries remain in [`changelog/0.2.10/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.10).
- **What upgrading asks of you: one restart for one kind of user, and two clicks.** This release has the first restart-only schema migration (`drop-goal-state`): hot-pushes are refused before touching the database; normal installs apply it at open. Two clicks worth doing: install the `goal` plugin once on pre-release Agents, otherwise goal mode returns `409 goal_plugin_not_installed`, and update the kernel to `2026-09-10` so Agents are told to use `read_file` for images — until then, stale `read_image` / `describe_image` calls get the unknown-tool reply and image reads run under the stored 30s timeout. Scripts change `skills` / `--skills` to `plugins` / `--plugins`. API clients: `GET …/usage` no longer returns `errors.clearable`; `DELETE …/usage/errors` requires both date bounds; `POST /api/version/update` returns a job status; machines routes moved under a Project, so 0.2.9 machine lists start empty. Downgrading to 0.2.9 still works. See [`2026-09-02-backward-compatibility`](2026-09-02-backward-compatibility.md) and [`2026-09-02-backward-compatibility-read-file-images`](2026-09-02-backward-compatibility-read-file-images.md).

- **Updating runs through one dialog** — check, release notes, **Download and update**, a real progress bar with **Continue in background**, then **Restart and update**. Server self-update is a supervised background job; the desktop shell no longer downloads on its own.

- **A slow turn says what it was waiting on.** Chat header details and Trace show `Elapsed 10.3s (API 5s, tools 5.3s)`; API time excludes approval wait, and tool time counts overlapping tool intervals once.

- **The sidebar says which conversations still have something running.** Sessions with dev servers or background subagents show an activity trace; the chat header shows a matching pill. Both follow a live `session_background` event. The same mark appears on `run_in_background` tool rows.

- **A compaction shows its work.** The compaction row reports status and wall time, and streams thinking and summary into separate disclosure rows with timing.

- **An LLM request times out on silence, not on length.** `model.timeoutMs` is an idle budget between upstream events, defaulted to 300000. Requests now ask for thought summaries, and the retry ladder resets after any received content, capped at 20 attempts per turn.

- **A queued steering message survives an interrupt.** Undelivered steered text returns to the composer with its images and attachments; reload restores it too.

- **The sidebar lists every Workspace** — built from server per-Workspace counts, not only conversations touched by recent pages, with each group's first page fetched lazily.

- **The Trace panel prices each request at the tier it ran in**, so Trace totals match the toolbar and cost center for the same requests.

- **An Agent's `penguin` is the harness running it.** The server writes a launcher into `<root>/bin/penguin` and puts that directory first on PATH for every spawned command.

- **Clearing error records names its range** and removes exactly the rows listed; presets narrow, and admin clear includes unattributed rows.

- **Terminals behave like terminals.** Hyperlinks open by position after redraws; OSC 52 copy reaches the system clipboard; Ctrl+W closes the focused terminal after confirmation.

- **Copy Session ID** is an action on the Session row itself — ellipsis or right-click — placed between archive and delete.

- **Every dialog holds keyboard focus and hands it back.** Modal traps Tab and Shift+Tab, restores focus on every close path, and carries `role="dialog"` with a name from its own heading.

- **The frontend is compressed on the way out** — brotli or gzip negotiated per request, ETag-cached, `Vary` sent. Current bundle: 1229 KB → 329 KB.

- **Schema changes are ordered migrations** stamped into `PRAGMA user_version`; hot-push applies only `swapSafe` migrations and refuses the rest before touching the database.

- **Memory files keep one order whatever locale the server runs under** — the topic-file comparator no longer follows the process locale.

- **The discount badge says what it means**: `50% off` / `省 50%`, not bare `-50%`. Sidebar marks were corrected in the same spirit — history, Agent robot, model brain, Project members — and the Agents-page update notice keeps its distance.

- **The landing page** alternates "auto-dev" and "auto-tuning" (自动开发 / 自动调优), and draws the app's own Agent glyph, pinned by a test that fails when only one of the two moves.

- **The docs gained a Security Model page** organized by user scenarios in order, ending on leak response: a leaked data-root backup is a credential-rotation incident for model keys, not a forged-session incident.

- **Plugin versions read `2026.09.10.1`.** The dated version in a plugin's manifest is spelled with dots throughout instead of dashes; a copy installed under the old `2026-09-10.1` spelling is read as the same version, so nothing is reported as needing an update over the rename.

- **A conversation opens on its latest 50 turns** instead of the whole transcript; earlier turns load as you scroll up, so a long Session no longer stalls on open.

- **Under the hood**: the CI runtime artifact now carries the Web App; the server verifies its web dist; skill-archive caps are enforced from the zip central directory; terminal tests kill shells between runs; the default system prompt searches from `CWD` down; and AgentHub moved to 0.4.11, enabling readable large screenshots on GPT-5.6, the vLLM adapter, and `gpt-6-astra` routing.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The desktop app and the CLI installers bundle their own runtime; installing from npm needs Node >= 24, or the official Docker image, which carries its own. All data stays under `~/.penguin/data` — the `/data` volume in the container.

Full detail: [changelog/0.2.10/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.10).

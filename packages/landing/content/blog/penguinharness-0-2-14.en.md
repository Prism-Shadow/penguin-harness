---
title: "PenguinHarness 0.2.14: the most comprehensive self-evolution framework, browser automation, A2UI, API integration and machine management"
date: 2026-10-13
category: news
excerpt: "Five RSI algorithms ship as plugins and run on seven built-in Benchmarks. Agents also get a browser, reply with interactive UI, build a hot-reloaded workbench of their own, run on other machines, and connect to any app through one API."
---

With 0.2.14, PenguinHarness becomes a framework for agent self-evolution. Five self-evolution (RSI) algorithms ship as plugins, and every new Project comes with seven built-in Benchmarks to run them on. Agents also get five capabilities: a browser, interactive UI in replies, a workbench of their own, other machines to run on, and one API that connects them to any app.

![The start page: the counts of agents, RSI algorithms and Benchmarks, and the examples](/blog-assets/penguinharness-0-2-14-start-page-en.png)

## Self-evolution

### Five RSI algorithms as plugins

The new **Agent Self-Evolution** category in the plugin market holds five toolkits: `default-rsi-toolkit` (trial, reflect, improve) and one toolkit each for OPRO, APE, ACE and AWM, run the way their papers describe.

- Pick one under **Method** on the Evaluation Center's **Use** › **Optimize** tab.
- Each candidate the toolkit measures becomes a new Agent State version, snapshotted before it changes, so any round can be rolled back.
- General Agent in a new Project has all five installed.

![The Agent Self-Evolution category with the five RSI toolkits](/blog-assets/penguinharness-0-2-14-rsi-plugins-en.png)

### Seven built-in Benchmarks

A new Project comes with PenguinHarness Benchmark Sec A to Sec E, drawn from rag-bench-essential, DeepSWE, AutomationBench, Terminal-Bench-Science and Terminal-Bench, plus GDPevo Train and GDPevo Test: optimize on Train, then check on Test.

- Every case runs as a Harbor task in Docker.
- Benchmarks are packages now: **Import benchmark** takes a zip or a repository folder, and a published Benchmark has **Export**.

![GDPevo Train: three agents, each on its own model, climbing across versions](/blog-assets/penguinharness-0-2-14-benchmark-detail-en.png)

Tutorial: [Pick an algorithm and let your agent evolve itself on a Benchmark](/blog/self-evolve-agents-with-rsi-toolkits).

## Agents that browse, show UI and build their own workbench

### Browser automation

Agents open and work in web pages, either in the desktop app's built-in browser or in your own Chrome, and you follow the agent's tabs in the **Browser** panel beside the conversation.

- Agents drive it from the shell with `penguin browser`: `open`, `scan`, `click`, `type`, `exec`. The preinstalled `browser-automation` plugin teaches them the loop.
- Token-efficient: an agent reads a page as text with `scan` and acts through a short `exec` script. It takes a screenshot only when the layout matters. The design comes from [GenericAgent](https://github.com/lsdefine/genericagent); thanks to its authors.
- The built-in browser keeps its own sign-ins. **Import from browser…** copies cookies and history from Chrome, Edge, Firefox and other browsers.
- To use your own Chrome, install PenguinHarness Browser from the Chrome Web Store and pair it in **Settings** › **Browser**. Agents only touch the tabs in the Penguin tab group.

![An agent reads the PenguinHarness blog in the Browser panel and lists the newest posts](/blog-assets/penguinharness-0-2-14-browser-en.png)

Tutorial: [The browser extension: agents drive your Chrome smoothly, at low cost](/blog/let-agents-use-the-browser).

### A2UI: replies that carry UI

A reply can now include components (choices, forms, steps, callouts, Mermaid diagrams, and weather, clock, countdown and metrics widgets), drawn with the app's own components and theme.

- Picking an option or filling in a form puts plain text in the composer. Nothing is sent until you press Send.
- The preinstalled `a2ui` plugin teaches the model when to use a block and ships a checker that rejects a block that would not render. The CLI and the chat channels show blocks as plain Markdown.

![A reply with a Mermaid flow, a steps block and a choice](/blog-assets/penguinharness-0-2-14-a2ui-blocks-en.png)

![A reply with the weather, clock, countdown and metrics widgets](/blog-assets/penguinharness-0-2-14-a2ui-widgets-en.png)

### A hot-reloaded workbench for every agent

Every agent can have a workbench of its own: ask for one, and the agent writes a workflow, a page with its own server code, shown as a tab beside its chat. A legal agent's contract desk and a data agent's dashboard each stay with their own agent, and the rest of the app does not change.

- The server type-checks each change and reloads the tab in place. An edit that fails to load leaves the previous version running.
- Each version that loaded is kept, up to 20. **History** lists them and **Restore** brings one back.

![The legal agent's Contract desk, built from one sentence and changed by asking](/blog-assets/penguinharness-0-2-14-workflow-en.png)

Tutorial: [Give every agent its own hot-reloaded workbench](/blog/build-agent-apps-with-workflows).

## Run anywhere, call from anywhere

### Remote machines

An admin adds a machine the server reaches over ssh. PenguinHarness installs itself there. A conversation in a Workspace on that machine runs there while you stay in the same window.

- **Add machine** on the **Machines** page installs, connects and hands over the Project's models and settings.
- In a new chat, the **Workspace** picker lists folders on your machines. The sidebar marks the group, for example `etl [SSH: devbox]`.
- A machine stays connected across dropped sessions and restarts on either side.

![A conversation running on the machine devbox](/blog-assets/penguinharness-0-2-14-machines-en.png)

Tutorial: [One window, agents on every machine you have](/blog/run-agents-on-remote-machines).

### Agent API

Each agent can have an HTTP API: your program sends input and reads the run back as a stream of AMSP events.

- Turn it on in the agent's **API** tab and create a key with **New key**. **Try it** runs the agent and shows the stream a program would receive.
- `@prismshadow/amsp` is a dependency-free TypeScript client for Node 24 and browsers. `penguin agent api` manages the same settings from a terminal.

![Try it after one run: the tool call, the answer and the run totals](/blog-assets/penguinharness-0-2-14-agent-api-en.png)

Tutorial: [Connect agents to any external app through one unified API](/blog/call-agents-with-the-agent-api).

## Also in this release

![The same conversation in Frost, Console and Primer, top to bottom](/blog-assets/penguinharness-0-2-14-themes-en.png)

- **Three themes.** Frost is the new default; Console and Primer are under **Settings** › **Appearance** › **Theme**, each with its own fonts, icons and streaming effect.
- **One plugin market.** Every plugin is a card grouped by category. **Import plugin** takes an npm name, a link or a zip, and **Export** writes a plugin out as a zip.
- **The sandbox ships with every install**: bubblewrap with a Landlock floor on Linux, Seatbelt on macOS, WSL on Windows. It stays off until an admin enables it on the **Agent Sandbox** card.
- **A find bar.** Mod+F searches the conversation, the Session list or the Files panel.
- **Keyboard shortcuts** follow the platform, can be rebound in **Settings** › **Keyboard shortcuts**, and include a command palette (Mod+Alt+P).
- **Switch models inside a conversation.** The context is compacted on the old model and the same Session continues on the new one.
- **Archived chats move to Settings.** The sidebar lists active conversations only.
- **Model catalog:** Claude Fable 5.1, Claude 5.5 and GPT-6.1 Sol presets, and Penguin Go, OpenCode Go, ModelScope and Atlas Cloud groups. Model access now runs on MMSP 0.5.2.
- **Hot updates keep Tasks running.** A hot update of the harness, or a plugin install or removal, no longer aborts running Tasks or denies pending approvals. Only when an update changes the agent-state interface do the interrupted Tasks restart from their Trace.
- **Failed requests recover better.** A retry tells the model what failed, a failed run has **Retry**, and an image a provider rejects no longer breaks the rest of the conversation.

## Upgrading

- **The app opens in Frost.** To get the 0.2.13 look back, pick Primer under **Settings** › **Appearance** › **Theme**, and L under **Font size** (the default dropped from 18px to 16px).
- **`agent-tuning` is gone.** It was split into `default-rsi-toolkit`, `agent-evaluation` and `agent-development`. Existing agents keep their Skills; install the OPRO, APE, ACE or AWM toolkit from **Plugins** before choosing it as a method.
- **A plugin's manifest is its `package.json`.** `plugin.json` is no longer read: move PenguinHarness's own fields into a `penguin` block; the npm fields stay at the top level.
- **The data root's `plugins.json` is no longer read.** Turn the sandbox on from the **Agent Sandbox** card in **Settings** › **Plugins** instead.
- **Click Add new models on the Models page** (formerly Sync presets) to bring the new presets into an existing Project.
- **Gateway and custom model rows need their own key.** They no longer borrow `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` from the environment; set it under **Group settings…**.
- **Rename `AGENTHUB_DEBUG` and `AGENTHUB_CACHE_DIR`** to `MMSP_DEBUG` and `MMSP_CACHE_DIR`.
- **Update each agent's kernel** with **Update now** on the **Agents** page, and update `goal`, `agent-development` and `agent-company` from the notice on the **Plugins** page.
- **Install the new plugins on existing agents.** `browser-automation`, `a2ui` and the RSI toolkits are preinstalled only on the General Agent of a Project created with 0.2.14; install them on other agents from the **Plugins** page.
- **CLI commands moved:** `penguin ls`, `penguin logs` and `penguin input` are now `penguin session ls`, `penguin session log` and `penguin session input`, and `penguin config provider` is gone: use `penguin config model add --provider <group>` without `--model-id`.
- **Conversations opened by programs are archived.** Sessions that the Agent API, a scheduled task or `penguin run` opened, older ones included, leave the sidebar and are listed under **Settings** › **Archived chats**.
- **`.project_config.toml` is rewritten once on first read**, and migrations 9 to 16 run when the database opens. Releases before 0.2.14 cannot read the rewritten file, so copy it first if you may roll back.

The full list, including HTTP API and SDK changes, is in [`changelog/0.2.14/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.14).

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

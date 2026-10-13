PenguinHarness 0.2.15 is 0.2.14 shipped under a new number: that tag's release run failed in its npm job, at the test step, before anything was published — no npm packages, no Docker image and no Release page — so install 0.2.15 instead.

PenguinHarness 0.2.15 turns the harness into a framework for agent self-evolution: five RSI algorithms ship as plugins, and every new Project comes with seven Benchmarks to run them on. Agents also gained five capabilities — a browser, replies that carry interactive UI, a hot-reloaded workbench of their own, other machines to run on, and one unified API that connects them to any external app.

![The start page: the counts of agents, RSI algorithms and Benchmarks, and the examples](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-start-page-en.png)

## Install

**Desktop app**: grab your platform's installer from [penguin.ooo/download](https://penguin.ooo/download) — the page measures both sources on every visit and keeps GitHub unless the OSS mirror is measurably faster. A manual selector sits beside the result. The macOS builds are Developer ID signed and notarized, and the Windows installers are Authenticode-signed. Neither platform needs a first-launch unblock.

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

`latest` follows `main` and is rebuilt on every push. `0.2.15` is this release, built from its own tag. The example publishes the port on the host's loopback, so a fresh deployment answers only on the machine running Docker.

## Highlights

**Five RSI algorithms as plugins.** The plugin market has a new first category, **Agent Self-Evolution**, holding one toolkit per algorithm: `default-rsi-toolkit` (trial, reflect, improve) and toolkits for [OPRO](https://arxiv.org/abs/2309.03409), [APE](https://arxiv.org/abs/2211.01910), [ACE](https://arxiv.org/abs/2510.04618) and [AWM](https://arxiv.org/abs/2409.07429), each run the way its paper describes. A toolkit changes the agent's harness — its prompt and its Skills — never the model. Every change is measured on a Benchmark. Pick one under **Method** on the Evaluation Center's **Use** › **Optimize** tab. Each candidate becomes a new Agent State version, snapshotted before it changes, so any round can be rolled back. The General Agent of a new Project has all five installed. `agent-tuning` is gone: it was split into `default-rsi-toolkit`, the new `agent-evaluation` plugin and `agent-development`.

![The Agent Self-Evolution category with the five RSI toolkits](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-rsi-plugins-en.png)

**Seven built-in Benchmarks.** A new Project is created with PenguinHarness Benchmark Sec A to Sec E — drawn from rag-bench-essential, DeepSWE, AutomationBench, Terminal-Bench-Science and Terminal-Bench — plus GDPevo Train and GDPevo Test. The two GDPevo Benchmarks are built for self-evolution: optimize on Train, then check on the 30 held-out cases of Test. Every case runs as a [Harbor](https://github.com/harbor-framework/harbor) task in Docker. Benchmarks are packages now: **Import benchmark** takes a zip or a repository folder, and a published Benchmark has **Export**.

![GDPevo Train: three agents, each on its own model, climbing across versions](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-benchmark-detail-en.png)

**Browser automation.** Agents open and work in web pages — in the desktop app's built-in browser, or in your own Chrome through the PenguinHarness Browser extension from the Chrome Web Store, paired under **Settings** › **Browser**. They drive it from the shell with `penguin browser` (`open`, `scan`, `click`, `type`, `exec`), taught by the preinstalled `browser-automation` plugin. You follow their tabs in the **Browser** panel beside the conversation. The built-in browser keeps its own sign-ins and can import cookies and history from Chrome, Edge, Firefox and other browsers. In Chrome, agents only touch the tabs in the Penguin tab group. Agents read a page as text with `scan` and act through a short `exec` script, taking a screenshot only when the layout matters, which keeps a step to a few dozen tokens. The design comes from [GenericAgent](https://github.com/lsdefine/genericagent); thanks to its authors.

![An agent reads the PenguinHarness blog in the Browser panel and lists the newest posts](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-browser-en.png)

**A2UI: replies that carry UI.** A reply can include choices, forms, steps, callouts, Mermaid diagrams, and weather, clock, countdown and metrics widgets, drawn with the app's own components and theme. Picking an option or filling in a form puts plain text in the composer. Nothing is sent until you press Send. The preinstalled `a2ui` plugin teaches the model when to use a block and ships a checker that rejects one that would not render. The CLI and the chat channels show blocks as plain Markdown.

![A reply with a Mermaid flow, a steps block and a choice](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-a2ui-blocks-en.png)

**A hot-reloaded workbench for every agent.** Every agent can have a workbench of its own: ask for one, and the agent writes a workflow, a page with its own server code shown as a tab beside its chat. A legal agent's contract desk and a data agent's dashboard each stay with their own agent, and the rest of the app does not change. The server type-checks each change and reloads the tab in place. An edit that fails to load leaves the previous version running. Up to 20 loaded versions are kept, and **History** › **Restore** brings one back. A page can also fill the whole window, which is what `penguin web --app <project>/<agent>/<workflow>` opens.

![The legal agent's Contract desk, built from one sentence and changed by asking](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-workflow-en.png)

**Remote machines.** An admin adds a machine the server reaches over ssh. **Add machine** on the **Machines** page installs PenguinHarness there, connects, and hands over the Project's models and settings. A conversation whose Workspace is on that machine runs there while you stay in the same window. The new-chat **Workspace** picker lists folders on your machines, and the sidebar marks the group, for example `etl [SSH: devbox]`. A machine stays connected across dropped sessions and restarts on either side.

![A conversation running on the machine devbox](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-machines-en.png)

**Agent API.** One unified API connects any agent to any external app: the app sends input over HTTP and reads the run back as a stream of AMSP events, with the same endpoints and client whichever agent it calls. Turn it on in the agent's **API** tab and create a key with **New key**. **Try it** runs the agent and shows the stream a program would receive. `@prismshadow/amsp` is a dependency-free TypeScript client for Node 24 and browsers. `penguin agent api` manages the same settings from a terminal. An agent has at most four conversations running at once, Web App ones included. Past that, a new run is refused with `429`.

![Try it after one run: the tool call, the answer and the run totals](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/blog-assets/penguinharness-0-2-14-agent-api-en.png)

Each of these has a step-by-step tutorial on the blog: [self-evolution](https://penguin.ooo/blog/self-evolve-agents-with-rsi-toolkits), [the browser extension](https://penguin.ooo/blog/let-agents-use-the-browser), [workbenches](https://penguin.ooo/blog/build-agent-apps-with-workflows), [remote machines](https://penguin.ooo/blog/run-agents-on-remote-machines) and [the Agent API](https://penguin.ooo/blog/call-agents-with-the-agent-api).

## Notable in this release

- **What upgrading asks of you.**
  - The app opens in Frost. For the 0.2.13 look, pick Primer under **Settings** › **Appearance** › **Theme**, and L under **Font size** (the default dropped from 18px to 16px).
  - A plugin's manifest is its `package.json`; `plugin.json` is no longer read. Move PenguinHarness's own fields into a `penguin` block. The data root's `plugins.json` is no longer read either: turn the sandbox on from the **Agent Sandbox** card in **Settings** › **Plugins**.
  - Gateway and custom model rows no longer borrow `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` from the server environment. Set the key under **Group settings…**. Rename `AGENTHUB_DEBUG` and `AGENTHUB_CACHE_DIR` to `MMSP_DEBUG` and `MMSP_CACHE_DIR`.
  - **Add new models** on the Models page (formerly Sync presets) brings the new presets into an existing Project.
  - Update each agent's kernel with **Update now** on the **Agents** page, and update `goal`, `agent-development` and `agent-company` from the notice on the **Plugins** page. `browser-automation`, `a2ui` and the RSI toolkits are preinstalled only on the General Agent of a Project created with 0.2.15. Install them on other agents from the **Plugins** page.
  - CLI: `penguin ls`, `penguin logs` and `penguin input` are now `penguin session ls`, `penguin session log` and `penguin session input`; `penguin config provider` is gone — use `penguin config model add --provider <group>` without `--model-id`.
  - Sessions that the Agent API, a scheduled task or `penguin run` opened, older ones included, leave the sidebar and are listed under **Settings** › **Archived chats**. The Session list's `category=background` now answers 400; ask for `category=archived`.
  - `.project_config.toml` is rewritten once on first read, and migrations 9 to 16 run when the database opens. Releases before 0.2.15 cannot read the rewritten file, so copy it first if you may roll back.
  - SDK: `PartialAggregator`, `aggregateAll` and `Writer.aggregateAndWrite` are no longer exported by `@prismshadow/penguin-core`; the script hook helpers take an options object.
- **Three themes.** Frost is the new default. Console and Primer are under **Settings** › **Appearance** › **Theme**, each with its own fonts, icons and streaming effect.
- **One plugin market.** Every plugin is a card grouped by category. **Import plugin** takes an npm name, a link or a zip, and **Export** writes a plugin out as a zip.
- **The sandbox ships with every install**: bubblewrap with a Landlock floor on Linux, Seatbelt on macOS, WSL on Windows. It stays off until an admin enables it on the **Agent Sandbox** card.
- **Hot updates keep Tasks running.** A hot update of the harness, or a plugin install or removal, no longer aborts running Tasks or denies pending approvals. Only an update that changes the agent-state interface restarts the interrupted Tasks, from their Trace.
- **Failed requests recover better.** A retry tells the model what failed, a failed run has **Retry**, and an image a provider rejects no longer breaks the rest of the conversation.
- **Switch models inside a conversation.** The context is compacted on the old model and the same Session continues on the new one.
- **A find bar.** Mod+F searches the conversation, the Session list or the Files panel.
- **Keyboard shortcuts** follow the platform, can be rebound under **Settings** › **Keyboard shortcuts**, and include a command palette (Mod+Alt+P).
- **Archived chats move to Settings.** The sidebar lists active conversations only.
- **The model catalog**: Claude Fable 5.1, Claude 5.5 and GPT-6.1 Sol presets, and Penguin Go, OpenCode Go, ModelScope and Atlas Cloud groups. Model access runs on MMSP 0.5.2.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The desktop app and the CLI installers bundle their own runtime. Installing from npm needs Node >= 24; the official Docker image carries its own. Running the built-in Benchmarks needs Docker with Compose v2 and [uv](https://docs.astral.sh/uv/) on the server's machine. The Browser extension needs Chrome 116 or later. All data stays under `~/.penguin/data` — the `/data` volume in the container.

Full detail: [changelog/0.2.15/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.15).

PenguinHarness 0.2.19 is the release where PenguinHarness becomes a Harness OS. The App Center is the Project's home screen, one tile per workbench, and Models, Plugins, Machines, Cost Center and Self-Evolution Workbench are system apps on it. Build New App, Optimize App and Publish App on the new chat page each fill a prompt for the agent to build, improve or publish a workbench app; the plugin market installs apps and agent abilities behind one staged progress bar; every theme is a pack a server imports and exports as a zip. The data root moves Projects under `projects/` at the first start; the migration is automatic.

## Install

**Desktop app**: get your platform's installer from [penguin.ooo/download](https://penguin.ooo/download) — the page measures both sources on every visit and keeps GitHub unless the OSS mirror is measurably faster. A manual selector sits beside the result. The macOS builds are Developer ID signed and notarized, and the Windows installers are Authenticode-signed. Neither platform needs a first-launch unblock.

**Windows desktop app of 0.2.16 or earlier: install this release by hand once**, as for 0.2.17. The updater of 0.2.16 and earlier refuses installers signed with the new certificate. Download the installer from [penguin.ooo/download](https://penguin.ooo/download) and run it.

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
docker run -d --name penguin -p 127.0.0.1:7364:7364 -v penguin-data:/data hiyouga/penguinharness:0.2.19
```

`0.2.19` is built from this release's tag. `latest` follows changes to the image's runtime or build inputs on `main`. The example publishes the port on the host's loopback, so a fresh deployment answers only on the machine running Docker.

## Highlights

### The App Center is the home screen

**App Center** is now the Project's home screen: one tile (icon and name) per workbench of the Project's agents. Tiles drag to reorder and into folders; a folder opens in place from its icon, and a folder left with one app dissolves. A click opens an app in a window over the grid; the window can be minimized while the app keeps running, opened full screen, or closed, and several apps run at once.

**Models**, **Plugins**, **Machines**, **Cost Center** and **Self-Evolution Workbench** are now system apps: App Center tiles of a built-in system agent instead of sidebar entries. **Machines** stays administrator-only. The sidebar's fixed block is **New chat**, **Agents** and **App Center**; below it, an **Apps** group lists the apps open in this window, with **More actions**, **Open full screen** and **Close** on each row.

A conversation and an app open side by side: the app sits in the conversation's right dock, panes swap, and either takes the full width. For an administrator, the App Center also lists the apps of the Project's connected machines. **Terminal** and **Browser** have App Center tiles that list Sessions with live terminals or open pages; **Files** opens from a Session's shortcuts.

### Build, improve and publish an app from the new chat page

The new chat page has three fixed shortcuts under the composer: **Build New App**, **Optimize App** and **Publish App**. **Build New App** fills a prompt for a new workbench app published to the App Center. **Optimize App** fills a prompt asking the agent to improve a chosen app. **Publish App** fills a prompt asking the agent to open pull requests that add the app to the PenguinHarness Apps repository and register it in the plugin index.

An app is made of files. A workbench page can be a `.tsx` file importing React and `@prismshadow/penguin-ui`; the server type-checks and compiles it on load, and a type error is reported as `ui/<file>:<line>:<col>`. `@prismshadow/penguin-ui` is published to npm with each release. Asked for a web page, web app or dashboard in a Workspace with no existing project, the `web-design` Skill first asks whether to build a Workbench or a standalone app.

A workbench's history is Git: versions are git commits in a bare repository beside the Agent State (`agent_state.git/`), written by a bundled Git engine with no system git needed, and **History** and **Restore** read them. A version's commit names its author, the member whose request recorded it, and a new `agent-state-git` plugin records versions with native Git and carries Git itself. Workbenches import and export as zips, or import through a chat with the agent. A workbench has its own data, cache and state folders at agent, server and machine level (`WorkbenchHost.dataPaths(level?)`); it can open a Session that only talks (`host.createSession({ approvalMode: "deny-all" })`), play speech with the Project's voice model, open the Project's Models page, or request pointer lock for a game.

AI PPT ships as the built-in `use-bento-slides` plugin: a Slides workbench that puts Bento's slide editor beside the agent's chat, where the person and the agent edit one deck file and both sides' edits are kept. It comes preinstalled on a new Project's default agent, and the model and thinking level can be changed while working on a deck. Image Studio, from the multimodal tools plugin, takes a picture description and an aspect ratio, and each brief opens a Session that generates with the Project's image model. Reading Desk (EPUB, DOCX, Markdown and plain text, with highlights and notes) and five everyday workbenches (Fridge Keeper, Action Minutes, Tabletop Desk, Party Charades, Daily Draw) are available from the plugin market.

### A plugin market for apps and agent abilities

The Plugins page is now a market: cover cards or a compact list, search, filters, grouping, and a shareable address per plugin. Installing shows one progress bar cut into the stages of that install (look up, download and install, start, choose an agent), with **Continue in background**. Administrators update a plugin from the market or from **Agent settings**, and both views show the installed and target versions first.

For an administrator the market lists the plugins of every machine of the Project. **Agent settings** has a **Plugins** tab with four sub-pages: **Plugins**, **Skills**, **Hooks** and **Workbenches**, and a whole plugin uninstalls from an agent in one step. Plugin index sources and their CDN mirrors are settings under **Settings › Plugins**.

`penguin plugin link <directory>` links a local plugin package directory into the server instead of uploading a copy. Plugins with no dependencies install and uninstall on a machine without npm, the desktop app included. A2UI, External Plugin Porting and Firecrawl ship from the PenguinHarness Apps repository's releases; Humanizer, Claude Code and Continual Learning are installed from the market.

### Self-evolution has its own workbench

New Projects install the Self-Evolution Workbench on the default agent, and it is one of the first App Center tiles. The product ships the Default RSI Toolkit; the other algorithm toolkits (OPRO, APE, ACE, AWM, SkillAdam, SkillOpt, OpenSkill, TRACE and RRSI) install from the RSI Platform through the plugin market. RRSI is new in this release.

**Optimize App** on the new chat page fills a prompt asking the agent to improve a chosen app. A Benchmark's Use dialog has a **Tested agent's model** field, separate from the model of the conversation that runs the evaluation or optimization. New Projects receive GDPEVO as separate Train and Test Benchmarks for six domains.

### Theme packs, and a fourth theme

Every theme is a pack over Frost, and Doodle (卡通) is a fourth built-in theme after Frost, Console and Primer.

An administrator imports a theme pack as a zip, and every account on that server can pick it. Any pack exports to the same zip, and packs are validated at import.

**Settings › Appearance › Reasoning display** offers Standard, Expanded and Compact views of a conversation's reasoning and tool steps. An agent without a picture is drawn as a penguin avatar, and an agent can be given its own picture.

## Notable in this release

- **New plugins**: Multimodal tools, Computer Use, Storage, Plan mode and Trace Lookup ship as plugins. `@penguinharness/multimodal-tools` serves eight tools on the Project's models through `penguin tools …`: text generation, image understanding, web search, page fetching, image, video and speech generation, and speech recognition. With a speech recognition model chosen, the microphone beside **Send** dictates into the draft; with a speech synthesis model chosen, the speaker on a reply reads its final answer aloud. `@penguinharness/computer-use` lets an agent see and operate desktop apps with `penguin computer`, on macOS, Windows and Linux, through agent-desktop. The module is bundled; an administrator enables it for a Project from its market card. By default only administrators, and agents in a conversation an administrator drives, may use it. Storage is preinstalled: **Settings › Storage** and `penguin storage` show what the data root holds by category, per Project and per agent, and clean up scratchpads, temporary Workspaces and caches after a review. Plan mode, in the built-in `plan` plugin, is a switch in the composer's + menu, or `/plan`, that asks the agent to settle the approach with you before carrying it out; it restricts no tool. A new Project's default agent has it; for any other agent, Goal and Plan are selected at creation or installed later. The Trace Lookup plugin is a Skill that teaches an agent to read its own Trace files. The `penguin` CLI is built from command contributions, so a plugin can add commands.

- **Conversations**: Interrupt joins Steer and Queue as a third mid-run send mode. A compaction can save detail to hand-off files and always opens the next context; a model switch hands the history over by its Trace path when the current model is unavailable. A subagent is addressed by its Session ID; the Agent panel shows earlier turns' subagents and draws the topology on a pan-and-zoom canvas. Typing `/` while a task runs adds one of the agent's Skills to the interjection. Every failure the app shows offers [Report], which opens a prefilled problem report.

- **Agents**: An agent waits for a person's go-ahead before merging a pull request, publishing a package or force-pushing; every factory command-policy rule asks instead of refusing. An agent exports and imports as a zip of its directory, optionally with chosen Sessions' Traces. A memory can keep scripts the agent reuses, in a folder named after the memory file. Agents record an author (user, agent or company), and the **Agents** page groups by it.

- **Models**: New Projects start with no default model; a first-run guide asks for one in a **Default model settings** dialog. New presets add Gemini 4 Neon and Gemini Nano Banana 2.1 (Google, OpenRouter); Tencent Hy4 (OpenRouter, TokenDance); Hy4 Flash, Qwen4 Max and GLM-5.4 (TokenDance); Gemini 4 Hydrogen and seven tool models in Penguin Go; DeepSeek TTS on TokenDance; the Runcrate gateway group; and the JellyToken provider. MMSP is 0.5.12. Existing Projects add presets with **Add new models**. Importing a model group lets you pick which models to import.

- **Remote machines and terminal**: A remote conversation's history streams newest first with progress, and recent messages stay readable while the machine is disconnected. The Machine dialog gains **Reinstall**, and **Stop retrying** frees the machine at once. The terminal survives a mobile network; administrators set per-user terminal limits and built-in browser page limits.

- **Desktop**: The desktop app gains a second window from the command palette, a title band that is part of the app, a right-click edit menu, Google sign-in in the built-in browser, and Cmd/Ctrl+B for the sidebar. Windows Setup can put server data and the desktop profile on another drive. The app and every workbench carry an installable PWA manifest.

### Upgrading

- **Data root**: Nothing to do. A one-time migration at the first start moves Projects to `<root>/projects/<project_id>/` and Benchmarks into the Evaluation Center's data folder; it leaves a link at each old place and does not rewrite Traces. One exception: a Project named `projects` keeps the server from starting. Start the previous version, move its agents to another Project (export, then import), delete it, and start 0.2.19 again.
- **Windows**: The migration moves every Project folder or none. If a program holds a Project folder open (a terminal, editor or File Explorer window, or a command running in one of its Workspaces), nothing is moved and the start or hot update says what to close. A desktop upgrade keeps the data location unless another folder is chosen in **Setup**. If **Setup** cannot identify the contents of a custom program folder registered by a legacy installer, it leaves the folder in place.
- **Remote machines**: Remote machines must run the server's version. Update each from the **Machines** page. A machine still on the old layout that refuses a hot update keeps its current version. Restart that machine's server (this ends its terminals and commands), then update it again.
- **An agent named `system_agent`**: A Project that already holds an agent with the id `system_agent` gets no system agent, and the **Agents** page shows its owner a notice. Export that agent, import it under another id, delete the old one.
- **New Projects and scripts**: A script that creates a Project and then a Session, schedule or organization must name a model or set the default first: `penguin config model default --provider <group> --model-id <id>`. Existing Projects keep their default model and their stored command-policy rules, `deny` rules included.
- **HTTP API**: The agent `export` / `import` routes and the create request's `dataBase64` are removed, replaced by `GET …/agents/:agentId/archive` and `POST …/agents/import`; earlier `.tar.gz` packages still import. Deleting an organization answers `200` with a report instead of `204`. A memory export is a zip, which a server from before this release refuses; older JSON exports still import.
- **SDK**: An approval callback that ignores `context.reason` now lets a factory-rule hit such as `rm -rf` through under allow-all; pass a `commandPolicy` with `deny` rules to keep a refusal. `@prismshadow/penguin-core/a2ui` is removed; import from `@prismshadow/a2ui`. `@prismshadow/amsp/records` no longer exports `lastNonTaskRecord`; `Session.switchModel`'s stream ends with `session_update`. `@prismshadow/penguin-ui` no longer exports `EditorScroll` or `DEFAULT_THEME_ID`, and Frost needs `data-theme-base="modern"` beside `data-theme`.
- **Plugin authors**: A plugin package must be built so it carries `ifaces.json` (`penguin-gen-ifaces`). The `penguin` block in `package.json` is no longer read, and a package in `<root>/plugins` without `ifaces.json` is no longer listed. Copies already installed on agents keep working.
- **Existing agents**: Run **Update kernel** on the **Agents** page to bring existing agents the go-ahead rule and the memory Scripts paragraph. The plugin updates offered there bring the Slides workbench (`use-bento-slides`) and the workbench guidance (`agent-development`). Install Plan mode from the **Plugins** tab of **Agent settings**.
- **Workbenches**: Nothing to do. Workbenches moved into Agent State (`agent_state/workbenches/<id>/`) and their saved versions became git commits; the move is automatic and leaves a link at the old place.
- **Company tickets**: New company tickets use a `ticket-` prefix. Existing ticket ids and links keep working.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The desktop app and the CLI installers bundle their own runtime. Installing from npm needs Node >= 24; the official Docker image carries its own. Running the built-in Benchmarks needs Docker with Compose v2 and [uv](https://docs.astral.sh/uv/) on the server's machine. The Browser extension needs Chrome 116 or later. All data stays under `~/.penguin/data` — the `/data` volume in the container.

Full detail: [changelog/0.2.19/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.19).

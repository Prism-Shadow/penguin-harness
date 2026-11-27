---
title: "PenguinHarness 0.2.20: Harness OS, voice input and output, and a plugin market"
date: 2026-11-26
category: news
excerpt: "Everything since 0.2.17: the App Center becomes the Project's home screen, agents build and publish its apps, you can dictate a message and hear the reply, a plugin market installs apps and agent abilities, every theme is a pack, settings follow your account, and 0.2.20 makes workbenches load again in the desktop app."
---

PenguinHarness 0.2.20 is out. This post covers everything since the 0.2.17 post: 0.2.18, 0.2.19 and 0.2.20. **PenguinHarness is now a Harness OS: the App Center is the Project's home screen, and agents build, improve and publish the apps on it.** You can dictate a message and hear a reply read aloud, install apps and agent abilities from a plugin market, and pick one of four themes or import a theme pack. Settings and drafts follow your account, and 0.2.20 makes workbenches load again in the desktop app.

## The App Center is the home screen

**App Center is now the Project's home screen, with one tile per app.** It starts with the system apps **Models**, **Plugins**, **Machines** and **Cost Center**, alongside the **Self-Evolution Workbench**. The system apps moved from the sidebar onto the grid, and the sidebar's fixed block is down to **New chat**, **Agents** and **App Center**. **Machines** stays administrator-only. Every workbench of the Project's agents gets a tile. An administrator also sees the apps of the Project's connected machines.

![The App Center: the system apps Models, Plugins, Machines and Cost Center, the Self-Evolution Workbench, Terminal and the agents' workbenches](/blog-assets/penguinharness-0-2-20-app-center-en.png)

Tiles drag to reorder and into folders. A folder opens in place from its icon, and a folder left with one app dissolves. A click opens the app. It can be minimized while it keeps running, opened full screen or closed. Several apps run at once. An **Apps** group in the sidebar lists the apps open in the window, with **More actions**, **Open full screen** and **Close** on each row. **Terminal** and **Browser** have tiles that list the Sessions with live terminals or open pages.

**A conversation and an app open side by side.** **Open App Center** in the conversation's right dock lists the apps there, and an app opens beside the chat. The panes swap, and either takes the full width.

![A glm-5.3-flash conversation with AI Slides open beside it in the right dock](/blog-assets/penguinharness-0-2-20-app-side-en.png)

## Build, improve and publish apps from the new chat page

**The new chat page has three fixed shortcuts under the composer: Build New App, Optimize App and Publish App.** Each fills in a prompt for the agent and sends nothing. **Build New App** asks for a new workbench app published to the App Center, with the `penguin-plugin` and `web-design` Skills attached. **Optimize App** asks the agent to improve an app you pick. **Publish App** asks it to open pull requests that add the app to the PenguinHarness Apps repository and register it in the plugin index.

![Build New App has filled the composer with its prompt and attached the penguin-plugin and web-design Skills](/blog-assets/penguinharness-0-2-20-build-app-en.png)

An app is made of files. A workbench page can be a `.tsx` file importing React and `@prismshadow/penguin-ui`, which is published to npm with each release. The server type-checks and compiles the page on load and reports a type error as `ui/<file>:<line>:<col>`. A workbench's versions are git commits in a bare repository beside the Agent State (`agent_state.git/`). A bundled Git engine writes them, so no system git is needed. **History** and **Restore** read the commits, and workbenches import and export as zips. A workbench has its own data, cache and state folders. It can open a Session that only talks (`approvalMode: "deny-all"`), play speech with the Project's voice model, and request pointer lock for a game.

There are new apps to start from. AI Slides, from the built-in `use-bento-slides` plugin, puts Bento's slide editor beside the agent's chat, and you and the agent edit one deck file. It comes preinstalled on a new Project's default agent. Image Studio, from the multimodal tools plugin, generates pictures with the Project's image model. Reading Desk and five everyday workbenches (Fridge Keeper, Action Minutes, Tabletop Desk, Party Charades and Daily Draw) install from the plugin market.

## Dictate a message, hear the reply

**With a speech recognition model chosen, the microphone beside Send dictates into the draft; with a speech synthesis model chosen, the speaker on a reply reads its final answer aloud.** Both are chosen under **Multimodal models**, opened from Models or Project settings: the Project's vision model first, then a model for each operation the enabled plugins declare. The `@penguinharness/multimodal-tools` plugin serves eight tools on these models: text generation, image understanding, web search, page fetching, image, video and speech generation, and speech recognition. Agents call them as `penguin tools …` commands.

While you record, the microphone becomes **Finish recording**, and the toolbar shows a cancel button, the elapsed time and a level meter. Send and the other controls stay where they are. The recording is 16 kHz PCM WAV. Finishing transcribes into the draft at the caret; cancelling, or Escape, discards the recording. **Polish dictation** tidies the transcript with the Project's text generation model and inserts the original transcript if polishing fails. A recording with only silence never reaches the model: the app shows "No speech was recognized" and keeps the draft and its attachments. Project owners can also choose an audio-capable Gemini model for speech recognition.

![Dictating into the composer with TokenDance's DeepSeek ASR: the cancel button, the elapsed time, the level meter and Finish recording](/blog-assets/penguinharness-0-2-20-dictation-en.png)

**Read aloud** reads every paragraph of the turn's final answer and leaves earlier updates and tool calls out of the audio. The audio is kept with the Session: any member of the Project who reads the same reply with the same voice model again hears it without a new request. The TokenDance group adds the DeepSeek TTS tool model (`tokendance/deepseek-tts`). Workbenches can play speech with the Project's voice model without opening a Session.

![The dictated question answered by glm-5.3-flash and read aloud by DeepSeek TTS; the button reads Stop reading while it plays](/blog-assets/penguinharness-0-2-20-read-aloud-en.png)

## A plugin market for apps and agent abilities

**The Plugins page is now a market: cover cards or a compact list, search, filters, grouping, and a shareable address for each plugin.** Installing shows one progress bar split into the stages of the install (look up, download and install, start, choose an agent), with **Continue in background**. Administrators update a plugin from the market or from **Agent settings**, and both show the installed and target versions first. For an administrator, the market also lists the plugins on every machine of the Project.

![The plugin market's cover cards, grouped by category](/blog-assets/penguinharness-0-2-20-market-en.png)

**Agent settings** gains a **Plugins** tab with four sub-pages: **Plugins**, **Skills**, **Hooks** and **Workbenches**. A whole plugin uninstalls from an agent in one step. Plugin index sources and their CDN mirrors are settings under **Settings › Plugins**. `penguin plugin link <directory>` links a local plugin package directory into the server instead of uploading a copy. Plugins with no dependencies install and uninstall on a machine without npm, the desktop app included.

**In 0.2.20, the market lists the published plugin index again and says why a source failed.** The index had added an `npm` channel without a `url` to nineteen rows, and the server refused the whole document at the first one. Now only the `github` channel, the one an install downloads from, must carry a `url`. **Details** under the market's notice lists each failed source by its address with the server's reason, followed by **[Report]**.

![The plugin market's notice unfolded: a source whose document was refused and a source whose host did not resolve, each with the server's reason](/blog-assets/penguinharness-0-2-20-market-sources-en.png)

## Theme packs, and a fourth theme

**Every theme is now a pack, and Doodle is a fourth built-in theme after Frost, Console and Primer.** An administrator imports a theme pack as a zip of up to 16 MB, and every account on that server can pick it. Any pack, the built-in ones included, exports to the same zip, and packs are validated at import. Doodle is the first pack built on Frost: it keeps Frost's layout, spacing and motion, and redraws the paper, the type and the pen lines.

![Settings › Appearance in Doodle: the four built-in theme packs, each with Export, and Import a theme pack](/blog-assets/penguinharness-0-2-20-themes-en.png)

**Settings › Appearance › Reasoning display** offers Standard, Expanded and Compact views of a conversation's reasoning and tool steps. Each theme plays its own page transition and draws its own wait indicator. An agent without a picture is drawn as a small penguin in the theme's style, and an agent can be given a picture of its own.

## Settings follow your account, and workbenches follow their agent live

**Since 0.2.18, the preferences on the Settings pages and the Web App's unsent drafts are stored on your account, on the server.** Another browser or the desktop app, signed in to the same account, shows the same theme, language, background image and drafts. On a browser's first sign-in after the upgrade, its preferences and drafts are handed to the account once, if the account has none yet. Panel widths, the dock layout, folds and pins stay in the browser.

**A workbench can follow the Sessions it starts while the agent works**, reading the same AMSP records as the chat. A page imports `../sdk/workbench.js`, served beside every workbench, for `followSession()` and `abortSession()`. A handler calls `WorkbenchHost.subscribe(sessionId, listener)`. Workbench pages take the app's whole theme through `/workbench-ui.css`. The built-in PenguinHarness Support workbench uses this: while a question runs, its dialog shows the answer as it is written, says what the agent is doing, and offers **Stop**.

![The Support workbench researching a question on glm-5.3-flash: the agent's progress as it is written, and Stop](/blog-assets/penguinharness-0-2-20-support-live-en.png)

## Fix a workbench that fails to load

**In 0.2.20, wherever the Web App shows that a workbench's files did not load, it offers Fix with AI and [Report] beside Reload.** They appear in the app's App Center window, in the App Center's **Show error** dialog and in the **More** menu of the workbench's row in **Agent settings**.

![A workbench that failed its type-check, in its App Center window: the error, Reload, Fix with AI and Report](/blog-assets/penguinharness-0-2-20-workbench-fix-en.png)

**Fix with AI** asks for confirmation first. It then opens a new chat for the default agent in a temporary Workspace, with the repair request in the composer, unsent. The request names the workbench, its agent and machine, its folder and the load error verbatim, and explains how a load works. The agent says what it will change before changing anything. When the error comes from the platform itself, such as missing Node or TypeScript declarations, it says so, changes nothing and suggests a report instead. **[Report]** opens the shared problem report with the workbench and its masked load error.

## See the hand-over when there is no summary

**In 0.2.20, when a compaction completes without a full summary, the chat shows what the next context opened with instead.** That is the hand-off note, or, for an in-session model switch, the Trace hand-over. It sits in the compaction row it follows, which settles to **Compacted**; the row's mark says why there was no summary.

![A real glm-5.3-flash turn, then a switch away from a model no longer configured: the Compacted row open at its Hand-off note, and the Model switched divider](/blog-assets/penguinharness-0-2-20-handover-en.png)

The row is folded by default. Its **Hand-off note** section gives the reason, the Trace file the note names, and the note itself. A switch away from a model that can no longer be reached asks nothing of it, so its row reads "The previous model was unavailable, so no summary was requested".

## Also since 0.2.17

- **Self-evolution**: New Projects install the Self-Evolution Workbench on the default agent. The Default RSI Toolkit ships with the product; OPRO, APE, ACE, AWM, SkillAdam, SkillOpt, OpenSkill, TRACE and the new RRSI install from the plugin market. A Benchmark's Use dialog has a **Tested agent's model** field, and new Projects receive GDPEVO as separate Train and Test Benchmarks for six domains.
- **New plugins**: Computer Use lets an agent see and operate desktop apps with `penguin computer` on macOS, Windows and Linux. By default only administrators, and agents in a conversation an administrator drives, may use it. Storage, preinstalled, shows what the data root holds under **Settings › Storage** and `penguin storage`, and cleans up scratchpads, temporary Workspaces and caches after a review. Plan mode, a switch in the composer's + menu or `/plan`, asks the agent to settle the approach with you before carrying it out. Trace Lookup teaches an agent to read its own Trace files. Plugins can add `penguin` commands.
- **Conversations**: Interrupt joins Steer and Queue as a third mid-run send mode. A compaction can save detail to hand-off files and always opens the next context. A subagent is addressed by its Session ID, and the Agent panel draws the topology on a pan-and-zoom canvas. Typing `/` while a task runs adds one of the agent's Skills to the interjection. Every failure the app shows offers **[Report]**.
- **Agents**: An agent waits for a person's go-ahead before merging a pull request, publishing a package or force-pushing, and every factory command-policy rule asks instead of refusing. An agent exports and imports as a zip of its directory. A memory can keep the scripts the agent reuses. Agents record an author, and the **Agents** page groups by it. 0.2.20's default system prompt adds six refinements on verifying deliverables, narrowing failures cheaply and running long commands and services (kernel version `2026-11-26`).
- **Models**: New Projects start with no default model, and a first-run **Default model settings** dialog asks for one. New presets include Gemini 4 Neon and Gemini Nano Banana 2.1; Tencent Hy4; Hy4 Flash, Qwen4 Max and GLM-5.4 on TokenDance; Gemini 4 Hydrogen and seven tool models in Penguin Go; the Runcrate gateway group; and the JellyToken provider. Importing a model group lets you pick which models to import.
- **Remote machines and terminal**: Since 0.2.18, pages show what this server holds without waiting for a machine or the internet. Machine reconnects and model request retries share one row with **Retry now** and **Stop retrying**. Automatic reconnects stop after five failed attempts in a row. A remote conversation's history streams newest first, and recent messages stay readable while the machine is disconnected. The Machine dialog gains **Reinstall**. In 0.2.20, connecting a machine no longer fails at the Sync config step while its server is still starting. The terminal survives a mobile network, and administrators set per-user terminal and built-in browser page limits.
- **Desktop**: A second window from the command palette, a title band that is part of the app, a right-click edit menu, Google sign-in in the built-in browser, and Cmd/Ctrl+B for the sidebar. Windows Setup can put server data and the desktop profile on another drive. 0.2.20 makes workbenches load again in the desktop app, where 0.2.19 failed every one with `TS2688`.
- **Fixes**: Deleting a large agent moves its folder aside at once and removes the files in the background. Connecting TokenDance from the Models page redirects back to the address the browser is on. The Cost Center counts a metered request once after an abnormal finish. A failed plugin install names npm's own error, not a warning npm printed first. Tooltips wrap a long path inside the panel.

## Upgrading

Coming from 0.2.17:

- **Windows desktop app of 0.2.16 or earlier.** Install this release by hand once from [penguin.ooo/download](https://penguin.ooo/download). The updater of 0.2.16 and earlier refuses installers signed with the new certificate.
- **Data root.** Nothing to do. At its first start, the server moves Projects to `<root>/projects/<project_id>/` once and leaves a link at each old place. A Project named `projects` keeps the server from starting: start the previous version, move its agents to another Project, delete it, and start again. On Windows the move takes every Project folder or none; if the start reports a program holding one open, close it.
- **Remote machines.** A machine must run the server's version. Update each from the **Machines** page. A machine still on the old layout that refuses a hot update needs its server restarted, which ends its terminals and commands, and then an update.
- **Existing agents.** Run **Update kernel** on the **Agents** page for the go-ahead rule, the memory Scripts paragraph and the refined default system prompt. Take the plugin updates offered there, such as `use-bento-slides`, `agent-development`, `goal` and `penguin-support`, and install Plan mode from the **Plugins** tab of **Agent settings**.
- **An agent named `system_agent`.** Export it, import it under another id, and delete the old one. Until then the Project gets no system agent.
- **New Projects and scripts.** A new Project has no default model. A script that creates a Project and then a Session, schedule or organization must name a model, or first run `penguin config model default --provider <group> --model-id <id>`.
- **HTTP API and SDK callers.** The agent `export` and `import` routes are replaced by `GET …/agents/:agentId/archive` and `POST …/agents/import`. Deleting an organization answers `200` with a report. A memory export is a zip. `@prismshadow/penguin-core/a2ui` moved to `@prismshadow/a2ui`, and an approval callback that ignores `context.reason` now lets a factory-rule hit through under allow-all. [The 0.2.19 changelog](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.19) lists every change.
- **Plugin authors.** A plugin package must be built so it carries `ifaces.json` (`penguin-gen-ifaces`). The `penguin` block in `package.json` is no longer read.
- **Hand-off notes in an open conversation.** A compaction that falls back to its hand-off note without a model switch shows its **Hand-off note** section after a reload. A model switch's hand-over shows at once.

Installers are available at [penguin.ooo/download](https://penguin.ooo/download). Full details are in the changelogs for [0.2.18](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.18), [0.2.19](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.19) and [0.2.20](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.20).

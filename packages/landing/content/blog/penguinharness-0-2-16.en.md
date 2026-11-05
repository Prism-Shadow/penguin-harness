---
title: "PenguinHarness 0.2.16: Agent Workbench, built-in support and Gemini 4 Argon"
date: 2026-10-14
category: news
excerpt: "Create an Agent and its application from one request, manage workbenches as plugins, and ask product questions in the built-in support center. Gemini 4 Argon and GPT-6 Luna join the model catalog."
---

PenguinHarness 0.2.16 makes Agent Workbench the home for an Agent's applications. The three home-page examples create a dedicated Agent with its own workbench tab. The default Project also comes with a PenguinHarness support Agent. This release adds Gemini 4 Argon and GPT-6 Luna, updates the model presets, and lets you choose a local background image.

## Agent Workbench

Describe the application you want in one request. PenguinHarness uses its plugins to create an Agent and a workbench for it. Open that Agent, start a new chat, then choose the workbench tab to use the application. Switching home-page examples replaces the selected Skills instead of accumulating them.

Workbenches are plugin content alongside Skills and hooks. In **Agents** → Agent settings → **Workbenches**, open, reload, restore a version or remove a workbench. The compact Agent picker shows Skill and Workbench counts and supports search and keyboard selection.

![Workbenches managed from Agent settings](/blog-assets/penguinharness-0-2-16-workbench-settings-en.jpg)

Exiting full-app mode returns to the same workbench. Conversations created by workbenches carry the `workbench` source and are automatically archived, so the application manages its questions without filling the main chat list.

## A built-in PenguinHarness support center

The default Project initializes a support Agent with the `penguin-support` plugin. It answers questions using the official documentation and repository, with inline numbered source links such as [1].

The workbench opens as a centered question list. Open a question for its conversation details, or choose **New question** and enter just the question. Question titles follow the Session title. While an answer runs, the dialog shows elapsed time and an approximate two-minute countdown. You can search questions, follow up and mark them resolved. Question state survives reloads and plugin updates.

![The built-in PenguinHarness support workbench](/blog-assets/penguinharness-0-2-16-support-en.jpg)

The workbench-building Skill now asks generated applications to separate lists from details, make dialogs dismissible, show progress and verify two separate conversations in a browser.

## Gemini 4 Argon and refreshed model presets

Gemini 4 Argon is available in Google, Penguin Go and OpenRouter. GPT-6 Luna joins OpenAI, OpenRouter and OpenCode Go. OpenCode Go also gains current presets, including Claude Haiku 5.5, Gemini 4 Argon Contributor and Grok 4.7.

![Gemini 4 Argon in the model library](/blog-assets/penguinharness-0-2-16-models-en.jpg)

Choose **Add new models** in the model library to bring the new presets into an existing Project. This keeps saved models, credentials and the default model. **Restore defaults** instead resets the configuration to current presets, keeping API keys.

Price sorting now weights 85% cached input, 10% uncached input and 5% output, including active promotions and off-peak rates. Penguin Go balances can be pinned to the sidebar.

## Also in this release

- **Local backgrounds:** Settings → Appearance accepts PNG, JPEG or WebP images up to 20 MB, with transparency, layout and alignment controls. Images are processed locally and never uploaded.
- **Browser isolation:** each Session keeps its own tabs, while sign-ins and site storage are shared within a Project and isolated between Projects. Media keeps playing when you move elsewhere in the app.
- **Agent API settings:** choose the model, thinking level, workspace and concurrency limit for new API Sessions. The default concurrency limit is 4.
- **Reliability fixes:** Google's official Gemini endpoint works with the server's proxy settings, memory-update cards load in long conversations, and remote-machine installation works from desktop and packaged servers.

## Upgrading

- **Workflow becomes Workbench.** Existing directories and version history migrate once on access. Original files remain in the Agent's `.workbench-migration/backup/`. External integrations must switch to `/workbenches` routes and `workbench_updated` / `workbench_removed` events; old route aliases are not retained. Workbench IDs and full-page links stay the same.
- **Update installed plugins** to receive the revised application-building and support Skills. The default Project provisions the support Agent without overwriting existing Agent files.
- **Update the desktop shell** for Project-isolated browser storage, then sign in again or import cookies separately in each Project. Existing global browser storage is retained but is not copied into the new profiles.
- **Agent SDK callers:** replace streaming `client.run(...)` with `client.stream(...)`, and `client.ask(...)` with `await client.run(...)`.
- **Benchmark imports:** `penguin benchmark import` is removed. Copy `benchmark_config.toml` and `CASE-*` folders into the Project's `benchmarks/<id>/`, then create `scoreboard.yaml` with `evaluations: []`; the updated `benchmark-design` Skill describes the layout.
- **Source development:** restart the dev command to apply the Workbench reload fix.

Installers are available at [penguin.ooo/download](https://penguin.ooo/download). Full details are in [the 0.2.16 changelog](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.16).

---
title: "Give every agent its own hot-reloaded workbench"
date: 2026-10-13
category: practice
excerpt: "In PenguinHarness every agent can have a workbench of its own: a custom page with server code behind it, built from one sentence and reloaded live as the agent edits it. This tutorial builds a legal agent's contract desk, changes it by asking, and restores an earlier version."
---

A workbench is a custom AI app that belongs to one agent: a page beside its chat with server code behind it, kept in the agent's own folder as a *workflow*. The agent builds it from what you ask and changes it the same way. Each change is type-checked and hot-reloaded into the open tab, and every version that loaded is kept, so any edit can be undone.

Because the workbench belongs to the agent, every agent can have a different one: a legal agent a contract desk, a data agent a dashboard, a support agent a ticket queue. [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) also lets plugins add panels to its Web UI, but those are client plugins a developer writes for the whole application. Here the agent writes its own workbench, and nothing else in the app changes.

In this tutorial you start from the legal agent example on the start page: one message creates a legal agent and gives it a desk for uploading contracts and downloading review reports. Then you change the desk by asking, and restore the version before the change.

## Prerequisites

- PenguinHarness 0.2.14, in the desktop app or the Web App.
- A model configured on the **Models** page.
- The `agent-initialization`, `penguin-plugin` and `web-design` Skills on the agent you start from. A new Project's default agent has all three.

## Step 1: Start from the example

1. Select **New chat**.
2. Under **Examples and shortcuts**, open **Build an AI app from one sentence** and select **A legal agent app from one sentence**.
3. The prompt fills the message box, with the three Skills selected above it. Nothing goes out until you select Send, so edit the prompt if you want a different page.

![The message box filled by the legal agent example, with agent-initialization, penguin-plugin and web-design selected](/blog-assets/workflow-example-en.png)

## Step 2: Let the agent build it

1. Send the message.
2. The agent creates the legal agent, writes its role into `AGENTS.md`, and writes the workflow into the new agent's folder: `package.json`, `index.ts` and `ui/index.html`.
3. It finishes by reading `.build/status.json`, the file where the server reports whether the workflow loaded. The server starts watching a new agent's workflows once that agent's chat page has been opened, so if the file is not there yet, do Step 3 and ask the agent to check again.

![The build conversation: the agent creates legal_agent, writes AGENTS.md and the three workflow files, then reads the load status](/blog-assets/workflow-build-en.png)

## Step 3: Open the agent's page

1. Select **New chat** and pick the new legal agent in the agent menu below the message box.
2. A tab strip appears above the chat: **Chat**, then the workflow's tab. Select the workflow's tab.

The bar above the page shows the workflow's name, version and revision, with **Fill the app**, **Reload**, **History** and **Remove**. The page takes every colour from the theme variables the app passes in, so it follows light and dark mode.

![The legal agent's Contract desk tab: an upload area and a file list with each file's status and report download](/blog-assets/workflow-page-en.png)

## Step 4: Change it by asking

1. Select **Chat** and ask for the change. This tutorial asks: "On the desk, show each contract's overall risk next to its status, and put the riskiest contracts at the top."
2. The agent edits the files under `ui/` and reads `.build/status.json` again to confirm the edit loaded.

![The agent reads ui/index.html, edits it twice, then checks the reload](/blog-assets/workflow-edit-en.png)

3. Select the workflow's tab. It already shows the new version: an open tab refreshes by itself when the workflow's pages change.

![The desk after the edit, with a Risk column and the riskiest contracts first](/blog-assets/workflow-page-after-en.png)

## Step 5: Restore an earlier version

1. Select **History**. Each version that loaded is listed with its revision, time and file count; the one serving is marked **current**.
2. Select **Restore** on an older version and confirm. Its files replace the current ones and the workflow reloads. The workflow's data in `state.json` stays as it is.

![History open above the page: the current version and the one before it, with Restore](/blog-assets/workflow-history-en.png)

You can also ask the agent to undo its last change. The `penguin-plugin` Skill has the agent copy the recorded version back from `workflows-history/`.

## Step 6: Show the page as the whole app

1. Select **Fill the app**. The page opens on its own, with no sidebar, chat or tab strip.
2. To leave, open the command palette (⌥⌘P on macOS, Ctrl+Alt+P elsewhere, by default) and select **Exit full page (back to chat)**.

`penguin web --app <project>/<agent>/<workflow>` starts the server and opens the browser straight onto that page.

![The desk shown as the whole app](/blog-assets/workflow-fill-app-en.png)

## Where the files live

Everything about a workflow is files in its agent's folder, under the data root (`~/.penguin/data` by default):

```
<project>/agents/<agent>/
  workflows/<id>/
    package.json   the manifest, including the tabs it adds
    index.ts       the server code: a request handler, in TypeScript
    ui/            the pages
    state.json     the workflow's own data, kept across reloads and restores
    .harness/      written by the server: the types the workflow was written against
    .build/        written by the server: compiled code and status.json
  workflows-history/<id>/<revision>/   a copy of the files of each recorded version
```

## Limits

- The server code must be TypeScript in `index.ts`. The server type-checks it under its own `strict` settings and ignores a `tsconfig.json`; a folder with `index.js` or `index.mjs` instead is refused.
- An edit that fails to load leaves the previous version serving. The tab shows **Load error** with the reason (file, line and message for a type error), and `.build/status.json` holds the same reason for the agent.
- Up to 20 versions are kept per workflow, and only versions that loaded are recorded.
- `state.json` has no history. Restoring a version leaves it unchanged, and nothing brings back data that was overwritten. **Remove** deletes the workflow and all its recorded versions.
- The server starts watching an agent's workflows once that agent's chat page has been opened. If an agent writes its first workflow and `.build/status.json` never appears, open that agent's chat page once.

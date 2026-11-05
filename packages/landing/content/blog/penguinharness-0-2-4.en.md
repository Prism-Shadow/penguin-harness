---
title: "PenguinHarness 0.2.4: a DeepSeek vision model, dockable panels, and a rebuilt cost center"
date: 2026-08-21
category: news
excerpt: DeepSeek gains a vision model and moves to the Responses protocol. The chat page's panels and terminals are now tabs in two docks, long commands run in the background, and the cost center is rebuilt around a single time range.
---

PenguinHarness 0.2.4 is out. It adds a DeepSeek model that reads images, turns the chat page's side panels and terminals into tabs in two docks you arrange, moves long-running commands to the background, and rebuilds the cost center around a single time range. Five changes need a decision from you when you upgrade; they are listed under Upgrading at the end of this post.

## DeepSeek gains a vision model

AgentHub 0.4.6 brings `deepseek-v4-flash-vision-exp` into the catalog. It adds image input on top of V4 Flash's text capabilities, keeps the 1M context window, and bills at V4 Flash's own price.

![The DeepSeek model group, with the Vision badge on deepseek-v4-flash-vision-exp](/blog-assets/penguinharness-0-2-4-deepseek-vision-model-en.png)

It is the only vision-capable model in the DeepSeek group, and that changes how a Session handles an image. A text-only model routes pictures through the `vision_model` proxy, which describes each one with `describe_image` and hands the agent a paragraph of text. A Session running the vision model reads the image itself, with no proxy and no description in between.

The model is also on OpenRouter at that gateway's published rates. Both rows record DeepSeek's off-peak tier, the same convention the existing rows follow. Usage between 9:00–12:00 and 14:00–18:00 Beijing time bills at exactly double, and the cost center applies one rate, so it under-counts peak usage by half.

The same release moves the first-party DeepSeek client from Chat Completions to the OpenAI Responses API, and the base URL hint in the model dialog now shows it.

![The model dialog's base URL field, its protocol hint reading /responses](/blog-assets/penguinharness-0-2-4-model-protocol-hint-en.png)

This is a breaking change if a `deepseek-v4*` entry points at anything other than DeepSeek's own endpoint. See Upgrading at the end of this post for what to do.

Elsewhere in the catalog:

- `claude-opus-5` joined the direct Anthropic group.
- The add-group dialog can import an endpoint's whole model listing, so you no longer type ids one at a time.
- A model whose key comes from an environment variable now counts as configured. It no longer hides behind the **Show models without a key** filter, and the credential guide stops flagging it.

## Side panels and terminals are now dock tabs

The chat page's drawer-style side panels and its separate terminal pane system are gone. Every side element is now a closable tab in one of two docks, one on the right and one along the bottom. That covers the subagents panel, the Workspace files panel, Memory, the new Trace panel and any number of terminals.

![The chat page with the right dock showing Agents, Memory and Workspace tabs, and a terminal in the bottom dock](/blog-assets/penguinharness-0-2-4-dock-tabs-en.png)

Any tab can go in either dock. Drag tabs where the task needs them, and the arrangement stays with the conversation.

Terminals are real server-side shells, and they live in the same tab strip as everything else.

![A live terminal in the bottom dock, showing git log output](/blog-assets/penguinharness-0-2-4-dock-terminal-en.png)

## Long commands no longer block the conversation

A command that takes minutes no longer holds up the turn. It goes to the background and the agent carries on. When the command finishes, the harness injects a completion report, so the model learns the outcome without polling for it. The agent has kill tools to stop a background command, and a process that opens a port gets a link straight to it.

![A background process row, with its command, pid, a localhost link and a Stop control](/blog-assets/penguinharness-0-2-4-background-process-en.png)

## A command policy for shell commands

Each Project now has a sandbox command policy: regex rules that refuse a shell command before it runs. The rules are checked at both shell entry points and apply whatever the approval mode would otherwise allow. New and existing Projects start with a small default set that refuses destructive commands such as `rm -rf`, even in allow-all mode. You can edit or disable a rule, or the whole policy, under **Project settings** › **Security policy**.

The policy is a guardrail against accidents, not a security boundary. A command assembled at run time can still slip past a pattern.

## The cost center is built around one time range

The usage page used to be four widgets answering four different questions over four different windows. Every chart on it now draws over one time axis.

![The cost center: range preset, and the Token chart with its cache hit rate line](/blog-assets/penguinharness-0-2-4-usage-range-en.png)

You pick a range: the trailing hour or 24 hours, the last 7, 30 or 90 calendar days, or a custom pair of dates. The range alone decides the precision, which is per minute, hourly, daily, weekly or monthly. There is no second control to keep in step with the first.

Two charts, side by side, replace the share pie and the per-model progress bars. One breaks usage down by agent and the other by model. In each chart, a bucket's requests are a stacked bar against the left axis, and each entity's success rate is a dashed line in the same hue against the percentage axis on the right.

![Requests and success rate, by agent and by model, side by side with legends](/blog-assets/penguinharness-0-2-4-usage-agent-model-en.png)

Both breakdowns are on screen at once. There is no dimension toggle to flip, and neither chart opens on an aggregate total that tells you nothing. The top four entities are named, each with its own colorblind-checked hue, and the rest fold into a neutral series whose label says how many it holds. Hovering a bar segment, a rate line or a legend item singles that entity out and fades the others.

The Token chart keeps its three-segment bars and gains the cache hit rate as a dashed line on its own percentage axis. That line is usually the fastest way to see why a day cost what it did.

## Also in this release

- **Memory** changes now show as a list below the file summary, and Memory has its own side panel beside the others. Memory groups export and import whole. The memory prompt now says when a fact is worth saving: a request repeated, a correction that outlives the Task, a habit stated more than once. When the agent cannot tell, it asks.
- **Settings** were consolidated into one **System settings** dialog. Explanations moved behind a circled "?" instead of sitting on screen on every visit, and required fields got one consistent marker.
- **The new-chat screen** gained a rhythm-game example, a conversational investment Copilot and a folder of scheduled-task examples. Clicking an example now fills the composer instead of sending it, so you can read and edit it first. You can also save your own prompts as shortcuts. They are stored per user on the server, so they follow you to another machine.
- **MCP Servers** take per-server permission settings.
- **Desktop** installers are built from bundles rather than an assembled dependency tree. Launching from the GUI imports the login shell's environment, terminals ship their native module again, and the client updates from the account menu.

## Upgrading

Five changes in this release need a decision from you, not just an update.

- **DeepSeek on the Responses protocol.** An entry whose id contains `deepseek-v4` and that carries no `client_type` is routed by its id to the DeepSeek client, which now posts to `{base_url}/responses`. Entries aimed at `https://api.deepseek.com` are fine, because DeepSeek serves both protocols. An entry aimed at an endpoint that serves only Chat Completions, such as a self-hosted server, a relay or a third-party DeepSeek-compatible gateway, starts failing after the upgrade. Set `client_type = "openai-chat"` on it, in `.project_config.toml` or with the protocol selector on the models page.
- **New catalog rows are not automatic.** Presets are copied into `.project_config.toml` when a Project is created, and nothing rewrites them afterwards. Click **Sync presets** on the models page to pick up the new models. It appends missing rows and updates catalog-owned fields, and it never touches your stored default model.
- **`GET /usage` changed shape.** `trend`, `byAgent` and `success` are gone, replaced by `series`, `byAgentSeries` and `byModelSeries`. The per-status failure breakdown that `success` carried has no replacement.
- **Saved terminal dock arrangements are not carried over.** The docks start closed once. Running shells are still reachable from any dock's "+" menu.
- **The `agent-creation` Skill is now `agent-initialization`.** The new name says what it does: it initializes an agent's settings rather than creating an agent. An already-installed copy keeps working but no longer matches a library Skill, so it will not be updated again. Install `agent-initialization`, delete `agent-creation` from the agent's **Skills** tab, and update anything that pins the old name by hand. A stale pin resolves to nothing instead of failing loudly.

Full detail for every change is in [`changelog/0.2.4/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.4).

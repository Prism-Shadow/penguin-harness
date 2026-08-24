---
title: "PenguinHarness 0.2.4: a DeepSeek vision model, a more flexible workspace, and a clearer cost center"
date: 2026-08-21
category: news
excerpt: DeepSeek gained a vision model and moved onto the Responses protocol. The chat page's side panels and terminals became tabs in two docks you arrange yourself. Long-running commands go to the background and report back when they finish. And the cost center was rebuilt around one time axis, so every chart on the page answers the same question about the same window.
---

PenguinHarness 0.2.4 is out. Three things carry this release: a DeepSeek model that reads images, a workspace whose panels you arrange instead of putting up with, and a cost center that finally reads as one page rather than four unrelated widgets.

## A DeepSeek model that can see

AgentHub 0.4.6 brings `deepseek-v4-flash-vision-exp` into the catalog. It adds image input on top of V4 Flash's text capabilities, keeps the 1M context window, and bills at V4 Flash's own price.

![The DeepSeek model group, with the Vision badge on deepseek-v4-flash-vision-exp](/blog-assets/penguinharness-0-2-4-deepseek-vision-model-en.png)

It is the only vision-capable model in that group, and that changes how a session handles an image. A text-only model routes pictures through the `vision_model` proxy, which describes them with `describe_image` and hands the agent a paragraph of text. A session running the vision model reads the image itself — no proxy, no description in between.

The model is also on OpenRouter at that gateway's published rates. Both rows record DeepSeek's **off-peak** tier, the same convention the existing rows follow: Beijing 9:00–12:00 and 14:00–18:00 bill exactly double, and the cost center uses one rate, so peak usage is under-counted by half.

The same release moves the first-party DeepSeek client from Chat Completions to the OpenAI Responses API, which the base-URL hint now reflects.

![The model dialog's base URL field, its protocol hint reading /responses](/blog-assets/penguinharness-0-2-4-model-protocol-hint-en.png)

That is a breaking change if you point a `deepseek-v4*` entry at something other than DeepSeek's own endpoint — see [Upgrading](#upgrading) below.

Elsewhere in the catalog: `claude-opus-5` joined the direct Anthropic group, the add-group dialog can import an endpoint's whole model listing instead of making you type ids one at a time, and a model whose key comes from an environment variable is finally counted as configured — it no longer hides behind the "show models without key" filter, and the credential guide stops nagging about it.

## The workspace is something you arrange

The chat page used to have drawer-style side panels and a separate terminal pane system, each with its own rules. Both are gone. Every side element — the subagents panel, the Workspace files panel, Memory, the new Trace panel, and any number of terminals — is now a closable tab in one of two docks, one on the right and one along the bottom.

![The chat page with the right dock showing Agents, Memory and Workspace tabs, and a terminal in the bottom dock](/blog-assets/penguinharness-0-2-4-dock-tabs-en.png)

Anything can go in either dock. Drag a tab across, split your attention how the task actually needs it, and the arrangement stays with the conversation.

Terminals are real server-side shells, and they live in the same tab strip as everything else.

![A live terminal in the bottom dock, showing git log output](/blog-assets/penguinharness-0-2-4-dock-terminal-en.png)

## Long commands stop blocking the conversation

A command that takes minutes no longer holds the turn. It goes to the background, the agent carries on, and the harness injects a completion report when it finishes — so the model learns the outcome without polling for it. There are kill tools for stopping one, and a process that opens a port gets a link straight to it.

![A background process row, with its command, pid, a localhost link and a Stop control](/blog-assets/penguinharness-0-2-4-background-process-en.png)

Alongside it, a Project-level **sandbox command policy**: regex rules that refuse a shell command before it runs, checked against both shell entry points, and applied whatever the approval mode would otherwise allow. It is a guardrail against accidents rather than a security boundary — a command assembled at run time can still slip past a pattern.

## The cost center reads as one page

The usage page was four widgets answering four different questions over four different windows. It is now one time axis that every chart draws over.

![The cost center: range preset, and the Token chart with its cache hit rate line](/blog-assets/penguinharness-0-2-4-usage-range-en.png)

You pick a range — trailing last hour or last 24 hours, calendar 7 / 30 / 90 days, or a custom pair of dates — and the range alone decides the precision: per minute, hourly, daily, weekly or monthly. There is no second control to keep in step with the first.

The share pie and the per-model progress bars are replaced by two charts, side by side, one broken down by Agent and one by Model. Each bucket's requests are a stacked bar against the left axis; each entity's success rate is a dashed line against the right-hand percentage axis, in the same hue.

![Requests and success rate, by agent and by model, side by side with legends](/blog-assets/penguinharness-0-2-4-usage-agent-model-en.png)

Both breakdowns are on screen at once — no dimension toggle to flip, and neither chart opens on an aggregate total that tells you nothing. The top four entities are named with one colorblind-checked hue each, and the rest fold into a neutral series whose label says how many it folded. Hovering a bar segment, a rate line or a legend item singles that entity out and fades the others.

The Token chart keeps its three-segment bars and gains the cache hit rate as a dashed line on its own percentage axis, which is usually the fastest way to see why a day cost what it did.

## Also in this release

- **Memory** gained a change list under each file summary with a peer side panel, groups that export and import whole, and a prompt that now says *when* a fact is worth saving — a request repeated, a correction that outlives the task, a habit stated more than once — and to ask when it cannot tell.
- **Settings** were consolidated into one System settings dialog, explanations moved behind a circled "?" instead of sitting on screen every visit, and required fields got one consistent marker.
- **The new-chat screen** gained a rhythm-game example, a conversational investment Copilot, and a folder of scheduled-task examples. Clicking an example now fills the composer instead of sending it, so you read and edit before it goes out — and you can save your own prompts as shortcuts, stored per user on the server so they follow you to another machine.
- **MCP Servers** take per-server permission settings.
- **Desktop** installers are built from bundles rather than an assembled dependency tree, GUI launches import the login shell's environment, terminals ship their native module again, and the client updates from the account menu.

## Upgrading

Five changes in this release need a decision from you rather than just an update.

**DeepSeek on the Responses protocol.** An entry whose id contains `deepseek-v4` and which carries no `client_type` is routed by its id to the DeepSeek client, which now posts to `{base_url}/responses`. Entries aimed at `https://api.deepseek.com` are fine — DeepSeek serves both protocols. An entry aimed at an endpoint that serves Chat Completions only — a self-hosted server, a relay, a third-party DeepSeek-compatible gateway — starts failing after the upgrade. Set `client_type = "openai-chat"` on it, in `.project_config.toml` or through the models page's protocol selector.

**New catalog rows are not automatic.** Presets are copied into `.project_config.toml` when a Project is created, and nothing rewrites them afterwards. Use **sync presets** on the models page to pick up the new models; it appends and updates catalog-owned fields and never touches your stored default.

**`GET /usage` changed shape.** `trend`, `byAgent` and `success` are gone, replaced by `series`, `byAgentSeries` and `byModelSeries`. The per-status failure breakdown `success` carried has no replacement.

**Saved terminal dock arrangements are not carried over.** The docks start closed once; running shells are still reachable from any dock's "+" menu.

**The `agent-creation` skill is now `agent-initialization`.** The name says what it does — it initializes an Agent's settings rather than creating an Agent. An already-installed copy keeps working but no longer matches a library skill, so it will not be updated again. Install `agent-initialization`, delete `agent-creation` from the Agent's Skills tab, and update anything that pins the old name by hand: a stale pin resolves to nothing rather than failing loudly.

Full detail for every change is in [`changelog/0.2.4/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.4).

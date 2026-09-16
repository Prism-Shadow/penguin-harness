---
title: "PenguinHarness 0.2.6: two Flash models, a TokenDance gateway, and subagents you can steer"
date: 2026-08-27
category: news
excerpt: "GLM-5.3 Flash and Qwen 3.8 Flash joined the built-in catalog, and a new TokenDance gateway group can obtain its API key for you. Subagents can be steered mid-run, the `penguin` CLI works through the server, and a Session can be answered from Feishu or Telegram."
---

PenguinHarness 0.2.6 is out. The model catalog gains two low-cost Flash models and a TokenDance gateway group whose **Authorize key** action mints a key for you. An agent's reach also grows in three directions: you and the model can steer a subagent mid-run, the `penguin` CLI works through the server so an agent can drive the harness it runs in, and a Session can be answered from Feishu or Telegram. Five changes need a decision from you when you upgrade; they are listed under Upgrading at the end of this post.

## Two Flash models in the catalog

The built-in catalog now includes `glm-5.3-flash` and `qwen3.8-flash`. Both have a million-token context window, both read images, and both cost roughly an order of magnitude less than their non-Flash siblings.

GLM-5.3 Flash appears three times, once for each route that sells it: Z.AI directly, OpenRouter, and the new TokenDance group. Each row carries that route's own prices.

![GLM-5.3 Flash listed under OpenRouter, TokenDance and Z.AI (GLM), each with a Vision badge and its own three prices](/blog-assets/penguinharness-0-2-5-glm-flash-rows-en.png)

The three prices differ for two reasons, and one of them is a convention worth knowing. TokenDance simply charges its own rate. Z.AI, however, is running a 50% promotion on this model through 2026-09-09, and the Z.AI row and the OpenRouter row treat it differently on purpose:

- A direct-vendor row records the vendor's list price, so the Z.AI row reads $0.03 / $0.15 / $0.50 per million tokens.
- The OpenRouter row records what OpenRouter actually bills, so it reads half that.

Until the promotion ends, the direct row overstates what Z.AI charges you by a factor of two.

The Vision badge on the direct row is newer than it looks. AgentHub 0.4.8 taught the GLM client to forward `image_url` parts, in a prompt and in a tool result alike, and it does so for `glm-5.3-flash` only. Every other GLM model answers an image with `"GLM <id> does not support image inputs."` instead of quietly dropping it, which is why the rest of that group is still marked as having no vision.

Qwen 3.8 Flash sits in the Qwen Pay-As-You-Go group, with a million-token input window, a 131K output cap and image input.

![Qwen 3.8 Flash and Qwen 3.8 Max side by side in the Qwen Pay-As-You-Go group](/blog-assets/penguinharness-0-2-5-qwen-flash-row-en.png)

## A TokenDance gateway, with a key you do not have to copy

TokenDance is now a provider group of its own, with seven presets that reach `https://tokendance.space/gateway/v1` over Chat Completions.

![The TokenDance group: seven presets under a header carrying Add model, Authorize key, Set key, Speed test and Manage keys](/blog-assets/penguinharness-0-2-5-tokendance-group-en.png)

**Authorize key** saves you the usual first-run errand. It opens TokenDance's own authorization page, mints a key on your account there, and writes it into every model in the group, so you no longer start with a trip to a console and a copy-paste. Where a redirect cannot reach you, such as in the desktop app or an unusual deployment, a manual mode shows a one-time code to paste instead.

The key exchange stays on the server. The PKCE verifier is generated there and never sent to a browser, and the minted key goes straight into the group's models without passing through one either. The key appears in no response, log line, URL or error message.

Unlike OpenRouter, this group records official list prices, the same convention the two Qwen groups follow. Two of its rows are on live promotions: `glm-5.3-flash` at 50% off and `qwen3.8-max` at 20% off. For those two models, the catalog currently shows a higher price than TokenDance bills. Both promotions are tagged in TokenDance's public catalog API, which needs no credential, so you can check whether a promotion is still running instead of guessing.

Model requests now also identify PenguinHarness to gateways that read an app-attribution header: `HTTP-Referer` and `X-OpenRouter-Title` for OpenRouter, and `X-App-URL` for TokenDance. The header is chosen by the endpoint's host, not by the provider group, so a model in the Custom group that points at one of those gateways is attributed the same way.

None of this reaches an existing Project on its own. Presets are copied into `.project_config.toml` when a Project is created, and nothing rewrites them afterwards. **Sync presets** on the models page is the only way in. It appends what is missing and updates catalog-owned fields on what is already there. It deletes nothing, and it does not touch your stored default model or any credential.

## Subagents you can talk to

A subagent used to be something you launched and then watched. `input_subagent` refused a prompt while the child was still running, the panel offered no way to correct or stop a child, and stopping the main agent left its children running. All of that is gone. In its place is one mechanism, available to both the model and you: the steering channel you already had into the main Session, now pointed at the child Session.

![The subagents panel: the call graph above, the child conversation below with a steering message and the child's follow-up reply, and the child's own composer at the bottom](/blog-assets/penguinharness-0-2-5-subagent-steering-en.png)

For the model, `input_subagent` changed in four ways:

- A prompt sent to a running child is injected as a steering message at the child's next step.
- A new `abort` argument stops only the child's current run, and the Session stays available for follow-ups. Combining `abort` with a prompt interrupts and redirects the child in one call.
- The output is now the child's most recent complete reply. Repeated calls return that same reply until the child completes a newer one, instead of only what is new since the last call.
- A released `subagent_id` comes back to life automatically when the model messages it again.

For you, the selected child is driven by the same composer as the main conversation. It offers text, Skills and slash commands, a per-turn thinking level, the context ring showing the child's own usage, and the approval-mode selector. Whatever state the child is in, your message is user input to it: steering while it runs, a new round while it is idle, and a revival when its Session has already ended. An ended subagent is no longer a dead end.

The last gap was approvals. A background child that hit a tool approval used to be denied automatically, for two reasons: the parent Task's end closed every pending approval, and a child running in the background, with no parent call waiting on it, had nowhere to ask. Now a child's approval with nowhere else to go comes to you as an ordinary approval card. When the parent Task ends, only the main Session's pending approvals are closed, so the child's card stays on screen until you decide.

This comes with a real trade-off. A subagent Session is now always resumable and never destroyed, so killing a subagent no longer exists as a concept. `kill_subagent` is removed, and `kill_command` is folded into `input_command` as `kill: true`. Neither removed name is kept for compatibility: a model that calls one gets an unknown-tool failure. See Upgrading below.

## An agent that can drive the harness

`penguin run` and `penguin chat` used to execute a Task in-process against core, with no server involved and nothing the Web App could see. They are now HTTP/SSE clients: the CLI parses arguments and renders the stream, and the server runs the Task. A conversation started from a terminal shows up in the sidebar, and one started in the browser can be picked up from a terminal.

Everything else in this section builds on that. Beside `run` and `chat` there is now a family of commands for inspecting and operating an install: `ls`, `input`, `logs`, `agent`, `project`, `cost` and `schedule`. Every command an agent runs gets what it needs to use them. `PENGUIN_API_URL`, `PENGUIN_API_TOKEN`, `PENGUIN_PROJECT_ID`, `PENGUIN_AGENT_ID` and `PENGUIN_SESSION_ID` are set in every tool subprocess. Inside a Session, a bare `penguin agent ls` reaches the very server running that Session, with that Project and that agent already the defaults. There is no login step anywhere on that path.

![An agent inside its own conversation running penguin agent create and penguin run --background, then penguin ls showing the session it just started](/blog-assets/penguinharness-0-2-5-orchestration-en.png)

`penguin input` is subagent steering one level out:

- Sent to a running Session, the message is taken in as a course correction at the next step, exactly like a steering message to a subagent.
- Sent to an idle Session, it starts a new turn.
- Without `-m`, it polls instead and prints the Session's most recent complete assistant reply. That is the same snapshot `input_subagent` returns for an empty prompt.
- `--timeout` bounds any wait. When it expires, the command yields softly: it exits with code 0 and prints a line naming the follow-up command, while the Task keeps running on the server.

A Session started from inside an agent inherits the settings of the Session it was started from. For each field you leave unspecified, `run` takes the calling Session's current value: Workspace, the model pair, approval mode and thinking level. This is the same inheritance `run_subagent` applies to children. From inside an agent, `penguin run -m "…"` on its own usually does the right thing, and flags are only for changing something.

Authorization is deliberately simple. At every start, the server mints an API token into `<data-root>/api-token` with mode 0600, and a CLI on the same machine reads it. That token is admin-equivalent, because filesystem access to the data root already amounts to admin authority. A remote `--server` gets no such shortcut: without an explicit `PENGUIN_API_TOKEN`, it is refused.

The recipes ship as a Skill. `penguin-orchestration` joined the library's AI App Development group as part of the preinstalled set, so a new `default_agent` gets it along with the rest of the library, and any other agent can install it from the library. It sets out the conventions: look around with the read-only listings before changing anything, and hand bulk material to a new Session through a Workspace file rather than through `-m`. It also spells out the cautions, which are the real limits:

- A Session runs one active Task at a time, so a message to a busy Session steers it instead of queueing a second Task.
- A spawned Session inherits your approval mode, so an unattended `always-ask` run just hangs, waiting for a person who is not watching.
- An agent that can message agents can build a loop that never ends.
- Everything it starts bills the same Project.

## A Session you can reach from Feishu or Telegram

You no longer have to read a conversation in a browser tab. A Session can be bound to a self-built Feishu app or a Telegram bot. Messages sent to the bot land in that Session as ordinary user input, and the assistant's replies come back into the chat.

![The Messaging panel on Telegram: the channel selector, then the enable switch with its live status and the two probes, and only below them the Bot Token field with its stored-secret mask and clear checkbox](/blog-assets/penguinharness-0-2-5-messaging-en.png)

A Session keeps a saved configuration for each channel. Feishu takes an **App ID**, an **App Secret** and an **API domain**, and Telegram takes a single **Bot Token**. At most one channel is enabled at a time, and the enabled one holds the live connection. Turning on the second is blocked, with the reason on screen, and the server refuses it too.

Neither channel needs a public URL. Feishu delivers inbound events over the SDK's WebSocket long connection. Telegram pushes nothing without a public webhook, so the connector pulls updates with an offset-based `getUpdates` long poll instead. A laptop behind NAT is enough: no tunnel, no webhook endpoint. When the Telegram connector connects, it skips whatever piled up while nothing was listening, rather than replaying that stretch as a flood of Tasks. Feishu behaves the same way, so missed events are simply gone.

Replies arrive as they finish, not in one block at the end. Each assistant message is relayed the moment it completes, so a run that writes working notes between tool calls reaches the chat as the same sequence of messages. Messages from one Session arrive in the order they completed, split to fit each channel's text limit; Telegram's 4096-character cap is the tightest. In a group chat, a run's first message replies to the message that triggered it, and everything after that, including the rest of a split message, is sent plainly, so a long answer does not bury the thread in quote blocks.

Credentials work the way they do on the models page. The field always starts empty, a stored secret shows only as a mask, and a **Clear stored App Secret** or **Clear stored Bot Token** checkbox removes it when you save. Clearing is refused while that channel's connection is enabled, so a live connection never outlasts its stored credential. Saving and enabling are separate: **Save** writes credentials, and the switch connects or disconnects with what is stored. The form puts the connection controls, meaning the switch, its live status and the two probes, above the credential fields on purpose: the two channels have different numbers of fields, so controls placed below the fields would sit at a different height in each channel and jump every time you switch channels.

The same form opens from two places: the Session row's menu, and the **Messaging** panel in the conversation's dock, beside the Trace panel. In later versions this panel is called **Remote control**. A Session with a live connection shows a small paper plane on its sidebar row. The mark is the same for every channel, and the tooltip and screen-reader text name the channel.

The model sees nothing special. Inbound text starts a Task as plain composer input, with no marker and no special sender, so the model never learns the message came from a chat app. A pending tool approval sends a one-line notice pointing to the Web App, because a chat message cannot approve anything.

## Also in this release

- **The context ring is now a button.** Clicking it breaks the current context into six parts: system prompt, tool definitions, user messages, model messages, tool requests and tool results. They appear as one bar across the whole context window, with a dashed mark where compaction will fire and a ranking of the five tools that take up the most of it.
- **A red dot leads to the update.** When a software release or an agent kernel update is available, the interface shows a phone-style red dot. Every dot leads along an unbroken path to the control that performs the update, rather than stopping at a notice.
- **Groups stay in the order you set.** You can drag both the chat sidebar's conversation groups and the models page's provider groups into a manual order, stored per Project. The chat model picker follows the models page's order.
- **The sidebar counts by group.** Each group loads its own pages, so its reveal row shows that group's own hidden count, and **Show less** folds it back. The group list itself pages ten groups at a time.
- **The standalone Trace page is gone.** You read a Trace in its conversation's Trace panel. Trace import moved into **System settings** and now asks for a Project and an agent, so an imported Trace becomes a listed conversation instead of hiding behind a filter.
- **Agents are easier to start.** The create dialog installs library Skills and the Skills a chosen project directory already carries. It can also initialize an agent straight from an exported snapshot package, instead of making you create an empty agent and import into it.

## Upgrading

Five changes in this release need a decision from you, not just an update.

- **`kill_subagent` and `kill_command` are gone.** To stop a subagent run, use `input_subagent` with `abort`. To terminate a command, use `input_command` with `kill: true`. Nothing translates the old names: an agent whose stored tool configuration names them simply stops loading those entries, and a model that calls one gets the standard unknown-tool failure. Update anything that pins either name by hand.
- **Editing one field of a settings tab freezes that whole tab.** Kernel updates now apply to a settings tab as a unit rather than to single config values. A tab you have customized is never overwritten. The cost is that an agent with one customized built-in tool stops receiving new built-in tools entirely. **Restore default configuration** on that tab puts it back under kernel updates.
- **An agent's commands no longer inherit the server's `PENGUIN_*` environment.** A command an agent runs no longer receives any of the server's own `PENGUIN_*` variables, nor `PORT` or `HOST`. Of the `PENGUIN_*` family, the harness sets only the five control variables described earlier. A harness that an agent starts therefore uses the default data root rather than that of the install serving it. Outbound proxy variables are the deliberate exception. If a command needs one of these variables, set it in that agent's vault, which is applied after the host environment is stripped.
- **The CLI no longer runs a Task without a server.** `penguin run` and `penguin chat` go through the server API. Where no server is running, they start one locally. Fully offline execution directly against core is no longer a CLI mode; the SDK keeps that capability for embedders. The same rework retired the per-user "show CLI sessions" filter, so every Session is always listed, and Sessions left behind by an older CLI now appear in the sidebar. Nothing on disk needs migrating, and old binaries keep working against their own cores until you update them.
- **New catalog rows are not automatic.** Presets are copied into `.project_config.toml` when a Project is created, and nothing rewrites them. Use **Sync presets** on the models page to pick up GLM-5.3 Flash, Qwen 3.8 Flash and the TokenDance group. A Project older than that group has to sync once before the group, and its **Authorize key** action, appear at all.

Full detail for every change is in [`changelog/0.2.6/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.6).

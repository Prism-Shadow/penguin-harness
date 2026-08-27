---
title: "PenguinHarness 0.2.6: two Flash models, a TokenDance gateway, and subagents you can talk to"
date: 2026-08-27
category: news
excerpt: GLM-5.3 Flash and Qwen 3.8 Flash joined the built-in catalog, and GLM-5.3 Flash is listed three times over — once per route that sells it, at three different prices. A TokenDance gateway group arrived with an authorization flow that mints its own key. And an agent's reach grew three ways: a subagent can be steered mid-run, by the model and by you; the `penguin` CLI became a client of the running server, so an agent can drive the install hosting it; and a Session can be bound to a Feishu app or a Telegram bot and answered from the chat.
---

PenguinHarness 0.2.6 is out. The model catalog gained two low-cost Flash models and a whole new gateway, and an agent's reach grew in three directions: the subagents panel turned from a place you watch a child agent into a place you talk to one, the `penguin` CLI became a client of the running server so an agent can drive the harness hosting it, and a Session can be bound to a Feishu app or a Telegram bot and answered from there.

## Two Flash models, one of them three times over

`glm-5.3-flash` and `qwen3.8-flash` joined the built-in catalog. Both carry a million-token context window, both read images, and both price roughly an order of magnitude under their non-Flash siblings.

GLM-5.3 Flash is in the catalog three times, because three routes sell it — Z.AI directly, OpenRouter, and the new TokenDance group — and each row records what that route charges.

![GLM-5.3 Flash listed under OpenRouter, TokenDance and Z.AI (GLM), each with a Vision badge and its own three prices](/blog-assets/penguinharness-0-2-5-glm-flash-rows-en.png)

The three prices disagree for two different reasons, and one of them is a convention worth knowing. TokenDance simply charges its own rate. But Z.AI is running a 50% promotion on this model through 2026-09-09, and the two rows treat it differently on purpose: a **direct-vendor row records the vendor's list price**, so the Z.AI row reads $0.03 / $0.15 / $0.50 per million tokens, while a **gateway row records what the gateway actually bills**, so the OpenRouter row reads half that. Until the promotion lapses, the direct row over-states what Z.AI charges you by a factor of two.

The Vision badge on the direct row is newer than it looks. AgentHub 0.4.8 taught the GLM client to forward `image_url` parts — in a prompt and in a tool result alike — and it does so for `glm-5.3-flash` and nothing else. Every other GLM id answers an image with `"GLM <id> does not support image inputs."` rather than quietly dropping it, which is why the rest of that group is still marked vision-off.

Qwen 3.8 Flash sits in the Qwen Pay-As-You-Go group, a million-token input window against a 131K output cap, images included.

![Qwen 3.8 Flash and Qwen 3.8 Max side by side in the Qwen Pay-As-You-Go group](/blog-assets/penguinharness-0-2-5-qwen-flash-row-en.png)

## A TokenDance gateway, and a key you do not have to copy

TokenDance is now a provider group of its own, reaching `https://tokendance.space/gateway/v1` over Chat Completions, with seven presets.

![The TokenDance group: seven presets under a header carrying Add model, Authorize key, Set key, Speed test and Manage keys](/blog-assets/penguinharness-0-2-5-tokendance-group-en.png)

**Authorize key** is the part worth pointing at. It sends you to TokenDance's own authorization page, mints a key on your account there, and writes it into every model in the group — so a first run no longer starts with a trip to a console and a copy-paste. The PKCE verifier is generated on the server and never sent to a browser, and the minted key goes straight into the group's models without passing through one either; it appears in no response, log line, URL or error message. Where a redirect cannot reach you — the desktop shell, an odd deployment — a manual mode shows a one-time code to paste instead.

The group's prices are **official list prices**, the same convention the two Qwen groups follow, and two of its rows are on live promotions: `glm-5.3-flash` at 50% off and `qwen3.8-max` at 20% off. So for those two, the catalog currently costs you more than the gateway does. Both promotions are tagged in TokenDance's public catalog API, which needs no credential, so whether one still runs is checkable rather than guessable.

Alongside the group, model requests now name PenguinHarness to the gateways that read an app-attribution header — `HTTP-Referer` and `X-OpenRouter-Title` for OpenRouter, `X-App-URL` for TokenDance. The header is chosen by the endpoint's host, not by the provider group, so a model filed under **custom** that points at one of those gateways is attributed the same way.

None of this reaches a Project you already have on its own. Presets are copied into `.project_config.toml` when a Project is created and nothing rewrites them afterwards; **sync presets** on the models page is the one path. It appends what is missing and updates catalog-owned fields on what is there, deletes nothing, and does not touch your stored default model or any credential.

## Subagents you can talk to

A subagent used to be fire-and-observe. `input_subagent` refused a prompt while the child was still running, the panel offered no way to correct or stop one at all, and stopping the main agent left its children running. All of that is gone, replaced by one mechanism: the steering channel you already have into the main session, pointed at the child session, and reachable by the model and by you.

![The subagents panel: the call graph above, the child conversation below with a steering message and the child's follow-up reply, and the child's own composer at the bottom](/blog-assets/penguinharness-0-2-5-subagent-steering-en.png)

For the model, `input_subagent` gained a lot. A prompt sent to a running child is injected mid-run as a steering message at the child's next step. A new `abort` argument stops the child's current run only — the session survives for follow-ups — and combining `abort` with a prompt interrupts and redirects in one call. Its output is now the child's most recent complete reply, an idempotent snapshot on every access rather than a delta drain. And a released `subagent_id` revives automatically when the model messages it again.

For you, the selected child is driven by the **same composer as the main conversation**: text, skills and slash commands, a per-turn thinking level, the context ring showing the child's own usage, and the approval-mode selector. A message is a user input on the child whatever state it is in — steering while it runs, a new round while it is idle, and a revival when the session had already ended. "This subagent has ended" is no longer a dead end.

The last gap was approvals. A background child that hit a tool approval used to be auto-denied, because the parent task's end converged every pending approval and a child with no active poll window had nowhere to ask. Now a child approval with nowhere else to go escalates to you as an ordinary approval card, and a parent task ending converges only the main session's approvals — the child's card stays rendered until you decide.

One trade-off comes with it, and it is a real one. Since a subagent session is always resumable and never destroyed, the kill notion for subagents is gone: `kill_subagent` is **removed**, and `kill_command` is folded into `input_command` as `kill: true`. No compatibility is kept for the two removed names — a model calling one gets an unknown-tool failure. See [Upgrading](#upgrading).

## An agent that can drive the harness

`penguin run` and `penguin chat` used to execute a Task in-process against core: no server involved, and nothing the Web App could see. They are HTTP/SSE clients now — the CLI parses arguments and renders the stream, the server runs the Task — so a conversation started from a terminal shows up in the sidebar, and one started in the browser can be picked up from a terminal.

That rebuild is what the rest of this rests on. Beside `run` and `chat` there is now a family for reading and moving an install — `ls`, `input`, `logs`, `agent`, `project`, `cost` and `schedule` — and every command an Agent runs is handed the coordinates to use them. `PENGUIN_API_URL`, `PENGUIN_API_TOKEN`, `PENGUIN_PROJECT_ID`, `PENGUIN_AGENT_ID` and `PENGUIN_SESSION_ID` go into every tool subprocess, so from inside a session a bare `penguin agent ls` reaches the very server running that session, with that Project and that Agent already the defaults. There is no login step anywhere on that path.

![An Agent inside its own conversation running penguin agent create and penguin run --background, then penguin ls showing the session it just started](/blog-assets/penguinharness-0-2-5-orchestration-en.png)

`penguin input` is where this meets the section above: the same verb, one level out. Sent at a **running** session it is absorbed as a course correction at the next step, exactly as a steering message is on a subagent; sent at an idle one it starts a new turn. Without `-m` it polls instead, printing that session's most recent complete assistant reply — an idempotent snapshot, the same semantics `input_subagent` has with an empty prompt. `--timeout` bounds any wait and expires as a soft yield: exit 0, a line naming the follow-up command, and the Task still running on the server.

A session an Agent starts inherits the Agent's own. `run` fills each field left unspecified from the calling session's live values — Workspace, the model pair, approval mode, thinking level — field by field, the same inheritance `run_subagent` applies to children. So from inside an Agent, `penguin run -m "…"` on its own usually does the right thing, and flags are for diverging from it.

Authorization is deliberately plain. The server mints an API token at every boot into `<data-root>/api-token`, mode 0600, and a CLI on the same machine reads it; that token is admin-equivalent, on the grounds that filesystem access to the data root already is admin authority. A remote `--server` gets no such shortcut and is refused without an explicit `PENGUIN_API_TOKEN`.

The recipes ship as a Skill. **`penguin-orchestration`** joined the library's AI App Development group, with no preinstall marker, so a newly created Agent picks it up like the rest of the library. It carries the conventions — orient with the read-only listings before mutating anything, hand bulk material to a new session through a Workspace file rather than through `-m` — and the cautions, which are the real edges: one active Task per session, so a message at a busy session steers it rather than queueing a second; a spawned session inherits your approval mode, so an unattended `always-ask` run just hangs waiting for a human who is not watching; an Agent that can message Agents can build a loop that never terminates; and everything it starts bills the same Project.

## A Session you can reach from Feishu or Telegram

A conversation no longer has to be read in a browser tab. A Session can be bound to a self-built Feishu app or a Telegram bot: messages sent to the bot land in that Session as ordinary user input, and the assistant's replies come back into the chat.

![The Messaging panel on Telegram: the channel selector, then the enable switch with its live status and the two probes, and only below them the Bot Token field with its stored-secret mask and clear checkbox](/blog-assets/penguinharness-0-2-5-messaging-en.png)

Both channels sit behind one connector seam, and a Session keeps a saved config for each — Feishu takes an App ID, an App Secret and an API domain, Telegram a single Bot Token — but **at most one of them is enabled**, and the enabled one holds the live connection. Turning the second on is gated with the reason on screen, and refused by the server as well.

Neither channel needs a public URL. Feishu's inbound events arrive over the SDK's WebSocket long connection, Telegram's over an offset-based `getUpdates` long poll — Telegram pushes nothing without a public webhook, so the connector pulls instead. A laptop behind NAT is enough: no tunnel, no webhook endpoint. On connect the poller discards whatever accumulated while nothing was listening rather than replaying a dark period as a flood of Tasks, which is also how Feishu behaves — missed events are simply gone.

Replies arrive as they finish rather than in one block at the end. Each completed assistant message is relayed on its own the moment it completes, so a run that writes working notes between tool calls reaches the chat as that same sequence; the sends of one Session are serialised so they arrive in the order they completed, and chunked under the channels' text limits (Telegram's 4096-character cap is the tightest). In a group chat, the first thing a run sends is threaded onto the message that triggered it and everything after it — including that message's own continuation chunks — is a plain send, so a long answer does not bury the thread in quote blocks.

Credentials follow the models page's interaction: the field always starts empty, a stored secret shows only as its mask, and a "clear stored …" checkbox drops it on save — refused while that channel's connection is enabled, so a live connection can never outrun the credential its store still has. Saving and enabling stay separate concerns, Save writing credentials and the switch connecting or terminating with what is stored. The controls lead the form and the credential fields trail them, which is deliberate: the two channels' field lists differ in length, so controls placed underneath would sit at a different height in each channel and jump on every switch.

One form, two hosts — the session row's menu, and a **Messaging** panel in the conversation's dock beside the Trace panel. A Session holding a live connection carries a small paper plane on its sidebar row, the same mark for every channel, with the channel named in the tooltip and the screen-reader text rather than in the shape. What the model sees is nothing special: inbound text starts a Task as plain composer input, with no marker and no special sender, so it never learns the message came from a chat app. A pending tool approval sends a one-line notice pointing at the web UI, since approving is not something a chat message can do.

## Also in this release

- **The context ring is a button now.** Clicking it breaks the current context into six parts — system prompt, tool definitions, user messages, model messages, tool requests, tool results — as one bar across the whole window, with a dashed mark where compaction will fire and a ranking of the five tools eating the most of it.
- **A red dot leads to the update.** Whenever a software release or an Agent kernel update is available, the chrome carries a phone-style dot, and every dot leads down an unbroken path to the control that performs that update rather than stopping at a notice.
- **Groups go in the order you put them.** Both the chat sidebar's conversation groups and the models page's provider groups can be dragged into a manual order, stored per Project; the chat model picker follows the models page.
- **The sidebar counts by group.** Each group pages its own server stream, so its reveal row names that group's own hidden count and a **Show less** folds it back, and the group list itself paginates ten at a time.
- **The standalone Trace page is gone.** A Trace is read in its conversation's Trace panel, and Trace import moved into System settings with an explicit Project and Agent destination — an imported Trace becomes a listed conversation instead of hiding behind a filter.
- **Agents are easier to start.** The create dialog installs library skills and the skills a chosen project directory already carries, and it can initialize an Agent straight from an exported snapshot package instead of making you create an empty one and import into it.

## Upgrading

Five changes in this release need a decision from you rather than just an update.

**`kill_subagent` and `kill_command` are gone.** Stopping a subagent run is `input_subagent`'s `abort`; terminating a command is `input_command` with `kill: true`. Nothing translates the old names: an Agent whose stored tool configuration names them simply stops assembling those entries, and a model that calls one gets the standard unknown-tool failure. Update anything that pins either name by hand.

**Editing one field of a settings tab freezes that whole tab.** The kernel update's unit is now a settings tab rather than a single config leaf. The upside is that a tab you have customized is never overwritten; the cost is that an Agent with one customized built-in tool stops receiving new built-in tools entirely. "Restore the default configuration" on that tab puts it back under kernel updates.

**An Agent's commands no longer inherit the server's `PENGUIN_*` environment.** No `PENGUIN_*` variable — nor `PORT` or `HOST` — reaches a command an Agent runs, so a harness an Agent starts takes the default data root rather than the serving install's. Outbound proxy variables are the deliberate exception. If a command needs one of those variables, set it in that Agent's vault, which is applied after the host environment is stripped.

**The CLI no longer runs a Task without a server.** `penguin run` and `penguin chat` go through the server API; where none is running they start one locally, and fully offline core-direct execution is no longer a CLI mode — the SDK keeps that capability for embedders. In the same rework the per-user "show CLI sessions" filter was retired and every session is always listed, so Sessions an older CLI left behind now appear in the sidebar on their own. Nothing on disk has to be migrated, and old binaries keep working against their own cores until they are updated.

**New catalog rows are not automatic.** Presets are copied into `.project_config.toml` at Project creation and nothing rewrites them. Use **sync presets** on the models page to pick up GLM-5.3 Flash, Qwen 3.8 Flash and the TokenDance group. A Project older than that group has to sync once before the group — and its **Authorize key** action — appears at all.

Full detail for every change is in [`changelog/0.2.6/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.6).

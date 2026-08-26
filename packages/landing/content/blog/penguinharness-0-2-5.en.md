---
title: "PenguinHarness 0.2.5: two Flash models, a TokenDance gateway, and subagents you can talk to"
date: 2026-08-27
category: news
excerpt: GLM-5.3 Flash and Qwen 3.8 Flash joined the built-in catalog, and GLM-5.3 Flash is listed three times over — once per route that sells it, at three different prices. A TokenDance gateway group arrived with an authorization flow that mints its own key. And a subagent stopped being fire-and-forget: the model can steer one mid-run, and so can you, from a composer inside the panel.
---

PenguinHarness 0.2.5 is out. The model catalog gained two low-cost Flash models and a whole new gateway, and the subagents panel turned from a place you watch a child agent into a place you talk to one.

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

## Also in this release

- **The context ring is a button now.** Clicking it breaks the current context into six parts — system prompt, tool definitions, user messages, model messages, tool requests, tool results — as one bar across the whole window, with a dashed mark where compaction will fire and a ranking of the five tools eating the most of it.
- **A red dot leads to the update.** Whenever a software release or an Agent kernel update is available, the chrome carries a phone-style dot, and every dot leads down an unbroken path to the control that performs that update rather than stopping at a notice.
- **Groups go in the order you put them.** Both the chat sidebar's conversation groups and the models page's provider groups can be dragged into a manual order, stored per Project; the chat model picker follows the models page.
- **The sidebar counts by group.** Each group pages its own server stream, so its reveal row names that group's own hidden count and a **Show less** folds it back, and the group list itself paginates ten at a time.
- **The standalone Trace page is gone.** A Trace is read in its conversation's Trace panel, and Trace import moved into System settings with an explicit Project and Agent destination — an imported Trace becomes a listed conversation instead of hiding behind a filter.
- **Agents are easier to start.** The create dialog installs library skills and the skills a chosen project directory already carries, and it can initialize an Agent straight from an exported snapshot package instead of making you create an empty one and import into it.

## Upgrading

Four changes in this release need a decision from you rather than just an update.

**`kill_subagent` and `kill_command` are gone.** Stopping a subagent run is `input_subagent`'s `abort`; terminating a command is `input_command` with `kill: true`. Nothing translates the old names: an Agent whose stored tool configuration names them simply stops assembling those entries, and a model that calls one gets the standard unknown-tool failure. Update anything that pins either name by hand.

**Editing one field of a settings tab freezes that whole tab.** The kernel update's unit is now a settings tab rather than a single config leaf. The upside is that a tab you have customized is never overwritten; the cost is that an Agent with one customized built-in tool stops receiving new built-in tools entirely. "Restore the default configuration" on that tab puts it back under kernel updates.

**An Agent's commands no longer inherit the server's `PENGUIN_*` environment.** No `PENGUIN_*` variable — nor `PORT` or `HOST` — reaches a command an Agent runs, so a harness an Agent starts takes the default data root rather than the serving install's. Outbound proxy variables are the deliberate exception. If a command needs one of those variables, set it in that Agent's vault, which is applied after the host environment is stripped.

**New catalog rows are not automatic.** Presets are copied into `.project_config.toml` at Project creation and nothing rewrites them. Use **sync presets** on the models page to pick up GLM-5.3 Flash, Qwen 3.8 Flash and the TokenDance group. A Project older than that group has to sync once before the group — and its **Authorize key** action — appears at all.

Full detail for every change is in [`changelog/0.2.5/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.5).

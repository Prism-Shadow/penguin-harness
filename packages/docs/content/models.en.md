---
title: Models & Providers
description: Add models to a Project, set API keys and the default model, and choose thinking levels and fast mode.
---

Each Project has its own model table: the models its conversations can use, grouped by provider, with their credentials, limits, and prices. You manage the table on the **Models** page. An agent is never tied to a model; the model is chosen when a conversation starts.

- To find your way around, see [The Models page](#the-models-page).
- To add models, see [Add a model group](#add-a-model-group), [Add a model](#add-a-model), or [Create a model group with AI](#create-a-model-group-with-ai).
- To give models credentials, see [Set API keys](#set-api-keys).
- To choose which model new conversations use, see [Set the default model](#set-the-default-model).
- To tune requests, see [Thinking levels](#thinking-levels) and [Fast mode](#fast-mode).
- For the full list of built-in providers and the file format, see [Built-in provider groups](#built-in-provider-groups) and [The per-Project model table](#the-per-project-model-table).

## The Models page

In the sidebar, select **Models**. Models are listed in groups, one per provider.

- **Groups.** Built-in groups follow the order in [Built-in provider groups](#built-in-provider-groups). Groups you create follow them, sorted by name. A built-in group with no models is hidden; **Custom** is always shown. The **TokenDance** group carries a **Recommended** tag.
- **Open and close groups.** Select a group's header to open or close it. On your first visit only the TokenDance group is open. The browser remembers which groups you opened, per Project.
- **Reorder groups.** Drag a group's header to move it. The order is saved in this browser, per Project, and the model picker in the chat uses the same order. Dragging is not available on touch screens or while searching.
- **Search.** Type in **Search models: id / name / provider** to show only the matching models. While you search, every matching group is open.

Each model card shows the model's display name, tags, context window, prices, key status, and the Tokens the model has used so far.

| Tag | Meaning |
| --- | --- |
| **Default** | The Project's default model |
| **Vision** | The model accepts images |
| **Proxy vision** | The model reads images for models without vision |
| **Fast** | Fast mode is on |
| **Free** | All three prices are 0 |
| **N% off** | A promotion or an off-peak rate currently applies; see [Prices and promotions](#prices-and-promotions) |

Prices are shown per million Tokens, in the order cache read / cache write / output. The currency is the one chosen under **Currency** in the settings: **USD $** or **CNY ¥**, converted at a fixed rate of 7.

Select a card to open **Model settings**. Links next to a group open the provider's key console (**Manage keys**). The model dialog links to the provider's model list (**Get model IDs**) and to the model's own page (**Model page**).

Only the Project owner can change models and credentials. Members can search, open and close groups, reorder them in their own browser, and open **Model settings** read-only.

## Add a model group

A group you create works like the **Custom** group: its models use one of the generic protocols, and each carries its own base URL.

1. On the **Models** page, select **Create manually**, or select **Add group** (＋) below the last group. The **Add group** dialog opens.
2. In **Group name**, enter a name. The name:
   - starts with a lowercase letter or digit;
   - uses only lowercase letters, digits, `-` and `_`;
   - is at most 32 characters long;
   - cannot match a built-in group or an existing group.
3. Choose **Create only** or **Import models**, then follow the section below for your choice.

### Create an empty group

1. Select **Create only**, then select **Confirm**. The **Add model** dialog opens for the new group.
2. Add the first model; see [Add a model](#add-a-model).

The group appears in the list once its first model is saved.

### Import models from an endpoint

**Import models** fills a new group with every model an OpenAI-compatible or Anthropic-compatible endpoint lists.

1. Select **Import models**.
2. In **API key**, enter the key. Leave it empty to use the protocol's `OPENAI_*` or `ANTHROPIC_*` environment variables.
3. In **Custom base URL**, enter the endpoint's base URL.
4. Select **Detect** at the top-right of the field, or pick the protocol from the menu at the right edge of the field. See [Detect a custom model's protocol](#detect-a-custom-models-protocol).
5. Select **Import all models**. PenguinHarness asks the endpoint for its model list and saves every model into the new group, in the endpoint's order.

Each imported model gets the base URL, the protocol, and the key you entered. Only the model id comes from the endpoint: prices, context window, and display name stay empty, and vision stays off until you detect it or turn it on. That is the same starting point as a model you add by hand.

Some ids are skipped, and the result says how many: "Imported {added} models, skipped {skipped} entries". An id is skipped when it is empty, longer than 200 characters, contains control characters, or is already taken.

If the protocol cannot list models ("This protocol cannot list models — add them manually") or the list is empty, nothing is saved and the dialog stays open. A failed detection only turns the protocol suffix amber; you can still pick the protocol by hand or switch back to **Create only**.

The listing uses `POST /api/projects/:id/models/list` (owner only), which calls AgentHub's `listModels()` on that protocol's client with a 20-second limit.

### Delete a group

1. On the header of a group you created, select **Delete group**.
2. Confirm the deletion.

All of the group's models and their API keys are removed. Built-in groups cannot be deleted.

## Add a model

1. On the group's header, select **Add model**.
2. In **Model ID**, enter the model id exactly as the provider's API expects it, for example `gpt-5.5`. **Get model IDs** opens the provider's model list.
3. Optional: in **Display name**, enter a display name. An empty display name shows the model id.
4. Fill in the credentials and endpoint:
   - **API key**: leave it empty to use the provider's environment variable. The field names the variable when it is set on the server.
   - **Custom base URL**: required in **Custom** and in groups you created. In gateway groups it is filled in for you.
5. Optional: fill in the limits and prices:
   - **Context window**: the model's context window in Tokens. For a model that is not in the built-in catalog, an empty field saves as 1000000.
   - **Max output tokens**: the most output Tokens per request. Leave it empty to use the agent's setting; lower it for models with a small context.
   - **Cache read price**, **Cache write price**, and **Output price**: per million Tokens, in the display currency; they are stored in USD. Fill in all three or none.
6. Optional: turn on **Vision support** if the model accepts images, or select **Detect**; see [Detect vision support](#detect-vision-support). New models in **Custom** and in groups you created start with vision off; models you add to other groups start with it on.
7. Optional: turn on **Fast mode**; see [Fast mode](#fast-mode).
8. Select **Confirm**.

Which protocol a new model uses depends on its group:

- **Vendor groups** (DeepSeek, Google Gemini, OpenAI, Anthropic, Z.AI, Moonshot, MiniMax) support only the vendor's own API. If a model id cannot be routed that way, the dialog warns you and offers **Move to Custom**. Use Custom for OpenAI-compatible endpoints.
- **OpenRouter** always uses `openai-responses`, and **vLLM** always uses `openai-chat-vllm-adapter`.
- **Other gateway groups** use OpenAI Chat Completions.
- **Custom** and groups you created: pick the protocol from the base URL field, or detect it. See [Detect a custom model's protocol](#detect-a-custom-models-protocol).

### Edit or delete a model

Select the model's card to open **Model settings**. Change the fields, select **Confirm**, and confirm the save. From the same dialog you can **Test connection**, **Set as default model**, **Set as proxy vision model**, or **Delete model**.

Changing **Model ID** or **Group** renames the entry; its credential and its default or proxy vision role move with it. **Delete model** removes the model's configuration and API key.

## Create a model group with AI

**Create with AI** covers what an import cannot read: a model listing page that is not an OpenAI-compatible `/models` endpoint, a service described in words, or vendor models to add to an existing group.

> [!TIP]
> For an OpenAI-compatible endpoint that lists its own models, **Import models** in the **Add group** dialog is faster.

1. On the **Models** page, select **Create with AI**. The **Add a model group with AI** dialog opens.
2. Paste the address of a model listing page or describe the service, or pick an example under **Try an example**.
3. Select **Edit in a new conversation**. A new conversation with the Project's default agent opens with the prompt filled in.
4. Send the prompt.

The fixed instructions tell the agent to use the `penguin-config` Skill and to:

- run `penguin config model add --provider <group> --model-id <upstream id> --project-id <project> --root <data root>` once per model, adding `--client-type openai --base-url <endpoint>` for an OpenAI-compatible endpoint. The data root is named because a command's environment does not carry it;
- when the source is a web page, fetch it first and add the models you named, or the most popular ones, about ten at most;
- ask once for a missing API key, or leave it empty for you to fill in on the **Models** page;
- never read or edit `.project_config.toml`;
- finish with `penguin config model list`.

The **Models** page reloads the table on every visit, so the new group is there when you come back from the conversation.

## Detect a custom model's protocol

Models in **Custom** and in groups you created speak one of AgentHub's generic protocols, and the dialog can find out which one a base URL serves. A new custom model starts with no protocol selected: the suffix at the right edge of the base URL field reads **Select protocol**.

To detect the protocol, select **Detect** at the top-right of the base URL field. It is always available, and no API key is needed. The server probes the URL with three cheap requests, in this order, and applies the first protocol the endpoint serves:

1. `openai-responses`: `POST {base}/responses` (OpenAI Responses API)
2. `ant-messages`: `POST {base}/v1/messages` (Anthropic Messages API)
3. `openai-chat`: `POST {base}/chat/completions`

A message names the protocol found, for example "Detected {name}; applied". The result lives only in the suffix, which shows the protocol path.

Detection tolerates common base URL mistakes:

- one `/v1` too many (`https://host/v1/v1`);
- one too few (`https://host` for an API served under `https://host/v1`);
- a whole endpoint URL pasted from a provider's documentation (`/chat/completions`, `/responses`, `/messages`).

It probes the cleaned-up base first, then its neighbouring form: the trailing `/v1` is removed if the URL has one, added if it does not. Each form is tried against the three protocols in order, six short probes at most. The base URL field is then rewritten to the form that answered: "Detected {protocol}; base URL normalized to {url}".

To set the protocol by hand, select the suffix. The menu lists **OpenAI Responses** (`/responses`), **Anthropic Messages** (`/v1/messages`), and **OpenAI Chat Completions** (`/chat/completions`), each with the path the client appends to your URL. A protocol you pick wins over detection, so an endpoint whose protocol you know never has to be probed.

If detection finds nothing, the suffix turns amber and a message says "Could not detect the protocol. Please check the API key and the base URL." This happens when the endpoint is unreachable, timed out, answered with something that is not an API, or serves none of the three paths. The endpoint still reports each probe's outcome for debugging.

Detection never blocks a save. If you select **Confirm** while the protocol is still unset, detection runs first and the button reads **Detecting…**. A hit is saved without a message. If nothing is found, the model is still saved, on OpenAI Chat Completions, with the message "Protocol not detected; saved as OpenAI Chat Completions".

### How probing works

- Probes are minimal invalid requests with `{}` bodies. They cost no Tokens and need no valid model id: an error in the protocol's own shape proves the route exists, a `404` or `405` means the path is not served, and HTML or gateway noise counts for nothing.
- The probed URLs and auth headers are exactly what the AgentHub client uses after saving: `Authorization: Bearer` for the OpenAI protocols, and `x-api-key` plus `Authorization: Bearer` and `anthropic-version` for `ant-messages`. A detected protocol is one that will really work.
- The server picks the probe credential in three steps: the API key typed in the dialog, else the key already stored for the entry, else the environment variable of the protocol that probe speaks (`ANTHROPIC_API_KEY` for `ant-messages`, `OPENAI_API_KEY` for the two OpenAI protocols). The choice is made per probe, because the protocol is what is being determined. None of these values reach the browser or the response.
- Detection works with no credential at all, since a protocol-shaped `401` identifies the route. An authenticated probe is still far more likely to get that answer than the generic `401` or gateway HTML an anonymous request often gets.
- Nothing is inferred from the model id in these groups. Typing `claude-sonnet-5` into a custom group does not select the Anthropic client or its `ANTHROPIC_*` key: custom groups fall back to `openai-chat`, and the API key hint follows that. Vendor and gateway groups are not affected; their ids are known to the catalog, so they route by id or by the group's preset.
- Entries created before detection existed keep `client_type = "openai"`, which is still an alias of `openai-chat`. They are rewritten only when you pick a protocol or a detection applies. An older, non-standard protocol value is shown read-only: "Protocol: {t} (kept as configured; not editable)".
- Detection is available as `POST /api/projects/:id/models/detect` (owner only); see [Server API](/server-api).

## Detect vision support

**Vision support** can stay off until you ask the model. Select **Detect** next to the switch: PenguinHarness sends the model one 1x1 PNG with a one-word prompt.

- If the model answers, the switch turns on: "This model accepts images; vision turned on".
- If the model says it does not take images, the switch turns off. That is a real answer, not an error.
- If the probe fails on authentication or the network, the switch stays as it was, and the message asks you to check the API key and the base URL.

> [!NOTE]
> Unlike protocol detection, this probe is a real, billed request: an image request cannot be made free the way the protocol probes are. It runs only when you select **Detect**, never on its own and never on save.

The credential comes from the same chain as the connection test: the key typed in the dialog, else the stored key, else the protocol's environment variable, all resolved on the server. **Vision support** appears only for models that are not in the built-in catalog; catalog models already declare whether they accept images.

## Set API keys

Each model carries its own API key, or none.

- **One model.** In **Model settings**, enter the key in **API key**. Once saved, the key is shown masked; leave the field empty to keep it, or select **Clear stored API key** to remove it.
- **A whole group.** On a group's header, select **Set key** and enter the key. It applies to every model in the group.
- **No key.** A model without a key uses the provider's environment variable on the server; see [Built-in provider groups](#built-in-provider-groups). The card and the dialog show when a key is read from an environment variable.

A key you type is stored in the hidden Project config file, which has mode 0600. The Web App always masks it.

### Authorize a new API key

A provider that supports automatic key authorization adds **Authorize key** to its group header. Two built-in groups do: TokenDance and Penguin Go. The key is written to every model in the group, replacing the key those models use now.

1. On the group's header, select **Authorize key**.
2. Select **Open authorization page**. The provider's authorization page opens in a new tab.
3. Authorize there. The dialog, which shows "Waiting for the authorization to finish in the other tab…", reports the result on its own.

TokenDance creates a **new** key on your account; it does not read a key you already have. The provider sends the browser back to PenguinHarness, which exchanges the one-time code and saves the key. If the page cannot redirect back, for example because the browser cannot reach the server at the address it was given, select **Page can't redirect back? Enter the code by hand**. The authorization page then shows a one-time code instead of redirecting.

1. Paste the code into **Authorization code**.
2. Select **Submit code**.

Penguin Go differs in four ways:

- The server polls Penguin Go for the result, so this group has no manual-code mode.
- Once the group has a key, a **Sync** action sits on the header just before **Add model** and reads the platform's catalog again; see [The Penguin Go group](#the-penguin-go-group). **Authorize key** stays available, so you can switch to another platform account.
- A key the platform reports as invalid or revoked reopens authorization on the **Models** page.
- If writing the delivered key locally fails, the server keeps that one delivery for a short while, so the write can be retried without authorizing again.

Keep in mind:

- Only the Project owner can start an authorization. With TokenDance, only their own signed-in session can finish it, which in practice is the tab the dialog is open in. The redirect itself is received without a session, because the browser the provider sends back is not always the one you started in, but it only hands the code over: nothing is exchanged and no key is saved until the dialog asks for the result.
- The whole exchange runs on the server. Neither TokenDance's PKCE verifier nor Penguin Go's device secret ever reaches the browser, and the new key goes straight into the model table without passing through it.
- An authorization delivers one key and expires at the provider's own deadline, and never later than ten minutes.
- TokenDance hands over the new key only once. If saving it fails, authorize again and delete the unused key in the provider's console.
- A TokenDance key carries PenguinHarness's app URL from the [App attribution](#app-attribution) table, so calls made with it stay attributed even from another tool.

## Set the default model

New conversations use the Project's default model unless you pick another one. A new Project's default is `deepseek-flash` (DeepSeek V4.1 Flash), which reads images itself.

1. Select the model's card to open **Model settings**.
2. Select **Set as default model** and confirm.

The first model added to a table without a default becomes the default automatically. Setting the default also saves any unsaved changes in the dialog.

### Set the proxy vision model

A model without vision cannot see images. When it reads an image with `read_file`, a proxy vision model describes the image for it. There is none by default.

1. Open **Model settings** for a model with **Vision support** on.
2. Select **Set as proxy vision model** and confirm.

The proxy vision role is cleared when that model is deleted or its vision is turned off. For a model with `vision = false`, such as `deepseek-v4-pro`, the text-only member of the DeepSeek group, images from the conversation are saved to the Session scratchpad and handed over as a file path in the text. `read_file` passes an image to the proxy vision model for a description instead of returning it. See [Tools & Approval](/tools).

## Test a connection

In **Model settings**, select **Test connection** (owner only). The test uses what is in the dialog right now, including a key you typed, the base URL, the protocol, and the **Fast mode** switch, so problems show up before you save. The result reads "Connected ({ms} ms)" or "Failed: {msg}".

### Measure speed

To compare the models in a group:

1. On the group's header, select **Speed test**.
2. Select **Start**.

PenguinHarness sends one real request to each model in turn, which uses a small amount of your API quota, and shows on each card:

- the time to first token, in milliseconds: green under 1000, yellow up to 3000, red above;
- the output rate, in Tokens per second: green at 40 or more, yellow at 15 or more, red below.

Results stay only on the page and are gone after a reload.

## Sync preset models

PenguinHarness updates can change the built-in catalog of preset models. When they do, the Project owner sees:

- a red dot on **Models** in the sidebar;
- a notice on the page, "Changes detected: {added} new, {updated} to upgrade", with **Update now** and **Dismiss**;
- a **Sync presets** button in the header.

**Update now** lists the models it will touch; confirm with **Sync presets**. The **Sync presets** button in the header syncs right away, without the list.

Syncing:

- adds catalog models the Project does not have, retired rows excepted: one the Project already has is kept current, but a Project without it never gets it (see [Preset models](#preset-models));
- resets each existing catalog model's vision flag, context window, protocol, prices, and base URL to the catalog's values;
- fills in an empty display name, but never overwrites one;
- never touches API keys, **Max output tokens**, fast mode, or models and groups you added yourself.

**Dismiss** hides the notice until a later catalog change.

## Thinking levels

The thinking level sets how much the model reasons before it answers. There are six levels: `none | low | medium | high | xhigh | max`. Each agent has a default, `model.thinking_level` in `system_config.yaml` (see [Agent config](/configuration#agent-config)). A new agent starts at `medium`.

The pickers offer `low` and above. Many models cannot turn thinking off, but a stored `none` is still valid and still displays. Every level is labeled with the value it sends, so the label names exactly what goes on the request.

- `max` is the deepest tier. Each client maps it to the deepest effort its vendor accepts and falls back silently where there is no such tier, so picking it never fails. On Gemini and MiniMax M3 it lands on the same effort as `xhigh`.
- For MiniMax M3, `none` maps directly to `reasoning.effort = "none"`.
- DeepSeek V4 accepts `low`, `high` and `max`, and folds `medium` and `xhigh` into `high` on its side. Pick `max` for DeepSeek's deepest effort.

### In a new chat

The picker next to the model selector changes the selected agent's default right away. It applies from that agent's next conversation.

### In a conversation

The picker shows the level this conversation uses, which starts as the agent's default.

- A level you pick is saved on the conversation and applies from the model's next request. It never changes the agent's default.
- Changing the level mid-conversation invalidates the model's cached context, which raises cost.
- If the conversation has history, a **Switch thinking level** dialog offers **Compact, then switch**, which is cheaper, or **Switch anyway**. Compacting first is not available while the conversation is still working.

To change an agent's default in its settings, see [Runtime tab](/agents#runtime-tab).

## Fast mode

Fast mode sends a model's conversation requests to the provider's faster serving tier, at premium prices. It is off by default, and existing configs are not affected.

Turn fast mode on or off per model in one of three ways:

- The **Fast mode** switch in the model dialog
- `--fast-mode` / `--no-fast-mode` on `penguin config model add`
- `fast_mode = true` in the entry

Turning it on asks for confirmation first, because it changes what the model costs. A model with fast mode on shows the **Fast** tag.

With fast mode on, conversation requests carry AgentHub's `fast_mode` flag:

- OpenAI-protocol clients send `service_tier: "priority"`.
- Anthropic-protocol clients send `speed: "fast"` with the fast-mode beta header.

Fast tiers are billed at the provider's premium prices: MiniMax charges 1.5x its standard rate, and OpenAI and Anthropic publish separate premium rates.

> [!WARNING]
> The recorded per-Token prices do not change, so costs shown for fast-mode usage are underestimated unless you raise the entry's prices.

### Which models offer it

Whether a fast tier exists depends on the AgentHub client a model routes to, not on the model entry. The switch appears only where that client actually sends the parameter:

| Routed client | Fast mode |
| --- | --- |
| OpenAI protocol (`openai_chat`, `openai_responses`, `gpt6`, `minimax_m3`) | sent as `service_tier: "priority"` |
| Anthropic protocol (`ant_messages`, `claude5`) | sent as `speed: "fast"` plus the beta header |
| Gemini, GLM, Kimi, DeepSeek, OpenAI embeddings | rejected — no toggle |
| Claude on Bedrock, or a Claude 4.6 id | rejected — no toggle |

Routing follows the entry's `client_type`, or its `model_id` when none is set, so the same upstream id can land in different places. A Kimi model added under a gateway group (`client_type = "openai"`) can use fast mode, while the same id routed to Kimi's own client cannot. A custom model behind your own base URL keeps the switch: it speaks the OpenAI protocol and may well be OpenAI, but a third-party server is free to accept the parameter and serve the standard tier anyway.

Two things the switch cannot check for you:

- Anthropic's fast mode is a limited research preview. Until your organization is granted access, requests return a 429 rate-limit error. The confirmation says so for Anthropic-protocol models.
- `CLIENT_TYPE` and `ANTHROPIC_BASE_URL` in the server's environment override the entry, and can route a model somewhere the switch did not anticipate.

> [!NOTE]
> If a request still reaches a client that rejects `fast_mode`, AgentHub refuses it before any network request. The conversation ends that turn immediately with the provider's message and a pointer to the setting. A rejection that will always repeat is never retried.

An entry that stores `fast_mode = true` on a model that cannot serve it keeps its switch in the dialog, marked unsupported, so you can always turn it off.

The connection test sends the dialog's current fast-mode state, so **Test connection** shows a fast-mode rejection before you save. Background requests, such as Session title generation and `read_file`'s proxy vision reads, never use fast mode. Only the conversation's own requests do.

## Connect a local or self-hosted endpoint

A local inference server can join a Project in two ways.

### Add the model to the vLLM group

Add the model to the **vLLM** group. The protocol is fixed to `openai-chat-vllm-adapter`, and the group has no preset base URL, so set **Custom base URL** to your server.

The group ships eight preset models at a price of 0:

- `Qwen/Qwen3.8-Flash-Next`
- `Qwen/Qwen3.8-27B`
- `Qwen/Qwen3.6-35B-A3B`
- `Qwen/Qwen3.5-0.8B`
- `Qwen/Qwen3.5-9B`
- `deepseek-ai/DeepSeek-V4-Pro`
- `deepseek-ai/DeepSeek-V4-Flash`
- `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp`

Their context windows are each model's native length: 262,144 for the Qwen models, 1,000,000 for the DeepSeek V4 models.

### Add a custom entry

Add a `custom` model with:

- `client_type = "openai-chat"`
- `base_url` pointing at the server, for example `http://127.0.0.1:8000/v1`
- the served model name as `model_id`

Protocol detection settles on `openai-chat` for such servers, and the base URL field's suffix menu selects it by hand.

### Make a local server run smoothly

Whichever way you add the model, check two settings:

- **Enable tool calling on the server.** For vLLM, start the server with `--enable-auto-tool-choice` and the `--tool-call-parser` for your model, for example `hermes` for Qwen or `llama3_json` for Llama 3.x. Without them, tool calls arrive as plain text and the agent loop cannot run anything.
- **Set the entry's `context_window` to the server's real window.** For vLLM, that is the `--max-model-len` value, for example `32768`.

The per-request output limit and the compaction threshold both follow this window. Requests limit `max_tokens` to what the window still fits, and compaction runs before the window overflows, so you do not need to tune `max_tokens` by hand.

> [!NOTE]
> If the field is left unset, the per-request output limit is off and compaction assumes a 128000 window, so a server with a smaller real window rejects requests.

## Built-in provider groups

The table below lists the built-in groups and the environment variables their models fall back to when an entry has no key. The catalog source is `packages/core/src/state/model-catalog.ts`. Each group also has a `_BASE_URL` variant, for example `ANTHROPIC_BASE_URL`. The **Models** page lists the groups in this order, followed by the groups you create.

| Provider | API key env var | Notes |
| --- | --- | --- |
| tokendance | `OPENAI_API_KEY` | The recommended group. OpenAI-compatible gateway, preset base URL `https://tokendance.space/gateway/v1`; model ids are bare, with no vendor prefix (e.g. `glm-5.3`, `kimi-k3`); pricing is the gateway's own CNY rates, several of them currently discounted |
| penguin-go | `PENGUIN_GO_API_KEY` | Preset relay group, fixed base URL `https://token.penguin.ooo/api`; its header authorizes a key for you or takes one you set by hand. See [The Penguin Go group](#the-penguin-go-group) |
| deepseek | `DEEPSEEK_API_KEY` | Group of the default model |
| openrouter | `OPENAI_API_KEY` | OpenAI-compatible gateway, preset base URL `https://openrouter.ai/api/v1` |
| fireworks | `OPENAI_API_KEY` | Fireworks AI (OpenAI-compatible), preset base URL `https://api.fireworks.ai/inference/v1`; API model ids look like `accounts/fireworks/models/<slug>` |
| google | `GEMINI_API_KEY` | |
| openai | `OPENAI_API_KEY` | |
| anthropic | `ANTHROPIC_API_KEY` | |
| siliconflow | `OPENAI_API_KEY` | OpenAI-compatible gateway, preset base URL `https://api.siliconflow.cn/v1` |
| zhipu | `ZAI_API_KEY` | |
| moonshot | `MOONSHOT_API_KEY` | |
| minimax | `MINIMAX_API_KEY` | Direct MiniMax M3 Responses client (`client_type = "minimax-m3"`): `MiniMax-M3` with a 1,000,000-token context window and vision; preset base URL `https://api.minimax.io/v1`; accepts a Token Plan Subscription Key or pay-as-you-go API key |
| qwen-pay-as-you-go | `OPENAI_API_KEY` | Qwen pay-as-you-go (DashScope's OpenAI-compatible endpoint), preset base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`; resold third-party models keep vendor-prefixed ids (e.g. `kimi/kimi-k3`) |
| qwen-token-plan | `OPENAI_API_KEY` | Qwen Token Plan subscription gateway, preset base URL `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`; pricing from each model page's official list price (the preview model has only a quota-multiplier promo, no list price) |
| vllm | `OPENAI_API_KEY` | Self-hosted vLLM servers: protocol fixed to `openai-chat-vllm-adapter`, no preset base URL, eight preset models priced at 0 (see [Connect a local or self-hosted endpoint](#connect-a-local-or-self-hosted-endpoint)) |
| custom | `OPENAI_API_KEY` | Any OpenAI-protocol endpoint; ships one preset, Atria Dawn Preview (Anthropic Messages API at `api.atria-asi.ai`, credential from `ANTHROPIC_API_KEY` when the entry has none, 256K window, priced at $0 until the vendor publishes prices) |

The gateway groups (openrouter / fireworks / siliconflow / tokendance / qwen-pay-as-you-go / qwen-token-plan) go through AgentHub's generic OpenAI-protocol clients, so with blank credentials they read `OPENAI_API_KEY`, not a gateway-specific variable.

- The OpenRouter group uses the Responses client (`client_type = "openai-responses"`) for its presets and for any model you add to it, because OpenRouter serves the Responses API at that same base URL for every model it resells.
- The other gateway presets use the Chat Completions client (`client_type = "openai-chat"`).
- Both clients read the same `OPENAI_*` variables, so the credential rules are identical either way.

The direct MiniMax M3 client reads `MINIMAX_API_KEY`. The built-in MiniMax preset uses `https://api.minimax.io/v1`. `MINIMAX_BASE_URL` is read only for entries without their own `base_url`.

### The Penguin Go group

`penguin-go` is a built-in group like TokenDance: a relay behind the fixed base URL `https://token.penguin.ooo/api`. A new Project gets the group's catalog models right away; a Project created before the group adds them with **Sync presets**.

The group's key comes from its header; see [Authorize a new API key](#authorize-a-new-api-key). Authorization, and the **Sync** action that follows it, also read the platform's own model catalog:

- Models the platform offers and the Project does not have are added, with their protocol, endpoint, display name, context window, vision flag and list price. Pure embedding models are left out.
- Models the Project already has keep their endpoint and everything else you configured. Only their three prices and their client protocol are refreshed, `max_tokens` stays unset so the agent's setting applies, and nothing is ever deleted.
- The platform's promotions replace the ones stored for this group. As in every other group, `.project_config.toml` holds the list price and the promotion lives in the server's database; **Sync presets** never sets one, and each authorization or **Sync** replaces them. If that record is lost, usage is priced at the list price until the next one writes it back.

The platform quotes peak rates in USD per million Tokens. The group's DeepSeek rows follow DeepSeek's current line-up, `deepseek-flash` and `deepseek-v4-pro`, and declare the same off-peak schedule as the direct DeepSeek group, so their cards and cost records use half price outside Beijing weekday 9:00–12:00 and 14:00–18:00.

### Preset models

The preset catalog includes, among others:

- `deepseek-flash` / `deepseek-v4-pro`
- `MiniMax-M3`
- `gemini-3.8-flash`
- `claude-opus-5` / `claude-opus-4-8` / `claude-sonnet-5`
- `gpt-6-astra` / `gpt-5.6` / `gpt-5.5`
- `glm-5.3` / `glm-5.3-flash`
- `kimi-k3`
- `qwen3.8-max` / `qwen3.8-flash`
- `seed-2.1-pro` / `seed-2.1-turbo` / `seed-evolving`
- `dots-3-note-preview` (free on TokenDance, 512K context)

The list is not exhaustive.

- **DeepSeek images.** `deepseek-flash` is V4.1 Flash and reads images; `deepseek-v4-pro` is the V4 Pro 0813 release and is text-only. To send an image, use `deepseek-flash`.
- **Retired rows.** DeepSeek still accepts `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp`, and serves both from V4.1 Flash. They are no longer presets, but the catalog keeps them, together with TokenDance's `deepseek-v4-flash-vision-exp`, as retired rows: a Project that still carries one keeps its display name, and **Sync presets** keeps its price current. A retired row is never added to a Project that does not have it, and a new Project never gets one.
- **OpenAI twice.** The whole OpenAI line-up is listed twice: directly (your own OpenAI key, list prices) and on OpenRouter as `openai/<id>` (the gateway's rates, which follow its running promotions).
- **GLM-5.3 Flash five times.** It appears directly as `glm-5.3-flash`, under the same id on TokenDance, and as OpenRouter's `z-ai/glm-5.3-flash`, Fireworks AI's `accounts/fireworks/models/glm-5p3-flash` and Qwen pay-as-you-go's `ZHIPU/GLM-5.3-Flash`. Every row accepts images: AgentHub's GLM client forwards image parts for this one GLM id, every other GLM id refuses them, and the gateway rows go through the generic OpenAI-compatible clients, which carry images for any id. What the rows do not share is the price: each records what its own seller charges, so they disagree while a promotion runs.
- **OpenRouter free tier.** The catalog carries the `:free` model variant `nvidia/nemotron-3-ultra-550b-a55b:free` and the `openrouter/free` unified Free Models Router. They cost nothing, but OpenRouter's free-tier rate limits and data policy apply.

### Prices and promotions

- **Three price buckets.** Each model records `cache_read`, `cache_write` and `output` prices in USD per million Tokens. The cost center bills usage against them.
- **Base tier only.** Where a vendor's prices step up with input size, the catalog records the base tier. MiniMax M3 records MiniMax's standard pay-as-you-go tier at 512K input tokens or below; above that, every rate doubles, and the priority tier is 1.5x, so long-context and priority usage is underestimated. OpenAI (above 272K) and Gemini 3.1 Pro (above 200K) follow the same convention.
- **DeepSeek off-peak.** The direct DeepSeek rows record the official peak prices and declare DeepSeek's off-peak schedule: outside Beijing time 9:00–12:00 and 14:00–18:00 on weekdays, every bucket is halved. The **Models** page shows a `50% off` tag during those hours, and the cost center bills at that rate.
  - Four resold rows follow the same schedule because their sellers pass DeepSeek's windows through: TokenDance's `deepseek-v4.1-flash`, OpenRouter's `deepseek/deepseek-v4.1-flash`, and Penguin Go's `deepseek-flash` and `deepseek-v4-pro`.
  - Qwen bills the DeepSeek models it resells on a schedule of its own, half price from 22:00 to 8:00 Beijing time every day. `deepseek-v4.1-flash` in both Qwen groups, and the Token Plan's `deepseek-v4-pro-0813`, declare that one instead, and the tag's tooltip names the windows of whichever schedule the row follows.
  - The stored price is always the peak price, so what is on disk does not depend on the hour a Project was created or synced.
- **Flat promotions.** Nine TokenDance models are discounted today:
  - `kimi-k3` at 40% off
  - `deepseek-v4-flash-0731`, `deepseek-v4-pro-0813`, `glm-5.3`, `glm-5.3-flash` and `qwen3.8-max` at 10%
  - the three Doubao Seed rows (`seed-2.1-pro`, `seed-2.1-turbo`, `seed-evolving`) at 50%

  Gemini 3.8 Flash, 3.7 Flash and 3.6 Flash are also 50% off, both in the google group and on OpenRouter (`google/gemini-3.8-flash`, `google/gemini-3.7-flash`, `google/gemini-3.6-flash`), because Google halves them through 2026-12-31. A Project is preset with the **list** price: the server keeps the promotion beside it, in its own database rather than in `.project_config.toml`, and takes it off when usage is priced, so the cost center charges what the seller charges. The model card shows the rate being billed right now as a tag, and the model dialog says **These are list prices. A running promotion takes N% off them; changing a price cancels it**.
- **Your own prices.** Editing a row's price cancels its promotion and takes the discount tag off the card: the figure is then yours, not the seller's.

## The per-Project model table

Each Project's models are recorded in the hidden `.project_config.toml`. Maintain it through the **Models** page or the CLI (`penguin config model add / default / list`, see [CLI Reference](/cli)).

> [!WARNING]
> Do not edit `.project_config.toml` by hand.

Each `ModelEntry` has these fields:

| Field | Meaning |
| --- | --- |
| `provider` | Config group name; paired with `model_id` it forms the unique key |
| `model_id` | Upstream request id |
| `context_window` | Context window (tokens). Load-bearing, not just display: each request's effective output cap and the compaction threshold are derived from it, so requests never ask for more output than the window still fits. Unset (or implausibly small, under 4096): the output clamp turns off and compaction derives from an assumed 128000 — set the real value for models with smaller windows. The Web dialog writes 1,000,000 when a model that is not in the catalog leaves the field blank (a hand-added entry is a known model, not an unknown window); narrow it when the endpoint serves less. `penguin config model add` writes no default at all when `--context-window` is omitted |
| `max_tokens` | Optional per-model output cap (max output tokens per request). When set it overrides the agent's `model.max_tokens`; unset inherits it. The cap is a ceiling, not the literal wire value: each request sends `min(max_tokens, context_window − estimated input − safety margin)`, so small-window models work without hand-tuning it. Omitting the field on a Web full-table save clears it |
| `client_type` | Protocol hint (`openai-chat` for Chat Completions, `openai-responses` for the Responses API, `ant-messages` for Anthropic Messages, …); inferred by AgentHub from the model id when omitted. Custom endpoints use one of those three generic protocol clients, and the Web dialog can detect which one a base URL serves. The pre-0.4.2 spelling `openai` is a deprecated alias and is normalized to `openai-chat` when the config is read |
| `display_name` | Display name |
| `vision` | Whether image input is supported, default true |
| `fast_mode` | Optional fast mode (off by default): opts the model's Session requests into the provider's faster serving tier at premium pricing. Only `true` is ever persisted — omitting the field on a Web full-table save clears it. Models without a fast tier reject requests carrying it (see [Fast mode](#fast-mode)) |
| `pricing` | Three price buckets (unit `usd_per_mtok`, USD per million tokens): `cache_read` / `cache_write` / `output` |
| `api_key` / `base_url` | Inlined credentials, both optional; when blank, AgentHub falls back to environment variables |

The file also holds `default_model`, and optionally `vision_model`, the proxy vision model. File shape (illustrative):

```toml
default_model = { provider = "deepseek", model_id = "deepseek-flash" }
vision_model = { provider = "google", model_id = "gemini-3.1-pro-preview" }

[[models]]
provider = "deepseek"
model_id = "deepseek-flash"
context_window = 1000000
client_type = "deepseek-v4"
base_url = "https://api.deepseek.com"

[[models]]
provider = "custom"
model_id = "my-model"
client_type = "openai-chat"
base_url = "https://llm.example.com/v1"
api_key = "sk-..."
```

## App attribution

Some gateways read a request header that files a call under the app that made it, for their own app rankings, usage reports or routing.

The catalog decides these headers by **endpoint host**, not by the entry's provider group. An entry filed under custom whose base URL points at such a gateway carries the same headers. Only the entry's own `base_url` counts: an endpoint supplied through `OPENAI_BASE_URL` is resolved inside AgentHub, is not visible on this side, and is therefore not attributed.

| Endpoint | Header | Value |
| --- | --- | --- |
| `openrouter.ai` | `HTTP-Referer` | `https://penguin.ooo/` |
| `openrouter.ai` | `X-OpenRouter-Title` | `PenguinHarness` |
| `openrouter.ai` | `X-OpenRouter-Categories` | `cli-agent,personal-agent` |
| `tokendance.space` | `X-App-URL` | `https://penguin.ooo/` |
| `opencode.ai` | `x-opencode-session` | The Session id, sent only when a Session id is known |

Every other endpoint, including every direct vendor and every gateway that reads no such header, receives no extra headers. The OpenRouter and TokenDance headers state the app's identity only. The OpenCode header names the conversation, because that gateway routes each conversation by it; no header carries anything about the user or the agent.

## How it works

### One gateway

All model access goes through one gateway library, `@prismshadow/agenthub` (AutoLLMClient). The core defines only a thin `LLMInterface` (see [Interfaces](/interfaces)). Per-provider protocol adaptation happens inside AgentHub, so 1000+ online and local models are reachable, including any OpenAI-compatible endpoint. The protocol translation lives in `packages/core/src/llm/generative-model.ts`.

### Model identity

A model's identity is always the `(provider, model_id)` pair. `provider` is a config group name, and `model_id` is the upstream request id, sent to AgentHub unchanged. The two are independent fields, and joining them into one string is forbidden anywhere in the pipeline.

Every interface that names a model takes the complete pair: the CLI, the HTTP API and the SDK all reject half a reference instead of completing it. The provider is never inferred from the model id and has no default, because gateways resell vendor models under their upstream ids; a guessed group would send the entry's credential to a vendor nobody named.

Where a model reference is optional (`penguin run` / `chat`, Session creation, scheduled tasks), the choice is between the whole pair and nothing. Omit both halves to use the Project's default model.

### Models and agents

An agent never binds a model. The model is chosen when a Session is created and stays fixed for that Session, so the same agent can run different Sessions on different models.

The in-session `/model` command switches models by handoff:

1. It opens a new Session for the same agent on the new model, in the current Workspace.
2. The new Session's first message carries a `[model_switch_from]` block with the source Session's id and its Trace file path.

The history is not injected into the new context. Some models require thinking payloads and `fidelity` when history is replayed, and these cannot cross models. The model reads the Trace file itself when it needs to, and the source Session stays untouched.

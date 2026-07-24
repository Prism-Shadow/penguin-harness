---
title: "Free models in PenguinHarness: run a full agent harness at zero cost"
date: 2026-07-24
category: news
excerpt: The preset catalog now carries three zero-cost OpenRouter entries — Nemotron 3 Ultra (free), the new Ling 3.0 Flash (free), and the new Free Models Router. One OpenRouter API key and an agent is running, no balance required. Here is the lineup, how to switch it on, and an honest account of what the free tier does and does not buy you.
---

Trying an agent harness should not start with a top-up. PenguinHarness ships free models in its preset catalog: rows priced at $0 per million tokens, wired up like every other preset — protocol, base URL, pricing and context window pre-filled — so the only thing between you and a running agent is an OpenRouter API key, which is itself free to create.

As of today the free lineup is three entries, all in the OpenRouter group:

| Provider group | Model id                                 |          Context | Price |
| -------------- | ---------------------------------------- | ---------------: | ----- |
| OpenRouter     | `nvidia/nemotron-3-ultra-550b-a55b:free` |        1,000,000 | $0    |
| OpenRouter     | `inclusionai/ling-3.0-flash:free`        |          262,144 | $0    |
| OpenRouter     | `openrouter/free`                        | varies per route | $0    |

## Nemotron 3 Ultra (free)

The catalog's first free row, and still its largest: NVIDIA's open frontier-reasoning and orchestration model, a Mixture-of-Experts with 55B active parameters out of 550B total on a hybrid Transformer–Mamba architecture, with a 1M-token context window. If you want to see what the harness's planning-heavy loops look like on a big reasoning model — without paying big-reasoning-model prices — this is the row.

## New: Ling 3.0 Flash (free)

Released by inclusionAI on July 23, in the catalog the next day. Ling-3.0-flash is a 124B-parameter MoE that activates only ~5.1B parameters per token, and inclusionAI's stated design priorities are token efficiency and production-scale agentic inference, tool calling included. That reads like a description of what an agent harness does all day: dozens of short round trips, each carrying a tool schema and a growing transcript, where efficiency per step is the whole cost model. A sparse, tool-tuned model at $0 is a very good default for exactly that traffic. Context is 262K; text only.

## New: Free Models Router

`openrouter/free` is not a model but OpenRouter's unified free-tier endpoint: each request is routed to a random free model currently available on OpenRouter, filtered so the target supports what the request actually needs — tool calling, structured outputs, and so on. Free models come and go upstream; the router keeps answering, and you never chase the current list yourself.

Two catalog decisions are worth knowing. The row records no context window, because the routed target's window changes per request. And it is marked text-only on purpose: the router itself accepts images, but the model behind any given request may not, so PenguinHarness keeps images off this route and falls back to its usual text-only hand-off (file path plus `describe_image`).

## Switching it on

1. Create an API key at [openrouter.ai](https://openrouter.ai/) — the free tier needs no payment method.
2. A new Project carries the presets already: open the **Models** page and paste the key on the OpenRouter group's bulk key button. An existing Project picks the new rows up with one click on **Sync presets** next to the Models page's search box — locally added models and stored credentials are untouched.
3. Or from the terminal:

```bash
penguin config model add --provider openrouter --model-id inclusionai/ling-3.0-flash:free --api-key <your-key> --set-default
penguin config model list
```

Set a free row as the Project default, or leave the default alone and pick one in the model selector when starting a session — models are chosen per Session, not bound to an Agent.

## What free buys you, and what it does not

The caveats, plainly:

- **Rate limits.** OpenRouter's free tier caps requests per minute and per day; a long agent session or a benchmark run can hit them.
- **Data policy.** Free models run under OpenRouter's free-model terms, and prompts may be used by the upstream provider as those terms allow, including for training. Send nothing you would not share.
- **Availability and quality vary.** Free capacity is whatever providers choose to offer; models get busy, get slower, and get withdrawn.
- **The router's target changes per request.** Consistency is not what `openrouter/free` is for; a fixed free row gives you more of it, a paid row the most.

Free models are a genuine way to experience the full harness — Workspaces, tools, Skills, subagents, the Cost center reading a clean $0 — and to run light automation. For serious work, pick a paid model; the same catalog carries plenty.

## Get it

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```

Then open the Models page, drop in an OpenRouter key, and pick a free row.

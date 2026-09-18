---
title: Introducing the free models in PenguinHarness
date: 2026-07-24
category: news
excerpt: The preset catalog now has four free OpenRouter entries, three of them new, so one free OpenRouter API key is all an agent needs. Here is the lineup, how to switch it on, and what the free tier does and does not give you.
---

> Written for PenguinHarness 0.1.2. Later releases may differ in some details.

PenguinHarness now ships free models in its preset catalog: rows priced at $0 per million Tokens, set up like every other preset with the protocol, base URL, pricing and context window filled in. The only thing between you and a running agent is an OpenRouter API key, which is itself free to create, and no balance is required.

As of today, the free lineup has four entries, all in the OpenRouter group. Nemotron 3 Ultra was already in the catalog. Ling 3.0 Flash, Laguna M.1 and the Free Models Router are new.

## The lineup

| Provider group | Model id                                 |                Context | Price |
| -------------- | ---------------------------------------- | ---------------------: | ----- |
| OpenRouter     | `nvidia/nemotron-3-ultra-550b-a55b:free` |              1,000,000 | $0    |
| OpenRouter     | `inclusionai/ling-3.0-flash:free`        |                262,144 | $0    |
| OpenRouter     | `poolside/laguna-m.1:free`               |                262,144 | $0    |
| OpenRouter     | `openrouter/free`                        | 128,000 (conservative) | $0    |

![The OpenRouter group on the Models page: Ling 3.0 Flash (free), Nemotron 3 Ultra (free), Laguna M.1 (free) and the Free Models Router each carry the light-yellow Free badge](/blog-assets/free-models-page-en-light.webp)

## Nemotron 3 Ultra (free)

Nemotron 3 Ultra was the catalog's first free row, and it is still the largest. It is NVIDIA's open frontier model for reasoning and orchestration: a Mixture-of-Experts model with 55B active parameters out of 550B total, on a hybrid Transformer–Mamba architecture, with a context window of 1M Tokens. Pick this row to see how the harness's planning-heavy loops run on a large reasoning model without paying large-reasoning-model prices.

## Ling 3.0 Flash (free)

inclusionAI released Ling 3.0 Flash on July 23, and it joined the catalog the next day. It is a 124B-parameter Mixture-of-Experts model that activates only about 5.1B parameters per Token. inclusionAI names Token efficiency and production-scale agent inference, tool calling included, as its design priorities.

That is close to what an agent harness does all day: dozens of short round trips, each carrying a tool schema and a growing transcript, where the efficiency of each step decides the cost. A sparse, tool-tuned model at $0 is a good default for that kind of traffic. Context is 262K; text only.

## Laguna M.1 (free)

Laguna M.1 joined the catalog alongside Ling. This row is the free tier of Poolside's flagship coding-agent model, which is optimized for complex software-engineering work: agent coding workflows with tool calling and reasoning, the same traffic a harness generates. Context is 262K; text only.

## Free Models Router

`openrouter/free` is not a model. It is OpenRouter's unified free-tier endpoint: each request goes to a random free model that is currently available on OpenRouter, chosen from the ones that support what the request needs, such as tool calling or structured outputs. Free models come and go upstream, but the router keeps answering, so you never have to track the current list yourself.

Two decisions in the catalog are worth knowing:

- **Context window.** The routed model's real context window changes from request to request, so the row records a deliberately conservative 128,000 instead of any one model's real figure. Long Sessions compact early instead of growing toward a window the routed model may not have.
- **Text only.** The router itself accepts images, but the model behind a given request may not. The row is marked text-only on purpose, so PenguinHarness does not send images on this route and falls back to its usual text-only hand-off (file path plus `describe_image`).

## Switch it on

1. Create an API key at [openrouter.ai](https://openrouter.ai/). The free tier needs no payment method.
2. Open the **Models** page:
   - A new Project already has the presets. Click **Set API key for group** on the OpenRouter group and paste the key once for the whole group.
   - An existing Project picks up the new rows with one click on **Sync presets**, next to the search box. Locally added models and stored API keys stay as they are.
3. Or add a model from the terminal:

   ```bash
   penguin config model add --provider openrouter --model-id inclusionai/ling-3.0-flash:free --api-key <your-key> --set-default
   penguin config model list
   ```

Set a free row as the Project default, or keep your default and pick a free row in the model picker when you start a Session. Models are chosen per Session, not tied to an agent. Free rows carry a light-yellow **Free** badge on the **Models** page and in the model picker, so they are easy to spot.

## What free gives you, and what it does not

Free models let you try the full harness: Workspaces, tools, Skills, subagents, and a **Costs** page that reads $0. They also handle light automation. The limits:

- **Rate limits.** OpenRouter's free tier caps requests per minute and per day. A long Session or a Benchmark run can hit those caps.
- **Data policy.** Free models run under OpenRouter's free-model terms, and the upstream provider may use your prompts as its terms allow. Send nothing you would not share.
- **Availability and quality vary.** Free capacity is whatever providers choose to offer. Models get busy, slow down, and get withdrawn.
- **The router's target changes per request.** Its real context window changes with it, which is why the catalog records a conservative window and long Sessions compact early. Consistency is not what `openrouter/free` is for: a fixed free row gives you more of it, and a paid row the most.

For serious work, pick a paid model. The same catalog has plenty.

## Get it

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Then open the **Models** page, add an OpenRouter key, and pick a free row.

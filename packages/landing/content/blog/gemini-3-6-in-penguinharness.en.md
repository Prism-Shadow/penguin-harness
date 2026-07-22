---
title: "PenguinHarness 0.1.1: Gemini 3.6 Flash support, for building agents faster and better"
date: 2026-07-22
category: news
excerpt: Google reports Gemini 3.6 Flash at 63.9% on MLE-Bench, against 49.7% for 3.5 Flash. MLE-Bench scores machine-learning engineering — an agent doing the work of building and tuning ML systems, which is exactly what PenguinHarness exists to do. The model is in the catalog today, at a lower price than the Flash it replaces. Here is the case, and the rest of the 0.1.1 release.
---

Google announced [Gemini 3.6 Flash, 3.5 Flash-Lite, and 3.5 Flash Cyber](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/) on July 21, 2026. One number in that announcement matters more to PenguinHarness than everything else in it: **MLE-Bench, 63.9% against 3.5 Flash's 49.7%**.

## Why that one number

MLE-Bench scores machine-learning *engineering* — an agent doing the work of building, training and tuning an ML system, not answering questions about one. Google's own phrasing for the result is a "significant improvement in ML Research, as seen in MLE Bench (63.9% vs. 49.7%)". That is a 14.2-point gain, the largest move of the three percentage-scored panels in Google's chart below, and it lands well above the 42.6% the same chart records for the previous Pro-generation model, 3.1 Pro.

PenguinHarness exists so that **agents build agents — faster, better, cheaper**. Every loop the product runs is machine-learning engineering in miniature: stand a model up, hand an agent a task, score it against a private rubric, read the failures, tune, redeploy, measure again. A model that is markedly better at precisely that work, priced in the Flash tier, is the strongest model yet for what this harness does all day. That is the argument; the rest of this post is the evidence, and then the rest of the release.

One caveat up front, and it holds for every figure below: these are **Google's numbers, from Google's evaluation methodology**. We have not independently reproduced any of them.

## The rest of the scoreboard

![Gemini 3.6 Flash evaluation chart: DeepSWE v1.1, MLE-Bench, GDPval-AA v2 and OSWorld-Verified, each comparing Gemini 3.1 Pro, 3.5 Flash and 3.6 Flash](/blog-assets/gemini-3-6-flash-evals.webp)

*Figure by Google, reproduced from its announcement post [Introducing Gemini 3.6 Flash, 3.5 Flash-Lite, and 3.5 Flash Cyber](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/) (July 21, 2026). All numbers and the evaluation methodology are Google's, not ours.*

MLE-Bench does not stand alone. Against 3.5 Flash, Google reports:

| Benchmark        | What it measures                  | 3.5 Flash | 3.6 Flash |
| ---------------- | --------------------------------- | --------: | --------: |
| MLE-Bench        | Machine-learning engineering      |     49.7% |     63.9% |
| DeepSWE v1.1     | Long-horizon software engineering |       37% |       49% |
| GDPval-AA v2     | Knowledge work                    |      1349 |      1421 |
| OSWorld-Verified | Computer use                      |     78.4% |     83.0% |

The three supporting rows are the ones an ML-engineering loop actually leans on. Long-horizon software engineering is how the agent edits the training config, the dataset builder and the serving flags without thrashing — Google attributes the DeepSWE jump to "higher precision with fewer unwanted code edits and reduced execution loops", the failure mode anyone who has watched an agent churn through a repository will recognize. Computer use is now a built-in client-side tool in the Gemini API and Gemini Enterprise. And the model ships with enhanced Frontier Safety safeguards for CBRN and cyber-offense misuse that Google says make it "substantially more resistant to jailbreaks" while minimizing refusals for beneficial uses.

## The cheaper leg: fewer tokens, fewer steps, lower price

Google's framing of the release lands squarely on what a harness like this one does all day: "Developers and customers building production AI agents need higher token efficiency, lower latency, and more reliable performance." An agent loop is not one long completion — it is dozens of short round trips, each carrying a tool schema, a growing transcript and a reasoning budget. Efficiency per step is the whole cost model.

Google reports 3.6 Flash consuming **17% fewer output tokens than 3.5 Flash** on the Artificial Analysis Index, with "up to 65%" observed on some benchmarks such as DeepSWE by Datacurve, and says it "takes fewer reasoning steps and tool calls to accomplish multi-step workflows." That efficiency "is also combined with a lower price than 3.5 Flash": **$1.50 per million input tokens and $7.50 per million output tokens**. Google's own conclusion is the one that matters here — the combination "reduces the overall cost per agentic task, making agents more cost-effective to build and run."

Fewer tokens, fewer steps, lower unit price. For a self-improving loop that re-runs a whole benchmark suite on every round, the three compound.

## What ships in PenguinHarness today

One day after the announcement, the catalog carries both generally available models, on two routes each:

| Provider group | Model id                       |   Context | Vision |
| -------------- | ------------------------------ | --------: | ------ |
| Google Gemini  | `gemini-3.6-flash`             | 1,048,576 | yes    |
| Google Gemini  | `gemini-3.5-flash-lite`        | 1,048,576 | yes    |
| OpenRouter     | `google/gemini-3.6-flash`      | 1,048,576 | yes    |
| OpenRouter     | `google/gemini-3.5-flash-lite` | 1,048,576 | yes    |

The Google-endpoint rows are auto-routed by model id, so a `GEMINI_API_KEY` is all they need. The OpenRouter rows carry the OpenAI client type and the gateway's base URL inline, so they need nothing but an OpenRouter key. Either way, the fastest path is the **Models** page in the Web App: find the row, add the key, done. From the CLI it is one command:

```bash
penguin config model add --provider google --model-id gemini-3.6-flash --api-key <your-key>
penguin config model list
```

Two related corrections landed with them. Gemini pricing is now recorded with the vendor's real cache-hit rate rather than the input price repeated into the cache bucket — $0.15 per million cached input tokens for 3.6 Flash, $0.03 for 3.5 Flash-Lite — so the Cost center no longer overstates cache-heavy spend by an order of magnitude. And `google/gemini-3.5-flash` had its context window recorded as 1,000,000; the real figure, on both the gateway and the direct endpoint, is 1,048,576.

### 3.5 Flash-Lite, the fan-out half

The second model in the catalog is aimed at volume rather than depth. Gemini 3.5 Flash-Lite is the fastest model in the 3.5 series as measured by Artificial Analysis, running at **350 output tokens per second**, priced at **$0.30 per million input tokens and $2.50 per million output tokens**. Google positions it for high-throughput work like agentic search and document processing, with configurable thinking levels so the same model can be driven cheap-and-shallow for bulk tasks or pushed higher for multi-step subagent workloads. Computer use is a built-in tool here too.

Against the previous Flash-Lite generation, Google reports Terminal-Bench 2.1 at **54% vs 31%**, long context on GDM-MRCR v2 at **72.2% vs 60.1%**, and GDPval-AA v2 at **1140 vs 642**. On several agentic and coding evals it even passes 3 Flash — SWE-Bench Pro **54.2% vs 49.6%**, OSWorld-Verified **74.0% vs 65.1%**.

That is a very good fit for the subagent pattern PenguinHarness runs on: a capable parent model planning, a cheap fast model fanning out. Google's own post shows the same shape — 3.5 Flash-Lite generating design concepts "alongside 3.6 Flash as the master agent."

The third model in Google's announcement, 3.5 Flash Cyber, is deliberately out of reach: Google says it will be available exclusively to governments and trusted partners through CodeMender, as part of a limited-access pilot program. It is not something PenguinHarness — or anyone else — will be pointing a base URL at.

## The rest of 0.1.1

The Gemini rows are one line of a much larger catalog refresh, and the catalog is one surface of a release that touched most of them.

### Models and core

The SDK moved to **AgentHub 0.4.1**, a type-compatible upgrade whose new supported-model registry — model, base URL and client triples with modalities, context windows and per-million pricing — became the authoritative source for a catalog diff. The catalog grew from 59 to 70 entries: the two Gemini rows above on both routes, Claude Fable 5 and Claude Sonnet 5 on Anthropic, Kimi K3 on Moonshot, Kimi K2.6, Qwen3.6 35B A3B and GLM 5.1 on OpenRouter, and the same three on SiliconFlow. The last three ship unpriced on purpose: no source publishes their rates, and a guessed number is worse than none. Every context window, vision flag and price came from the registry rather than a vendor marketing page.

Three fixes matter if you run agents against local or strict endpoints:

- **Empty tool lists no longer go on the wire.** Strict OpenAI-compatible servers reject `tools: []` outright — vLLM answers `400 … tools must not be an empty array`. Every tool-less request the harness makes (the connectivity probe, session-title generation, the vision describer) used to hit that. The field is now omitted entirely when the list is empty.
- **Max output tokens is a per-model setting.** A 32k-context model served locally would refuse requests because the agent-level default asked for 32,000 output tokens. The Models page and `penguin config model add --max-tokens` now take a per-model cap that applies ahead of the agent default, and out-of-band requests take the smaller of the two.
- **The default system prompt gained guardrails.** Agents that freed a busy port by killing its listener sometimes killed the harness's own services; the prompt now says never kill a process you did not start, and pick another free port instead. On a 401/403 or invalid-key error the agent retries once, then stops and asks you to update the key outside the conversation — secret values do not belong in a chat transcript. Existing agents keep their current prompt; new ones get the rules.

Two runtime settings changed shape. The thinking level moved out of the Models page and into a compact picker next to the model selector in the chat draft (`low` / `medium` / `high` / `xhigh`), writing through to Agent settings so the session created on send uses it. And subagents now inherit the parent session's resolved `(provider, model_id)` pair and effective thinking level instead of falling back to the project default — an explicit pair in the tool call still wins.

### Web App

The chat sidebar now groups conversations **by Workspace** by default, labeled by directory basename, ordered by newest session, with auto-created temp workspaces collapsed into a single group instead of one per session. Groups can be pinned to the top, collapse state persists per Project, sessions created by subagents and scheduled tasks file into their own folders, and each group pages in more sessions on demand rather than fetching an unbounded list. Agent grouping is still one toggle away.

The model dropdown now lists models that actually have a configured key first, with the rest one click below. The collapsed sidebar became a full eight-entry navigation rail with bilingual tooltips (Benchmark was previously missing entirely). Custom provider groups and Agents render initial-letter avatars on a tinted background derived from the name, holding WCAG AA contrast in both themes, so same-named models across groups stop being indistinguishable.

Chat rendering got a pass: links open in a new tab, long URLs and inline code wrap at the container edge without splitting Latin words inside CJK prose, wide tables scroll inside the message instead of widening the page, expanded subagent conversations render below the tool call's own output, and three mobile dropdowns that used to overflow the viewport by up to 143px now stay inside it. The Cost center's daily-token tooltip follows the pointer and shows the cache hit rate; the copy-message task-stats line, previously hardcoded Chinese, now goes through the dictionaries like everything else.

### Skills

Three new skills join the AI App Development group — **vllm**, **ollama** and **llamafactory** — so an agent can stand up and tune the models it builds on, not just call them. Both serving skills share a guided workflow: ask which model to serve, ask which engine the user prefers, serve, verify, then register the endpoint with the CLI. The `penguin-cli` skill (now v5) and `penguin-sdk` carry the hard rule they lean on: configuring Penguin's own model uses the default data root, but models configured for an app under development must go into the app's own project directory. There is a whole [practice post](/blog/natural-language-training-loop) on what changes once an agent holds all three — you stop typing the commands and start describing the outcome.

A fourth skill, **bento-slides**, joins the Office Productivity group: ask for a presentation and the agent authors a real Bento deck — one self-contained `.bento.html` whose document is JSON — mapping your material onto charts, morph transitions and state slides instead of a wall of bullets. It is adapted, with attribution, from the Bento project's own MIT-licensed skill.

`agenthub-models` tracks the 0.4.1 upgrade: the new supported-model registry, the config parameters a client may now reject outright, and the Gemini 3.6 / Kimi K3 / GLM-5.2 families with their reasoning-effort knobs.

### Sites, docs and tooling

The docs and landing navbars are now literally the same layout — same container width, same logo block, same right cluster — after drifting apart into two near-identical implementations. The blog gained the **Tech practice** category, pinned posts, and per-post metadata (locale-formatted date, author line, copy-link button). Both READMEs and the landing page now list the built-in Skills where people actually look for them.

The README roadmap gained two items — Agent company and templates, and company-level self evolving — and the self-improvement example under `examples/` was reworked into two runnable scripts that let a local open-weight model score itself, edit its own files and re-run, instead of a fixed illustrative transcript. On the hardening side, the server now validates paging and date query parameters instead of trusting them, and two previously uncovered core modules picked up unit tests.

Upgrading is now one command. `penguin update` resolves the newest release, tells you exactly what it is about to do, and upgrades in place using the mechanism your install actually came from — re-running the official installer for a tarball install (keeping your install dir and your choice of bundled runtime), or the right global install for an npm/pnpm/yarn/bun one. It refuses to touch a source checkout, and it never touches your data dir. `penguin update --check` reports the versions and changes nothing.

## Get it

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```

Then open the Models page, drop in a Gemini or OpenRouter key, and pick `gemini-3.6-flash`. The full release notes live in [`changelog/0.1.1/`](https://github.com/Prism-Shadow/penguin-harness/blob/main/changelog/0.1.1/README.md).

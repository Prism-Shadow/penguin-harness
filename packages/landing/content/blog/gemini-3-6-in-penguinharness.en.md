---
title: "Gemini 3.6 Flash and 3.5 Flash-Lite are in PenguinHarness — plus everything else in 0.1.1"
date: 2026-07-22
category: news
excerpt: Google shipped Gemini 3.6 Flash and 3.5 Flash-Lite on July 21. Both are already in the PenguinHarness model catalog — on the Google endpoint and on OpenRouter, with the full 1,048,576-token context and vision. Here is what the new models bring, and the rest of the 0.1.1 release around them.
---

Google announced [Gemini 3.6 Flash, 3.5 Flash-Lite, and 3.5 Flash Cyber](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/) on July 21, 2026. One day later, the first two are in the PenguinHarness model catalog — pick one on the Models page, paste a key, and run. This post covers what the new models actually change for agent workloads, and then walks through the rest of the **0.1.1** release.

## Why the Flash generation matters for an agent harness

Google's framing of the release is aimed squarely at what a harness like this one does all day: "Developers and customers building production AI agents need higher token efficiency, lower latency, and more reliable performance." An agent loop is not one long completion — it is dozens of short round trips, each carrying a tool schema, a growing transcript and a reasoning budget. Efficiency per step is the whole cost model.

That is exactly where Gemini 3.6 Flash claims its gains. Google reports it consumes **17% fewer output tokens than 3.5 Flash** on the Artificial Analysis Index, with "up to 65%" observed on some benchmarks such as DeepSWE by Datacurve — and that it "takes fewer reasoning steps and tool calls to accomplish multi-step workflows." It does that at a **lower price than 3.5 Flash**: $1.50 per million input tokens and $7.50 per million output tokens.

Fewer tokens, fewer steps, lower unit price. For a self-improving loop that re-runs a benchmark suite on every round, all three compound.

![Gemini 3.6 Flash evaluation chart: DeepSWE v1.1, MLE-Bench, GDPval-AA v2 and OSWorld-Verified, each comparing Gemini 3.1 Pro, 3.5 Flash and 3.6 Flash](/blog-assets/gemini-3-6-flash-evals.webp)

*Figure by Google, reproduced from its announcement post [Introducing Gemini 3.6 Flash, 3.5 Flash-Lite, and 3.5 Flash Cyber](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/) (July 21, 2026). All numbers and the evaluation methodology are Google's, not ours.*

The quality story travels with the efficiency story rather than against it. Against 3.5 Flash, Google reports:

| Benchmark        | What it measures                  | 3.5 Flash | 3.6 Flash |
| ---------------- | --------------------------------- | --------: | --------: |
| DeepSWE v1.1     | Long-horizon software engineering |       37% |       49% |
| MLE-Bench        | Machine-learning engineering      |     49.7% |     63.9% |
| GDPval-AA v2     | Knowledge work                    |      1349 |      1421 |
| OSWorld-Verified | Computer use                      |     78.4% |     83.0% |

Google attributes the DeepSWE jump to "higher precision with fewer unwanted code edits and reduced execution loops" — the failure mode anyone who has watched an agent thrash through a repository will recognize. Computer use is now a built-in client-side tool in the Gemini API and Gemini Enterprise, and the model ships with enhanced Frontier Safety safeguards for CBRN and cyber-offense misuse that Google says make it "substantially more resistant to jailbreaks" while minimizing refusals for beneficial uses.

## 3.5 Flash-Lite: the cheap, fast half of the pair

Gemini 3.5 Flash-Lite is the other half, and it is aimed at volume: it is the fastest model in the 3.5 series, running at **350 output tokens per second** as measured by Artificial Analysis, priced at **$0.30 per million input tokens and $2.50 per million output tokens**. Google positions it for high-throughput work like agentic search and document processing, with configurable thinking levels so the same model can be driven cheap-and-shallow for bulk tasks or pushed to a higher thinking level for multi-step subagent workloads. Computer use is a built-in tool here too.

Against the previous Flash-Lite generation, Google reports Terminal-Bench 2.1 at **54% vs 31%**, long context on GDM-MRCR v2 at **72.2% vs 60.1%**, and GDPval-AA v2 at **1140 vs 642**. On several agentic and coding evals it even passes 3 Flash — SWE-Bench Pro **54.2% vs 49.6%**, OSWorld-Verified **74.0% vs 65.1%**.

That combination is a very good fit for the subagent pattern: a capable parent model planning, a cheap fast model fanning out. Google's own post shows the same shape, with 3.5 Flash-Lite working "alongside 3.6 Flash as the master agent."

The third model in Google's announcement, 3.5 Flash Cyber, is deliberately out of reach: Google says it will be available exclusively to governments and trusted partners through CodeMender, as part of a limited-access pilot program. It is not something PenguinHarness — or anyone else — will be pointing a base URL at.

## What you get in PenguinHarness today

Both models are catalog entries in 0.1.1, on two routes:

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

Three new skills join the AI App Development group — **vllm**, **ollama** and **llamafactory** — so an agent can stand up and tune the models it builds on, not just call them. Both serving skills share a guided workflow: ask which model to serve, ask which engine the user prefers, serve, verify, then register the endpoint with the CLI. The `penguin-cli` skill (now v5) and `penguin-sdk` carry the hard rule they lean on: configuring Penguin's own model uses the default data root, but models configured for an app under development must go into the app's own project directory. There is a whole [practice post](/blog/local-models-and-the-tuning-loop) on using these three end to end.

`agenthub-models` tracks the 0.4.1 upgrade: the new supported-model registry, the config parameters a client may now reject outright, and the Gemini 3.6 / Kimi K3 / GLM-5.2 families with their reasoning-effort knobs.

### Sites, docs and tooling

The docs and landing navbars are now literally the same layout — same container width, same logo block, same right cluster — after drifting apart into two near-identical implementations. The blog gained the **Tech practice** category, pinned posts, and per-post metadata (locale-formatted date, author line, copy-link button). Both READMEs and the landing page now list the built-in Skills where people actually look for them.

The README roadmap gained two items — Agent company and templates, and company-level self evolving — and the self-improvement example under `examples/` was reworked into two runnable scripts that let a local open-weight model score itself, edit its own files and re-run, instead of a fixed illustrative transcript. On the hardening side, the server now validates paging and date query parameters instead of trusting them, and two previously uncovered core modules picked up unit tests.

## Get it

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```

Then open the Models page, drop in a Gemini or OpenRouter key, and pick `gemini-3.6-flash`. The full release notes live in [`changelog/0.1.1/`](https://github.com/Prism-Shadow/penguin-harness/blob/main/changelog/0.1.1/README.md).

---
title: "PenguinHarness 0.1.1: Gemini 3.6 Flash and 3.5 Flash-Lite support"
date: 2026-07-22
category: news
excerpt: Google reports Gemini 3.6 Flash at 63.9% on MLE-Bench, up from 49.7% for 3.5 Flash, at a lower price. PenguinHarness 0.1.1 adds it to the catalog along with 3.5 Flash-Lite. Here is why it matters, and the rest of the release.
---

PenguinHarness 0.1.1 adds Gemini 3.6 Flash and 3.5 Flash-Lite to the model catalog, one day after Google announced them. By Google's numbers, 3.6 Flash scores 63.9% on MLE-Bench against 49.7% for 3.5 Flash, and it costs less. The release also makes max output tokens a per-model setting, corrects Gemini cache pricing, and adds `penguin update` for in-place upgrades.

## Why Gemini 3.6 Flash matters for PenguinHarness

Google announced [Gemini 3.6 Flash, 3.5 Flash-Lite, and 3.5 Flash Cyber](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/) on July 21, 2026. For PenguinHarness, one number in that announcement matters more than the rest: **MLE-Bench, 63.9% against 3.5 Flash's 49.7%**.

MLE-Bench measures machine-learning *engineering*: an agent doing the work of building, training and tuning an ML system, not answering questions about one. Google describes the result as a "significant improvement in ML Research, as seen in MLE Bench (63.9% vs. 49.7%)". That is a 14.2-point gain, the largest of the three percentage-scored panels in Google's chart below, and well above the 42.6% the same chart records for the previous Pro-generation model, 3.1 Pro.

PenguinHarness exists so that agents build agents, faster, better and cheaper. Every loop the product runs is machine-learning engineering in miniature: stand a model up, hand an agent a task, score it against a private rubric, read the failures, tune, redeploy, and measure again. A model that is markedly better at exactly that work, priced in the Flash tier, is the strongest model yet for what this harness does all day.

One caveat applies to every figure below: these are **Google's numbers, from Google's evaluation methodology**. We have not independently reproduced any of them.

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

The other three rows are abilities an ML-engineering loop relies on. Long-horizon software engineering lets the agent edit the training config, the dataset builder and the serving flags without thrashing. Google attributes the DeepSWE jump to "higher precision with fewer unwanted code edits and reduced execution loops". Computer use is now a built-in client-side tool in the Gemini API and Gemini Enterprise.

The model also ships with enhanced Frontier Safety safeguards against CBRN and cyber-offense misuse. Google says these make it "substantially more resistant to jailbreaks" while minimizing refusals for beneficial uses.

## Fewer Tokens, fewer steps, lower price

Google frames the release around what a harness like this one does all day: "Developers and customers building production AI agents need higher token efficiency, lower latency, and more reliable performance." An agent loop is not one long completion. It is dozens of short round trips, each carrying a tool schema, a growing transcript and a reasoning budget, so the efficiency of each step decides the cost.

Google reports that 3.6 Flash uses **17% fewer output Tokens than 3.5 Flash** on the Artificial Analysis Index, with "up to 65%" observed on some benchmarks such as DeepSWE by Datacurve. It also "takes fewer reasoning steps and tool calls to accomplish multi-step workflows."

That efficiency "is also combined with a lower price than 3.5 Flash": **$1.50 per million input Tokens and $7.50 per million output Tokens**. In Google's words, the combination "reduces the overall cost per agentic task, making agents more cost-effective to build and run." For a self-improving loop that re-runs a whole Benchmark suite every round, fewer Tokens, fewer steps and a lower unit price compound.

## The models in PenguinHarness today

One day after the announcement, the catalog carries both generally available models, each on two routes:

| Provider group | Model id                       |   Context | Vision |
| -------------- | ------------------------------ | --------: | ------ |
| Google Gemini  | `gemini-3.6-flash`             | 1,048,576 | yes    |
| Google Gemini  | `gemini-3.5-flash-lite`        | 1,048,576 | yes    |
| OpenRouter     | `google/gemini-3.6-flash`      | 1,048,576 | yes    |
| OpenRouter     | `google/gemini-3.5-flash-lite` | 1,048,576 | yes    |

The Google endpoint rows are routed automatically by model id, so a `GEMINI_API_KEY` is all they need. The OpenRouter rows carry the OpenAI client type and the gateway's base URL inline, so they need only an OpenRouter key.

Either way, the fastest path is the **Models** page in the Web App: find the row and add the key. From the CLI, it is one command:

```bash
penguin config model add --provider google --model-id gemini-3.6-flash --api-key <your-key>
penguin config model list
```

Two related corrections landed with the new rows:

- Gemini pricing now records the vendor's real cache-hit rate instead of repeating the input price in the cache bucket: $0.15 per million cached input Tokens for 3.6 Flash, and $0.03 for 3.5 Flash-Lite. The **Costs** page no longer overstates cache-heavy spend by an order of magnitude.
- `google/gemini-3.5-flash` had its context window recorded as 1,000,000. The real figure, on both the gateway and the direct endpoint, is 1,048,576.

### 3.5 Flash-Lite for fan-out work

The second new model is built for volume rather than depth. As measured by Artificial Analysis, Gemini 3.5 Flash-Lite is the fastest model in the 3.5 series, at **350 output Tokens per second**. It is priced at **$0.30 per million input Tokens and $2.50 per million output Tokens**.

Google positions it for high-throughput work such as agentic search and document processing. Its thinking level is configurable, so the same model can run cheap and shallow for bulk tasks, or higher for multi-step subagent workloads. Computer use is a built-in tool here too.

Against the previous Flash-Lite generation, Google reports Terminal-Bench 2.1 at **54% vs 31%**, long context on GDM-MRCR v2 at **72.2% vs 60.1%**, and GDPval-AA v2 at **1140 vs 642**. On several agentic and coding evals it even passes 3 Flash: SWE-Bench Pro at **54.2% vs 49.6%**, and OSWorld-Verified at **74.0% vs 65.1%**.

That fits the subagent pattern PenguinHarness runs on: a capable parent model plans, and a cheap, fast model fans out. Google's own post shows the same shape, with 3.5 Flash-Lite generating design concepts "alongside 3.6 Flash as the master agent."

The third model in Google's announcement, 3.5 Flash Cyber, is out of reach on purpose. Google says it will be available only to governments and trusted partners through CodeMender, as part of a limited-access pilot program, so it is not in the PenguinHarness catalog.

## The rest of 0.1.1

The Gemini rows are one part of a much larger catalog refresh, and the catalog is one of many areas this release touched.

### Models and core

The SDK moved to **AgentHub 0.4.1**, a type-compatible upgrade. Its new supported-model registry lists model, base URL and client triples with modalities, context windows and per-million pricing, and it became the authoritative source for refreshing the catalog. Every context window, vision flag and price came from the registry rather than a vendor marketing page. The catalog grew from 57 to 70 entries. The new rows are:

- Gemini 3.6 Flash and 3.5 Flash-Lite, on both routes above
- Claude Fable 5 and Claude Sonnet 5 on Anthropic
- Kimi K3 on Moonshot
- Kimi K2.6, Qwen3.6 35B A3B and GLM 5.1 on OpenRouter
- The same three on SiliconFlow

The three SiliconFlow rows have no price on purpose: no source publishes their rates, and a guessed number is worse than none.

Three fixes matter if you run agents against local or strict endpoints:

- **Empty tool lists are no longer sent.** Strict OpenAI-compatible servers reject `tools: []` outright; vLLM answers `400 … tools must not be an empty array`. Every request the harness makes without tools used to hit this: the connectivity probe, Session title generation and the vision describer. The field is now left out entirely when the list is empty.
- **Max output tokens is a per-model setting.** A 32k-context model served locally would refuse requests, because the agent-level default asked for 32,000 output Tokens. The **Models** page and `penguin config model add --max-tokens` now take a per-model cap that applies ahead of the agent default. Out-of-band requests use the smaller of the two.
- **The default system prompt has new guardrails.** Agents that freed a busy port by killing its listener sometimes killed the harness's own services. The prompt now says never to kill a process you did not start, and to pick another free port instead. On a 401, a 403 or an invalid-key error, the agent retries once, then stops and asks you to update the key outside the conversation, because secret values do not belong in a chat transcript. Existing agents keep their current prompt; new agents get the rules.

Two runtime settings changed shape:

- **Thinking level** moved out of the **Models** page into a compact picker next to the model selector in the chat draft (`low` / `medium` / `high` / `xhigh`). It writes through to the agent's settings, so the Session created when you send uses it.
- Subagents now inherit the parent Session's resolved `(provider, model_id)` pair and effective thinking level instead of falling back to the Project default. An explicit pair in the tool call still wins.

### Web App

The chat sidebar now groups conversations by Workspace by default. Each group is labeled with its directory name and ordered by newest Session, and auto-created temporary Workspaces share a single group instead of getting one each. You can pin groups to the top, and collapse state is saved per Project. Sessions created by subagents and scheduled tasks go into their own folders, and each group loads more Sessions on demand instead of fetching an unbounded list. Grouping by agent is still one toggle away.

The model dropdown now lists models that have a configured key first, with the rest one click below. The collapsed sidebar is now a full eight-entry navigation rail with bilingual tooltips; before, it had no Benchmark entry at all. Custom provider groups and agents show initial-letter avatars on a background tinted by their id, with WCAG AA contrast in both themes, so same-named models in different groups are no longer indistinguishable.

Chat rendering got a pass:

- Links open in a new tab.
- Long URLs and inline code wrap at the container edge, without splitting Latin words inside CJK text.
- Wide tables scroll inside the message instead of widening the page.
- Expanded subagent conversations render below the tool call's own output.
- Three mobile dropdowns that overflowed the viewport by up to 143px now stay inside it.

The daily Token tooltip on the **Costs** page follows the pointer and shows the cache hit rate. The task-stats line added when you copy a message was hardcoded in Chinese; it now goes through the dictionaries like everything else.

### Skills

Three new Skills join the AI App Development group: `vllm`, `ollama` and `llamafactory`. With them, an agent can stand up and tune the models it builds on, not just call them. The two serving Skills share a guided workflow: ask which model to serve, ask which engine you prefer, serve it, verify it, then register the endpoint with the CLI.

The `penguin-cli` Skill (now v5) and `penguin-sdk` carry the hard rule the serving Skills rely on: configuring Penguin's own model uses the default data root, but models configured for an app under development must go into that app's own project directory. A separate [practice post](/blog/natural-language-training-loop) covers what changes once an agent holds all three: you stop typing the commands and start describing the outcome.

A fourth Skill, `bento-slides`, joins the Office Productivity group. Ask for a presentation, and the agent authors a real Bento deck: one self-contained `.bento.html` file whose document is JSON, mapping your material onto charts, morph transitions and state slides instead of a wall of bullets. It is adapted, with attribution, from the Bento project's own MIT-licensed skill.

`agenthub-models` tracks the 0.4.1 upgrade: the new supported-model registry, the config parameters a client may now reject outright, and the Gemini 3.6, Kimi K3 and GLM-5.2 families with their reasoning-effort settings.

### Sites, docs and tooling

The docs site and the landing page now share one navbar layout, with the same container width, logo block and right-hand cluster, after drifting apart into two near-identical implementations. The blog gained the **Tech practice** category, pinned posts, and per-post metadata: a date formatted for your language, an author line and a copy-link button. Both READMEs and the landing page now list the built-in Skills where people look for them.

The README roadmap gained two items: agent company and templates, and company-level self evolving. The self-improvement example under `examples/` is now two runnable scripts in which a local open-weight model scores itself, edits its own files and re-runs, replacing a fixed illustrative transcript. The server now validates paging and date query parameters instead of trusting them.

## Upgrading

Upgrading is now one command. `penguin update` resolves the newest release, tells you exactly what it is about to do, and upgrades in place with the same mechanism you installed with:

- For a tarball install, it re-runs the official installer, keeping your install directory and your choice of bundled runtime.
- For an npm, pnpm, yarn or bun global install, it runs the matching global install.

It refuses to touch a source checkout, and it never touches your data directory. `penguin update --check` reports the versions and changes nothing.

## Get it

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```

Then open the **Models** page, add a Gemini or OpenRouter key, and pick `gemini-3.6-flash`. The full release notes are in [`changelog/0.1.1/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.1.1).

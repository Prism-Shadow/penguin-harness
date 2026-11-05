---
title: "Introducing PenguinHarness: agents that build agents"
date: 2026-07-17
category: news
pinned: true
excerpt: Our GDPevo Benchmark showed that agents can evolve themselves. PenguinHarness brings that to everyone as an open-source harness with recursive self-improvement, covering everything from building an agent in one sentence to improving it continuously.
---

> Written for PenguinHarness 0.1.0. Later releases may differ in some details.

Today we are releasing **PenguinHarness**, an open-source harness for building and evolving agents. It gives you a zero-code CLI and Web App, connected to 1000+ models. The idea behind it fits in one line:

> With LangChain, you build agents by hand — at 1× speed. With PenguinHarness, agents build agents — at 100×.

## Why we built PenguinHarness

Before PenguinHarness, our team published the [GDPevo Benchmark](https://prism-shadow.github.io/GDPevo/). In GDPevo we systematically verified one thing: **agents can self-evolve**. An agent can score its own performance, find where it lost points, rewrite its own prompts and Skills, and score higher with each version.

With that proven, the question became how everyone gets to use it. Self-evolution should not stay a curve in a paper; it should be infrastructure that works out of the box for every developer. Bringing an efficient self-improving harness to everyone is why we built PenguinHarness, and the goal is in the name: Efficient Self-Improving Harness for Everyone.

## Better on complex tasks, at lower cost

PenguinHarness uses a deliberately minimal toolset over clean low-level interfaces, so it makes fewer tool calls and spends fewer Tokens. It is tuned in depth for open models such as DeepSeek.

We compared it head to head with Claude Code and OpenAI Codex on two suites. Each harness runs the model it is normally paired with, so the comparison shows the products as people actually use them.

![Benchmark results: PenguinHarness leads the data-analysis suite and ties OpenAI Codex on coding, at a small fraction of either rival's cost](/blog-assets/benchmark-light.svg)

### Complex data analysis

15 tasks, one run each. PenguinHarness and OpenAI Codex ran at thinking level `xhigh`, Claude Code at `max`.

| Framework      | Model           | Accuracy (%) | Tokens (M) | Cost ($) |
| -------------- | --------------- | -----------: | ---------: | -------: |
| PenguinHarness | DeepSeek V4 Pro |        66.67 |      18.04 |     0.55 |
| Claude Code    | Claude Opus 4.8 |        53.33 |      22.20 |    38.48 |
| OpenAI Codex   | GPT-5.5         |        53.33 |      13.72 |    19.41 |

### Coding

40 tasks × 2 runs; accuracy is over all 80 outcomes.

| Framework      | Model           | Accuracy (%) | Tokens (M) | Cost ($) |
| -------------- | --------------- | -----------: | ---------: | -------: |
| PenguinHarness | DeepSeek V4 Pro |        71.25 |     200.00 |     3.81 |
| Claude Code    | Claude Opus 4.8 |        86.25 |     151.61 |   146.97 |
| OpenAI Codex   | GPT-5.5         |        71.25 |     251.20 |   220.08 |

Tokens and cost are totals for the whole suite, not per-run means. On data analysis, PenguinHarness has the highest accuracy of the three, 66.67% against 53.33% for both others, while spending 1/35 of what Codex spent and 1/70 of what Claude Code spent. On coding, it ties Codex at 71.25% and trails Claude Code's 86.25%, but the whole suite cost $3.81, against $220.08 for Codex and $146.97 for Claude Code. The work is comparable, and the bills are one to two orders of magnitude apart.

## Build an agent app from one sentence

Type one sentence, and an agent builds the complete agent application for you, end to end: scaffold, code and run instructions. For example:

```text
Collect the docs from https://github.com/ericbuess/claude-code-docs and build a RAG app that answers Claude Code questions as a configuration expert, citing its sources.
```

The finished product is a docs expert with retrieval, cited sources that link to the original files, and built-in example questions:

![The generated RAG app: a Claude Code docs expert answering with cited, clickable sources and example questions](/blog-assets/rag-app-en-light.webp)

Generating the entire RAG app used $0.02 (¥0.2) of Tokens on DeepSeek V4 Pro.

## Self-evolution: better with use

With the PenguinHarness Skills, an agent evaluates and optimizes itself. In each round:

1. The Optimizer runs several Evaluators in parallel to score the agent.
2. It uses the scores and the run Traces to find where points were lost.
3. It upgrades the agent from version N to N+1.

A snapshot is taken before every round, and every request can be replayed on the **Trajectory** page. A demo video of self-evolution is coming soon.

## Evolution within bounds, security first

The biggest worry about self-evolution is losing control. PenguinHarness answers it with a contract, CONTRACT.md:

- Evolution is strictly confined to the Workspace and Skills. The harness core, which is the security boundary, is never modified.
- Tool calls require approval first, and every approval leaves an audit record.
- A version snapshot is taken before any risky change, so any round of evolution can be rolled back.
- PenguinHarness is fully open source and deployed locally, so your data stays on your machine, apart from the requests sent to the model provider you configure. This meets enterprise data-security requirements.

## Supported models

PenguinHarness ships with presets for these models:

| Model            | Providers                                                                        |
| ---------------- | -------------------------------------------------------------------------------- |
| DeepSeek V4      | DeepSeek, OpenRouter, Fireworks AI, SiliconFlow, Qwen Token Plan                 |
| Kimi K3          | Moonshot AI, OpenRouter, Qwen Pay-As-You-Go                                      |
| GLM 5.2          | Z.AI, OpenRouter, Fireworks AI, SiliconFlow, Qwen Token Plan, Qwen Pay-As-You-Go |
| Hunyuan 3        | OpenRouter                                                                       |
| Qwen 3.8 Max     | Qwen Token Plan (preview)                                                        |
| GPT 5.5          | OpenAI, OpenRouter                                                               |
| Gemini 3.5 Flash | Google Gemini, OpenRouter                                                        |
| Claude Opus 4.8  | Anthropic, OpenRouter                                                            |

Any OpenAI-protocol endpoint works too: pick a preset above, or point a custom endpoint at any of the 1000+ online and local models.

## What's next

- Public release of the benchmark suite
- A desktop app
- Windows support

## Join the community

A self-improving harness needs a community that improves with it. Come discuss, request features and contribute; opening your first issue is a good way to start.

- [Discord](https://discord.gg/eFHKqqcU3D): chat with us and other developers in real time.
- [X (Twitter)](https://x.com/code_hiyouga): follow the latest updates.
- [WeChat group](https://github.com/Prism-Shadow/penguin-harness-community/blob/main/wechat/group.jpg): discussions in the Chinese community.
- [GitHub](https://github.com/Prism-Shadow/penguin-harness): stars, issues and pull requests are all welcome.

## Get started

1. Install PenguinHarness with one command, then start the Web App. The installer supports Linux and macOS on x64 and arm64, and bundles its own Node runtime.

   ```bash
   curl -fsSL https://penguin.ooo/install.sh | sh
   penguin web        # opens http://127.0.0.1:7364 (first login: admin / penguin-2026, shown on the login page)
   ```

2. Open the **Models** page, add an API key to the DeepSeek or OpenRouter group, and set one of its models as the default.
3. Go back to **Chat** and give the agent its first task, for example "Analyze data.csv and summarize quarterly sales".

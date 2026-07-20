---
title: "Introducing PenguinHarness: agents that build agents"
date: 2026-07-17
category: news
excerpt: We proved agents can self-evolve in our GDPevo Benchmark — now we are bringing that capability to everyone. The first open-source harness with recursive self-improvement is here, covering everything from automatic agent construction to continuous self-evolution.
---

Today we are releasing **PenguinHarness** — an open-source harness built for constructing and evolving agents: a zero-code Harness CLI and Web UI, connected to 1000+ models. The story it tells fits in one line:

> With LangChain, you build agents by hand — at 1× speed. With PenguinHarness, agents build agents — at 100×.

And its purpose is right in the name: Efficient Self-Improving Harness for Everyone.

## From GDPevo to PenguinHarness: why we built this

Before PenguinHarness, our team published the [GDPevo Benchmark](https://prism-shadow.github.io/GDPevo/). In GDPevo we systematically verified one thing: **agents can self-evolve** — an Agent can score its own performance, find where the points were lost, rewrite its own prompts and Skills, and climb version after version.

With the capability proven, the question became: how does everyone get to use it? Self-evolution should not stay a curve in a paper — it should be infrastructure that works out of the box on every developer's desk. **Bringing an efficient self-improving harness to everyone is why we built PenguinHarness.**

## Why PenguinHarness

Over the past year the way agent applications are built has been converging fast: what really decides quality is not a heavyweight framework but a simple, reliable, observable harness. PenguinHarness is rebuilt from the ground up — no dependency on any agent framework, a fully open-source self-developed kernel — and it brings three things to the open-source world first:

- **Simplest Is the Best**: a deliberately minimal toolset over clean low-level interfaces — fewer tool calls, fewer Tokens, complex tasks done efficiently.
- **Harness for Building Agents**: with the PenguinHarness SDK, an Agent builds complete Agent applications for you, autonomously, from scratch.
- **Harness for Recursive Self-Improvement**: with PenguinHarness Skills, an Agent evaluates and optimizes itself, improving recursively over time.

For the latter two, PenguinHarness is the first open-source implementation in the industry.

## Same model, equal or better quality, lower cost

All runs use the same DeepSeek V4 Pro model, head-to-head against Claude Code and OpenAI Codex on two suites (per-run means below).

![Benchmark: PenguinHarness matches Claude Code on accuracy at lower cost, and beats OpenAI Codex on both suites](/blog-assets/benchmark-light.svg)

Complex data analysis (15 tasks, single run):

| Framework      | Model           | Accuracy (%) | Tokens (M) | Cost ($) |
| -------------- | --------------- | -----------: | ---------: | -------: |
| PenguinHarness | DeepSeek V4 Pro |         66.7 |      18.04 |    0.552 |
| Claude Code    | DeepSeek V4 Pro |         66.7 |      21.17 |    0.641 |
| OpenAI Codex   | DeepSeek V4 Pro |         46.7 |      13.36 |    0.427 |

Coding tasks (40 tasks × 2 runs averaged, thinking high, 30-minute per-task timeout, CNY pricing converted at $1 = ¥7):

| Framework      | Model           | Accuracy (%) | Tokens (M) | Cost ($) |
| -------------- | --------------- | -----------: | ---------: | -------: |
| PenguinHarness | DeepSeek V4 Pro |        50.00 |       2.10 |    0.041 |
| Claude Code    | DeepSeek V4 Pro |        48.75 |       2.00 |    0.048 |
| OpenAI Codex   | DeepSeek V4 Pro |        42.50 |       2.65 |    0.043 |

On the data-analysis suite we tie Claude Code on accuracy and clearly beat OpenAI Codex, with 14.8% fewer Tokens and 13.8% lower cost; on the coding suite we score the highest accuracy of the three at the lowest per-run cost.

## One sentence, and an Agent builds your Agent app

Type one sentence, and an Agent builds the complete Agent application for you — scaffold, code, and run instructions, end to end:

```text
Build a RAG app that answers questions over the Markdown files in docs/ with citations.
```

![One sentence in, a working RAG app out: scaffold, retrieval entry with citations, and run instructions](/blog-assets/rag-demo-light.webp)

A self-evolution demo video is coming soon.

## Evolution within bounds, security first

The biggest worry about self-evolution is losing control. PenguinHarness answers with a contract (CONTRACT.md):

- Evolution is strictly confined to Workspace and Skills — the harness core security boundary is never modified;
- Tool calls require approval first, and every approval leaves an audit record;
- Risky changes are preceded by version snapshots, so any round of evolution can be rolled back;
- Fully open source and locally deployed — data never leaves your machine, meeting enterprise data-security requirements.

## Supported models

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

Any OpenAI-protocol endpoint is supported: pick a preset above, or point a custom endpoint at any of the 1000+ online and local models.

## Start right now

Install with one command (Linux / macOS, x64 / arm64, bundled Node runtime):

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
```

Configure a model (DeepSeek as the example) and run your first task, or open the desktop-grade Web UI with `penguin web`:

```bash
penguin config model add --model-id deepseek-v4-pro --api-key sk-your-key --set-default
penguin run --approve allow-all --message "Analyze data.csv and summarize quarterly sales"
penguin web
```

PenguinHarness supports 1000+ online and local models and multi-agent collaborative evolution, and runs on as little as a single CPU. Through continuous evolution it makes complex AI development ever simpler — a more efficient, more reliable, lower-hallucination and lower-cost Agent productivity engine.

## What's next

- Public release of the benchmark suite;
- A desktop app;
- Windows support;
- More to come.

## Join the community and build with us

A self-improving harness needs a community that improves with it. Come discuss, request, and contribute — your first Issue is the best way to start:

- [Discord](https://discord.gg/eFHKqqcU3D): chat with us and other developers in real time;
- [X (Twitter)](https://x.com/code_hiyouga): follow the latest updates;
- [WeChat group](https://github.com/Prism-Shadow/penguin-harness-community/blob/main/wechat/group.jpg): Chinese community discussions;
- [GitHub](https://github.com/Prism-Shadow/penguin-harness): stars, Issues, and PRs all welcome.

Self-evolving agent infrastructure, for everyone — starting today.

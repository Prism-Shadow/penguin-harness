---
title: "Introducing PenguinHarness: agents that build agents"
date: 2026-07-17
category: news
excerpt: The first open-source harness with recursive self-improvement is here — lightweight, efficient and secure infrastructure covering everything from automatic agent construction to continuous self-evolution.
---

Today we are releasing **PenguinHarness** — an open-source harness built for constructing and evolving agents. Its purpose fits in one line:

> Efficient Self-Improving Harness for Everyone.

## Why PenguinHarness

Over the past year the way agent applications are built has been converging fast: what really decides quality is not a heavyweight framework but a simple, reliable, observable harness. PenguinHarness is rebuilt from the ground up — no dependency on any agent framework, a fully open-source self-developed kernel — and it brings three things to the open-source world first:

- **Simplest Is the Best**: a deliberately minimal toolset over clean low-level interfaces — fewer tool calls, fewer Tokens, complex tasks done efficiently.
- **Harness for Building Agents**: with the PenguinHarness SDK, an Agent builds complete Agent applications for you, autonomously, from scratch.
- **Harness for Recursive Self-Improvement**: with PenguinHarness Skills, an Agent evaluates and optimizes itself, improving recursively over time.

For the latter two, PenguinHarness is the first open-source implementation in the industry.

## Same model, equal or better quality, lower cost

All runs use the same DeepSeek V4 Pro model, head-to-head against Claude Code and OpenAI Codex on two suites (per-run means below).

Complex data analysis (15 tasks, single run):

| Framework | Model | Accuracy (%) | Tokens (M) | Cost ($) |
| --- | --- | ---: | ---: | ---: |
| PenguinHarness | DeepSeek V4 Pro | 66.7 | 18.04 | 0.552 |
| Claude Code | DeepSeek V4 Pro | 66.7 | 21.17 | 0.641 |
| OpenAI Codex | DeepSeek V4 Pro | 46.7 | 13.36 | 0.427 |

Coding tasks (40 tasks × 2 runs averaged, thinking high, 30 min per-case timeout, CNY pricing converted at $1 = ¥7):

| Framework | Model | Accuracy (%) | Tokens (M) | Cost ($) |
| --- | --- | ---: | ---: | ---: |
| PenguinHarness | DeepSeek V4 Pro | 50.00 | 2.10 | 0.041 |
| Claude Code | DeepSeek V4 Pro | 48.75 | 2.00 | 0.048 |
| OpenAI Codex | DeepSeek V4 Pro | 42.50 | 2.65 | 0.043 |

On the data-analysis suite PenguinHarness ties Claude Code on accuracy and clearly beats OpenAI Codex while using 14.8% fewer Tokens at 13.8% lower cost; on the coding suite it scores highest of the three at the lowest per-run cost.

## Evolution within bounds, security first

The biggest worry about self-improvement is losing control. PenguinHarness answers with a contract — CONTRACT.md:

- Evolution is strictly confined to Workspace and Skills; the harness core security boundary is never modified.
- Tool calls run only after approval, and every approval is audited.
- Risky changes snapshot first — every step of evolution can be rolled back.
- Fully open source and locally deployable: data never leaves your machine, meeting enterprise security requirements.

## Get started now

Install with one command (Linux / macOS, x64 / arm64, bundled Node runtime):

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
```

Configure a model (DeepSeek as an example), run your first task, or open the desktop-grade web interface with `penguin web`:

```bash
penguin config model add --model-id deepseek-v4-pro --api-key sk-your-key --set-default
penguin run --approve allow-all --message "Analyze data.csv and summarize quarterly sales"
penguin web
```

PenguinHarness supports 1000+ online and local models and multi-agent collaborative evolution, and runs on as little as a single CPU. Through continuous evolution it makes complex AI development ever simpler — a more efficient, more reliable, lower-hallucination and lower-cost Agent productivity engine.

Follow us on [GitHub](https://github.com/Prism-Shadow/penguin-harness) and open your first issue.

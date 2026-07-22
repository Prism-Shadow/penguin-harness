---
title: "Simple Harness Is All You Need"
date: 2026-07-22
category: practice
excerpt: Databricks benchmarked coding agents against real pull requests from its own multi-million-line codebase. The best score on the entire board did not belong to the most capable harness — it belonged to the simplest one, at roughly half the cost. Here is why context discipline beats feature count, and how PenguinHarness is built around that bet.
---

You would expect a feature-rich agent harness to beat a minimal one. More tools, more context, more scaffolding, better decisions. That is the intuition the entire category was built on.

Databricks tested it against real work — roughly a hundred pull requests pulled from their own multi-million-line production monorepo, graded by restoring the held-out tests and running them. Here is the result:

![Databricks' Pareto chart: pass-rate against cost per task. The frontier is dominated by the minimal Pi harness, and the highest score on the chart is Opus 4.8 on Pi](/blog-assets/databricks-pareto.png)

_Pass-rate against cost per task. Red points form the Pareto frontier. Source: [Databricks](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase)._

Read the top of that chart carefully, because it is the opposite of what the intuition predicts. **The single highest pass-rate — about 90% — belongs to Opus 4.8 running on [Pi](https://github.com/earendil-works/pi), a harness whose entire core is read, write, edit, and a shell.** The same model on Claude Code at maximum effort scores slightly lower, at roughly twice the cost per task. And of the points on the Pareto frontier, most are Pi.

The minimal harness did not merely hold its own on price. **At the top of the board, it won.**

Databricks were careful not to overclaim, and so are we: their stated lesson is not that one harness is always cheaper or that vendor harnesses are worse. The chart backs that caution up — Opus on Pi at `max` effort lands around 81%, well below Claude Code at comparable spend. Simplicity is not a guarantee. But the direction is unmistakable, and their explanation of the mechanism is a single sentence:

> "Pi sent about 3x less context per turn. It managed context better, keeping a tighter working set and finishing the tasks in fewer runs."

One more detail worth noting, since it is rarer than it should be: they refused to grade with a model, on the grounds that doing so "rewards sounding right over being right."

## 1. A harness is an information budget

A model is a function behind an API. It receives a system prompt, tool definitions, and a message history; it returns text and tool calls. That contract is fixed and public. **Everything else — every piece of software deciding what goes into that request — is the harness.**

Which means a harness only ever makes one kind of decision: what occupies the finite context window. It is not a feature list. It is a budget, spent on the model's behalf, on every single turn.

That reframing explains the chart immediately. Two harnesses calling the same model are not running different intelligence. They are running different budgets — and the one that spent less scored higher.

## 2. Where the weight accumulates

Context bloat is never one bad decision. It is four defensible ones, compounding every turn.

**The tool surface.** Every tool costs its name, description, and full JSON Schema in *every* request. Thirty tools is not thirty conveniences — it is a permanent tax plus a wider decision space to get lost in. And the marginal ones usually re-implement something a shell already does.

**Tool output.** A dependency install dumps thousands of lines. That output is not billed once; it becomes history and gets resent every subsequent turn. Uncapped output is the fastest way to turn a cheap task into an expensive one.

**The system prompt.** Long behavioral rulebooks encode judgment the model already has. Telling a frontier model not to hardcode credentials spends tokens restating its training. Worse, over-specification implies the model is not trusted to reason — which makes it hesitant precisely in the cases the rules failed to anticipate.

**Per-turn injections.** Environment snapshots, status blocks, re-sent config files, stapled onto every message. Individually tiny, structurally permanent.

None of these are wrong ideas. They are unpriced ones.

## 3. How PenguinHarness is built

We made this bet before the benchmark existed, and it is visible in the source rather than the marketing. Every number below is checkable in the repo.

**Six tools, and no file tools at all.** PenguinHarness ships [six built-in tools](https://penguin.ooo/docs/tools); any session sees five, since the two image tools are mutually exclusive by model class.

| Tool | Purpose |
| --- | --- |
| `exec_command` | Run a shell command via `bash -lc`, streaming stdout/stderr |
| `input_command` | Drive a running command: write stdin, send Ctrl-C, poll output |
| `run_subagent` / `input_subagent` | Delegate a subtask to a child agent, then poll or follow up |
| `read_image` / `describe_image` | Return an image, or have a vision model describe it in text |

There is no read tool, no write tool, no edit tool, no glob, no grep. Reading, writing, editing and searching all go through the shell, because the shell already does them and the model already knows how. Where a four-tool minimal core spends read, write and edit on the filesystem, **we spend one**. We are not claiming the smallest absolute tool count — Pi's core is tighter by one — but the smallest schema surface for what agents actually do all day.

**A 72-line system prompt.** The default template is 72 lines, about 6,600 characters before substitution ([source](https://github.com/Prism-Shadow/penguin-harness/blob/main/packages/core/src/state/default-config.ts)). Role, success criteria, constraints, stop rules, filesystem layout, a short list of suggested workflows — then it stops.

**Output capped by default.** Every tool call truncates at 16,000 characters, enforced centrally by the Environment. Exit codes are appended *outside* the truncation window, so the line telling the model whether the command succeeded survives even when the middle is cut.

**Skills that cost nothing until used.** There is no skill tool. The prompt carries only each skill's name and one-line description; the body is read on demand with an ordinary shell command. A skill you do not use costs you a single line.

**Compaction into a clean context.** Past 128,000 tokens, the engine summarizes into a `<context_summary>` and continues in a *fresh* context rather than appending to a swollen history — so one trace file is always exactly one model context.

**A clean message protocol.** No environment metadata stapled to user messages. The model receives the conversation: user turns, assistant turns, tool results.

## 4. Why less wins

The intuition that more context means better decisions is not stupid. It is wrong at the margin, for two reasons.

**Attention is a fixed budget that gets divided.** Self-attention weighs every token against every other. Grow a request from 20K to 60K tokens and the decisive parts — the actual error, the actual constraint — hold a smaller share. Five rules that are followed beat fifty that compete; five tools chosen correctly beat thirty that widen the search.

**Redundant instruction costs more than tokens.** Rules restating training data do not add capability, they add the suggestion that judgment is unwanted. The failure mode is not rule-breaking — it is freezing on the case the rules did not cover.

There is a third, practical reason: **portability**. Post-training binds models to the *protocol*, not to a harness. Every serious model trains on the same function-calling contract. From the model's side, a lean harness is just a standard request that happens to be short — which is why several vendors' models plus open-weight GLM all did well through the same minimal wrapper, and why lean designs keep working when you switch models. For a project whose proposition is 1000+ models behind one interface, that is the foundation.

It is also why our own numbers land where they do. On complex data analysis, PenguinHarness on DeepSeek V4 Pro took the highest accuracy of the three harnesses we tested (66.67% against 53.33% for both) at **$0.55** against Claude Code's **$38.48** — roughly 1/70 the bill. On coding we tie Codex at 71.25% and trail Claude Code's 86.25%, but the suite cost **$3.81** against **$220.08** and **$146.97**. We do not claim to beat a frontier model on every axis. We claim the quality gap is one to two orders of magnitude smaller than the price gap.

## 5. What minimalism must not cost

Here is where we part company with minimalism as a philosophy.

Stripping a harness down is easy if you also strip out what makes an autonomous process safe on a real machine. Pi's own README is upfront that it *"does not include a built-in permission system"* and suggests containers instead. Reasonable for a personal CLI. Not a trade an enterprise can make.

We treat safety and observability as load-bearing, and they are cheap in context precisely because they live in the runtime rather than the prompt:

- **Every tool call gets exactly one approval decision**, in one of four modes — allow-all, deny-all, read-only, always-ask. The SDK denies by default when no approver is supplied, so nothing runs unattended by accident.
- **Every decision is audited** to the Trace as an `approval_decision` event.
- **Tools never throw into the engine.** Failures become tool output the model reads and reacts to — which is also why a lean prompt is safe: the environment reports its own errors clearly enough that the prompt does not have to anticipate them.

Zero extra tokens per turn, fully auditable. Discipline in the context window; rigor in the runtime.

## 6. The takeaway

The result worth internalizing is not that simple harnesses are cheaper. It is that at the top of a real benchmark, on real pull requests, **the simplest harness produced the best result** — and did it by sending less.

If you are building agents, the audit is short. How many tools does your model see, and how many re-implement a shell? What is your hard cap on tool output? How many lines of your system prompt teach the model things it learned in pre-training? What gets injected into every message?

Every answer is a line item, charged on every turn, for the life of the task.

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

---

- **Read the internals**: [Tools & Approval](https://penguin.ooo/docs/tools) · [The Agent Loop](https://penguin.ooo/docs/agent-loop) · [Skills](https://penguin.ooo/docs/skills)
- **Come argue with us**: [GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**Sources**: [Databricks — Benchmarking Coding Agents on Databricks' Multi-Million Line Codebase](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase) · [Pi (earendil-works/pi)](https://github.com/earendil-works/pi) · [SaladDay, "Less is More"](https://x.com/Salad95238547/status/2079508549382644194)

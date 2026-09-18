---
title: "Simple Harness Is All You Need"
date: 2026-07-22
category: perspectives
excerpt: Databricks benchmarked coding agents on roughly a hundred real pull requests, and the highest pass rate went to the simplest harness at about half the cost. This essay argues that a harness is an information budget, and shows how PenguinHarness is built around that idea.
---

> Written for PenguinHarness 0.1.1. Later releases may differ in some details.

An **agent harness** is the software around a language model that decides what goes into each request: the system prompt, the tool definitions, and the message history. The common intuition is that a bigger harness makes a better agent. More tools, more context, and more scaffolding should lead to better decisions, and the whole category was built on that belief.

This essay argues the opposite. In a Databricks benchmark on real pull requests, the simplest harness produced the highest score at about half the cost, and Databricks attributes the result to sending less context per turn.

## The evidence: a benchmark on real pull requests

Databricks tested the intuition against real work. It took roughly a hundred pull requests from its own multi-million-line production monorepo, and graded each run by restoring the held-out tests and running them. Here is the result:

![Scatter plot from the Databricks benchmark: pass rate against cost per task for coding agents. Red points mark the Pareto frontier, which is dominated by the minimal Pi harness, and the highest point is Opus 4.8 on Pi](/blog-assets/databricks-pareto.png)

_Pass-rate against cost per task. Red points form the Pareto frontier. Source: [Databricks](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase)._

The top of the chart inverts the intuition. The single highest pass rate, about 90%, belongs to Opus 4.8 running on [Pi](https://github.com/earendil-works/pi), a harness whose entire core is read, write, edit, and a shell. The same model on Claude Code at maximum effort scores slightly lower, at roughly twice the cost per task. Most of the points on the Pareto frontier, the runs that no other run beats on both cost and pass rate, are Pi.

The minimal harness did not merely hold its own on price. At the top of the board, it won.

Databricks is careful not to overclaim, and so are we. Its stated lesson is not that one harness is always cheaper, or that vendor harnesses are worse. The chart supports that caution: Opus on Pi at `max` effort lands around 81%, well below Claude Code at comparable spend. Simplicity is not a guarantee. The direction is still clear, and Databricks explains the mechanism in two sentences:

> "Pi sent about 3x less context per turn. It managed context better, keeping a tighter working set and finishing the tasks in fewer runs."

One choice in the method deserves mention, because few benchmarks make it: Databricks refused to grade with a model, on the grounds that doing so "rewards sounding right over being right."

## A harness is an information budget

A model is a function behind an API. It receives a system prompt, tool definitions, and a message history, and it returns text and tool calls. That contract is fixed and public, so a harness makes exactly one kind of decision: what occupies the model's context window on each turn.

The context window, the text a model can attend to in one request, is finite. Everything a harness does is therefore allocation: it spends a budget on the model's behalf, on every turn. Two harnesses that call the same model are not running different intelligence. They are running different budgets, and in the Databricks data, the one that spent less scored higher.

## Where context weight accumulates

Context bloat is never one bad decision. It is four defensible ones, compounding on every turn.

### The tool surface

Every tool costs its name, description, and full JSON Schema in *every* request. Thirty tools are not thirty conveniences. They are a permanent tax, plus a wider decision space for the model to get lost in. The marginal tools usually re-implement something a shell already does.

### Tool output

A dependency install prints thousands of lines. That output is not billed once: it becomes history and is resent on every later turn. Uncapped output is the fastest way to turn a cheap task into an expensive one.

### The system prompt

Long behavioral rulebooks encode judgment the model already has. Telling a frontier model not to hardcode credentials spends Tokens restating its training. Worse, over-specification implies that the model is not trusted to reason, which makes it hesitant in exactly the cases the rules failed to anticipate.

### Per-turn injections

Environment snapshots, status blocks, and re-sent config files get stapled onto every message. Each one is tiny, but structurally it is permanent.

None of these is a wrong idea. The problem is that nobody puts a price on them.

## How PenguinHarness is built

We made this bet before the benchmark existed, and it shows in the source code rather than in marketing copy. Each detail in this section can be checked in the repository at the `v0.1.1` tag.

### Six tools, and no file tools

PenguinHarness 0.1.1 ships [six built-in tools](https://github.com/Prism-Shadow/penguin-harness/blob/v0.1.1/packages/docs/content/tools.en.md). Any one Session sees five of them, because the two image tools are mutually exclusive by model class.

| Tool | Purpose |
| --- | --- |
| `exec_command` | Run a shell command via `bash -lc`, streaming stdout/stderr |
| `input_command` | Drive a running command: write stdin, send Ctrl-C, poll output |
| `run_subagent` / `input_subagent` | Delegate a subtask to a child agent, then poll or follow up |
| `read_image` / `describe_image` | Return an image, or have a vision model describe it in text |

In 0.1.1 there is no read tool, write tool, edit tool, glob, or grep. Reading, writing, editing, and searching all go through the shell, because the shell already does them and the model already knows how. A four-tool minimal core spends three tools (read, write, and edit) on the filesystem; PenguinHarness spends one. We do not claim the smallest absolute tool count, since Pi's core has one tool fewer. We claim the smallest schema surface for what agents actually do all day.

### A 72-line system prompt

The 0.1.1 default template is 72 lines, about 6,500 characters before placeholder substitution ([source](https://github.com/Prism-Shadow/penguin-harness/blob/v0.1.1/packages/core/src/state/default-config.ts)). It covers the role, success criteria, constraints, stop rules, the filesystem layout, and a short list of suggested workflows. Then it stops.

### Output capped by default

The Environment truncates the output of every tool call at 16,000 characters, in one central place. Exit codes are appended *outside* the truncation window, so the line that tells the model whether the command succeeded survives even when long output is cut.

### Skills that cost one line until used

There is no skill tool. The prompt carries only each Skill's name and one-line description, and the agent reads the body on demand with an ordinary shell command. A Skill that goes unused costs a single line.

### Compaction into a clean context

Past 128,000 Tokens, the engine summarizes the conversation into a `<context_summary>` and continues in a *fresh* context, instead of appending to a swollen history. As a result, one Trace file always holds exactly one model context.

### A clean message protocol

No environment metadata is stapled to user messages. The model receives the conversation itself: user turns, assistant turns, and tool results.

## Why less context wins

The intuition that more context improves decisions is reasonable. It is wrong at the margin for two reasons, and a third, practical reason also favors a lean harness.

The first reason is mechanical: attention is a fixed budget that gets divided. Self-attention weighs every Token against every other. When a request grows from 20K to 60K Tokens, the decisive parts, such as the actual error and the actual constraint, hold a smaller share. Five rules that are followed beat fifty that compete, and five tools chosen correctly beat thirty that widen the search.

The second reason is that redundant instructions cost more than Tokens. Rules that restate training data add no capability; they add the suggestion that judgment is unwanted. The resulting failure is not rule-breaking. It is freezing on a case the rules did not cover.

The third reason is practical: portability. Post-training binds a model to the *protocol*, not to a harness, and every serious model trains on the same function-calling contract. From the model's side, a lean harness is just a standard request that happens to be short. That is why models from several vendors, plus the open-weight GLM, all did well through the same minimal wrapper, and why lean designs keep working when you switch models. For a project that offers 1000+ models behind one interface, portability is the foundation.

The same reasoning explains where our own benchmark numbers land. In those runs, each harness used the model it is normally paired with: DeepSeek V4 Pro on PenguinHarness, Claude Opus 4.8 on Claude Code, and GPT-5.5 on Codex.

- **Complex data analysis.** PenguinHarness had the highest accuracy of the three harnesses we tested, 66.67% against 53.33% for both others. It cost $0.55 against Claude Code's $38.48, roughly 1/70 of the bill.
- **Coding.** PenguinHarness ties Codex at 71.25% and trails Claude Code's 86.25%. The suite cost $3.81, against $220.08 for Codex and $146.97 for Claude Code.

We do not claim to beat a frontier model on every axis. We claim that the quality gap is one to two orders of magnitude smaller than the price gap.

## What minimalism must not cost

This is where we part company with minimalism as a philosophy. A lean context must not come at the cost of what makes an autonomous process safe on a real machine.

Stripping a harness down is easy if you strip out those safeguards too. Pi's own README says plainly that it "does not include a built-in permission system", and suggests containers instead. That is a reasonable trade for a personal CLI. It is not a trade an enterprise can make.

PenguinHarness treats safety and observability as load-bearing. They are cheap in context because they live in the runtime rather than in the prompt:

- Every tool call gets exactly one approval decision, in one of four approval modes: `allow-all`, `deny-all`, `read-only`, or `always-ask`. The SDK denies by default when no approver is supplied, so nothing runs unattended by accident.
- Every decision is audited in the Trace as an `approval_decision` event.
- Tools never throw into the engine. Failures become tool output that the model reads and reacts to. This is also why a lean prompt is safe: the environment reports its own errors clearly enough that the prompt does not have to anticipate them.

None of this adds Tokens to a turn, and every decision stays auditable.

## Conclusion

The result worth internalizing is not that simple harnesses are cheaper. It is that at the top of a real benchmark, on real pull requests, the simplest harness produced the best result, and did so by sending less.

If you build agents, the audit is short:

- How many tools does your model see, and how many of them re-implement a shell?
- What is your hard cap on tool output?
- How many lines of your system prompt teach the model things it learned in pre-training?
- What gets injected into every message?

Each answer is a line item, charged on every turn, for the life of the task. To try PenguinHarness, install it and start the Web App:

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

---

- **Read the internals**: [Tools & Approval](https://penguin.ooo/docs/tools) · [The Agent Loop](https://penguin.ooo/docs/agent-loop) · [Skills & Plugins](https://penguin.ooo/docs/skills)
- **Come argue with us**: [GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**Sources**: [Databricks — Benchmarking Coding Agents on Databricks' Multi-Million Line Codebase](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase) · [Pi (earendil-works/pi)](https://github.com/earendil-works/pi) · [SaladDay, "Less is More"](https://x.com/Salad95238547/status/2079508549382644194)

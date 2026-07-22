---
title: "Simple Harness Is All You Need"
date: 2026-07-22
category: practice
excerpt: Databricks benchmarked coding agents against real pull requests from its own multi-million-line codebase. The most interesting number was not about models — a minimal harness sent roughly a third of the context per turn and finished just as many tasks. Here is why context discipline beats feature count, and how PenguinHarness is built around that bet.
---

Most conversations about agent quality are conversations about models. Pick the stronger model, get the better agent. The evidence that has accumulated over the last few months says something less comfortable: once the model is decent, the wrapper around it decides most of what you pay and a surprising amount of what you get.

The clearest data point so far comes from Databricks. In [Benchmarking Coding Agents on Databricks' Multi-Million Line Codebase](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase), their team ran a head-to-head across several agent harnesses and several models — and found that swapping only the harness, holding the model and the reasoning effort fixed, moved cost per task by more than 2× without moving quality at all.

This post is about why that happens, and what we did about it in PenguinHarness.

## 1. A harness is an information budget

Before the numbers, a definition, because the word gets used loosely.

A model is a function behind an API. It receives a system prompt, a set of tool definitions, and a message history; it returns text and tool calls. That contract is fixed and public. Everything else — every piece of software that decides *what goes into that request* — is the harness.

So a coding-agent harness really has three jobs:

- **Compose the context.** Write the system prompt; decide what the model sees each turn.
- **Expose the tools.** Define the actions available, and their schemas.
- **Manage the history.** Decide what is kept verbatim, what is summarized, and what is thrown away.

Notice that all three are the same kind of decision: what occupies the finite context window. A harness is not a feature list. It is an information budget, spent on the model's behalf, on every single turn.

That framing explains the Databricks result immediately. Two harnesses calling the same model are not running different intelligence — they are running different budgets.

## 2. The evidence

Databricks built the benchmark the expensive, honest way. They pulled roughly a hundred real pull requests from their own production monorepo, spanning ten-plus languages including Scala, Rust, TypeScript, Go, Bazel and Protobuf, and kept only self-contained changes with real test coverage. Grading was mechanical: let the agent declare it is done, restore the held-out tests, run them.

Their note on why they refused the fashionable alternative deserves quoting in full:

> "We did _not_ use an LLM judge to evaluate correctness, since we've found that this rewards sounding right over being right."

Two findings matter here.

**Harness choice is a cost lever comparable to model choice.** In their words:

> "When we ran the same model with the same thinking effort through two different harnesses (Claude Code/Codex vs Pi), we observed that the cost per task differed significantly (more than 2x in some cases), while quality remained the same."

**And the mechanism was context volume, not cleverness:**

> "Pi sent about 3x less context per turn. It managed context better, keeping a tighter working set and finishing the tasks in fewer runs."

[Pi](https://github.com/earendil-works/pi) is an MIT-licensed agent toolkit whose coding CLI is built on a deliberately small core — read, write, edit, and a shell. It is not more capable than a vendor harness. It is more disciplined, and on this benchmark discipline was worth more than capability.

Databricks were careful not to overclaim, and so are we: *"The lesson here isn't that one harness is always cheaper or that native harnesses are worse."* A feature-rich harness buys real things. The point is that those features are not free, they are billed per turn, and most teams have never looked at the invoice.

A [teardown by SaladDay](https://x.com/Salad95238547/status/2079508549382644194) took this further, reading the two designs side by side and framing them as opposing bets: maximize the information the model receives, or curate it. It is a good frame, and it is the one we designed against.

## 3. Where the weight actually accumulates

Context bloat is rarely one bad decision. It is four small ones, each defensible alone, compounding every turn.

**The tool surface.** Every tool costs its name, description, and full JSON Schema in *every* request. Thirty tools is not thirty conveniences — it is a permanent tax plus a wider decision space to get lost in. And the marginal tools tend to be the ones re-implementing things a shell already does.

**Tool output.** A dependency install dumps thousands of lines. That output is not billed once — it becomes history, and gets resent on every subsequent turn. Uncapped output is the single fastest way to turn a small task into an expensive one.

**The system prompt.** Long behavioral rulebooks encode judgment the model already has. Telling a frontier model not to hardcode credentials spends tokens restating its training. Worse, over-specification carries an implicature: exhaustive rules suggest the model is not trusted to reason, which makes it more hesitant precisely in the situations the rules failed to anticipate.

**Per-turn injections.** Environment snapshots, status blocks, and re-sent configuration files stapled onto every message. Individually tiny, structurally permanent.

None of these are wrong ideas. They are just unpriced ones.

## 4. How PenguinHarness is built

We made the minimal bet before this benchmark existed, and it is visible in the source rather than in marketing copy. Every number below is checkable in the repo.

### Six tools, and no file tools at all

PenguinHarness ships **six** built-in tools ([reference](https://penguin.ooo/docs/tools)), and any given session sees five of them — the two image tools are mutually exclusive, selected by whether the model has vision.

| Tool | Purpose |
| --- | --- |
| `exec_command` | Run a shell command via `bash -lc`, streaming stdout/stderr |
| `input_command` | Drive a running command: write stdin, send Ctrl-C, poll output |
| `run_subagent` | Delegate a self-contained subtask to a child agent |
| `input_subagent` | Poll a background subagent, or send it a follow-up |
| `read_image` | Return an image as image content (vision models) |
| `describe_image` | Have the configured vision model describe it in text (text-only models) |

There is no read tool, no write tool, no edit tool, no glob, no grep. Reading, writing, editing, and searching all go through the shell, because the shell already does them and the model already knows how.

That is the sharpest way to state our position. Where a four-tool "minimal core" spends read, write, and edit on the filesystem, we spend one — `exec_command`. Our remaining budget goes to capabilities a shell genuinely cannot provide: driving an interactive process, delegating to a subagent, and handling images.

| Harness | Filesystem + shell | Total exposed to the model |
| --- | --- | --- |
| PenguinHarness | 1 (`exec_command`) | 5 per session (6 defined) |
| Pi | 4 (read, write, edit, bash) | 4-tool core |
| Typical vendor coding agents | Separate read/write/edit/glob/grep tools | Dozens, plus MCP servers |

We are not claiming the smallest tool count in absolute terms — Pi's core is tighter by one. We are claiming the smallest *schema surface for the thing agents actually do all day*, which is touching files and running commands.

### A 72-line system prompt

The default system prompt template is **72 lines, about 6,600 characters** before substitution ([`packages/core/src/state/default-config.ts`](https://github.com/Prism-Shadow/penguin-harness/blob/main/packages/core/src/state/default-config.ts)). It covers role, success criteria, hard constraints, stop rules, filesystem layout, and a short list of suggested workflows — and then stops. It does not restate what a competent model already knows.

### Output caps by default

Every tool call is truncated at `maxOutputLength`, **16,000 characters by default**, and the cap is enforced centrally by the Environment rather than left to each tool. Terminal markers like exit codes are appended *outside* the truncation window, so the one line that tells the model whether the command succeeded survives even when the middle of the output does not.

### Skills that cost nothing until used

Skills are reusable instruction packages, and there is **no skill tool**. The system prompt carries only each installed skill's name and one-line description; the body is read on demand with an ordinary shell command ([docs](https://penguin.ooo/docs/skills)). A skill you do not use this session costs you a single line.

### Compaction that ends with a clean context

Past a context threshold (**128,000 tokens** by default), the engine summarizes the transcript into a `<context_summary>` and continues in a **fresh** model context rather than appending a summary to an already-swollen history. Each trace file therefore corresponds to exactly one model context, which also makes the whole thing auditable after the fact ([agent loop](https://penguin.ooo/docs/agent-loop)).

### A clean message protocol

We do not staple environment metadata to user messages. The model receives the conversation: user turns, assistant turns, tool results. System-synthesized records exist — for interrupts, transport retries, and compaction — but they are three explicitly documented markers, not an ambient stream of injected status.

## 5. Why less wins

The intuition that more context means better decisions is not stupid. It is just wrong at the margin, for two reasons.

**Attention is a fixed budget, and it gets divided.** Self-attention weighs every token against every other token. Grow a request from 20K to 60K tokens and the genuinely decisive parts — the actual error message, the user's actual constraint — hold a smaller share of the model's attention. Five rules that are followed beat fifty that compete. Five tools that are chosen correctly beat thirty that widen the search.

**Redundant instruction has a cost beyond tokens.** Rules that restate training data do not add capability; they add the suggestion that judgment is not wanted. The failure mode is not that the model breaks the rules — it is that it freezes when it hits a case the rules do not cover.

There is a third, more practical reason: **portability**. Post-training binds models to the *protocol*, not to a harness. Every serious model is trained on the same function-calling contract — JSON Schema in, structured calls out. From the model's side, a lean harness is simply a standard request that happens to be short. That is why the benchmark showed several vendors' models, plus open-weight GLM, all performing well through the same minimal wrapper — and why a lean design is the one most likely to keep working when you switch models. For a project whose value proposition is 1000+ models behind one interface, that is not a nice-to-have.

It is also why our own benchmarks land where they do. On complex data analysis, PenguinHarness on DeepSeek V4 Pro reached the highest accuracy of the three harnesses we tested (66.67% against 53.33% for both rivals) while spending **$0.55** against Claude Code's **$38.48** — the same task suite, roughly 1/70 the bill. On coding we tie OpenAI Codex at 71.25% and trail Claude Code's 86.25%, but the suite cost us **$3.81** against **$220.08** and **$146.97**. We are not claiming to beat a frontier model on every axis; we are claiming the gap is one to two orders of magnitude smaller than the price gap. Fewer tokens per turn is not an aesthetic preference — it is the entire cost structure.

## 6. What minimalism must not cost you

Here is where we part company with minimalism as a philosophy.

Stripping a harness down is easy if you also strip out the parts that make an autonomous process safe to run on a real machine. Pi's own README is upfront that it *"does not include a built-in permission system"* and suggests containers instead. That is a reasonable trade for a personal CLI. It is not a trade an enterprise can make.

PenguinHarness treats safety and observability as load-bearing, and they are cheap in context precisely because they live in the runtime rather than in the prompt:

- **Every tool call gets exactly one approval decision**, in one of four modes — allow-all, deny-all, read-only, or always-ask. The SDK denies by default when no approver is supplied, so nothing runs unattended by accident.
- **Every decision is written to the Trace** as an `approval_decision` event, producing a complete audit record.
- **Tools never throw into the engine.** Failures become tool output the model can read and react to — which is also why a lean prompt is safe: the environment reports its own errors clearly enough that the prompt does not have to anticipate them.

Costing zero extra tokens per turn while remaining fully auditable is the whole point. Discipline in the context window; rigor in the runtime.

## 7. The takeaway

The Databricks result is worth internalizing beyond coding agents: **for a fixed model, the harness sets the price.** And the harnesses that won on cost did not win by being smarter. They won by sending less.

If you are building agents, the audit is straightforward. How many tools does your model see, and how many are re-implementing a shell? What is your hard cap on tool output? How many lines of your system prompt are teaching the model things it learned in pre-training? What gets injected into every message?

Every one of those answers is a line item, charged on every turn, for the life of the task.

We built PenguinHarness around that bill. Six tools, a 72-line prompt, capped output, on-demand skills — with per-call approval and full traces kept, because the parts that make an agent trustworthy are not the parts worth cutting.

---

- **Try it**: `curl -fsSL https://penguin.ooo/install.sh | sh`, then `penguin web`
- **Read the internals**: [Tools & Approval](https://penguin.ooo/docs/tools) · [The Agent Loop](https://penguin.ooo/docs/agent-loop) · [Skills](https://penguin.ooo/docs/skills)
- **Come argue with us**: [GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**Sources**: [Databricks — Benchmarking Coding Agents on Databricks' Multi-Million Line Codebase](https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase) · [Pi (earendil-works/pi)](https://github.com/earendil-works/pi) · [SaladDay, "Less is More"](https://x.com/Salad95238547/status/2079508549382644194)

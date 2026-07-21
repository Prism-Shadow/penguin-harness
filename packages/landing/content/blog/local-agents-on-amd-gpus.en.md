---
title: "A closer look at PenguinHarness — and running a self-improving agent locally on an AMD GPU"
date: 2026-07-20
category: news
excerpt: What PenguinHarness actually is, the ideas behind its architecture, and a real end-to-end run — a local open-weight model on an AMD GPU that fails a scored task, then improves itself from 0 to 4 out of 5 by editing its own files, entirely on-device.
---

*AMD × PrismShadow — by Ning Zhang, Yuyang Gao (AMD) and Yaowei Zheng (PrismShadow).*

If you are new to PenguinHarness, this post is a guided tour: what the project is, the ideas that shape its architecture, and — to make it concrete — a real run where a fully local open-weight model on an AMD GPU *fails* a scored task and then *improves itself* from 0 to 4 out of 5 by editing its own files, without a single byte leaving the machine.

## What PenguinHarness is

PenguinHarness is an open-source AI Agent harness — a complete TypeScript stack for *building* and *evolving* agents, not a single app. It deploys fully locally, can run on as little as a single CPU, and reaches 1000+ online and local models through one unified gateway. Its purpose fits in one line:

> Efficient Self-Improving Harness for Everyone.

The word "harness" is deliberate. This is not a heavyweight framework you build *on top of*; it is a thin, reliable, observable substrate that an agent can *stand inside* — and, crucially, one that an agent can reach back into and improve. Three pillars carry that idea:

| Pillar | Meaning |
| --- | --- |
| **Simplest Is the Best** | A deliberately minimal toolset over clean low-level interfaces: fewer tool calls, fewer tokens, complex tasks done efficiently. |
| **Harness for Building Agents** | Either build one programmatically with the SDK (`createAgent` → `createSession` → `run`), or have an Agent build a whole new Agent for you from a plain-language requirement. |
| **Harness for Recursive Self-Improvement** | With Skills, an Agent evaluates and optimizes *itself*, improving recursively over time. |

For the latter two, PenguinHarness is the first open-source implementation of its kind.

## The architecture, and why it is shaped this way

One install gives you four layers that share one data directory and one message protocol:

```text
┌─────────────┐  ┌─────────────────────────────┐
│   CLI       │  │  Web App (React SPA)        │
│  (penguin)  │  │    ↑ OmniMessage over SSE   │
│             │  │  Server (Hono + SQLite)     │
└──────┬──────┘  └──────────────┬──────────────┘
       │      session.run(...)  │        ← Human boundary
┌──────┴────────────────────────┴──────────────┐
│  core: context_engine (ReAct loop)           │
│    ├── LLMInterface ──→ AgentHub ──→ models  │
│    ├── EnvironmentInterface ──→ builtin tools│
│    ├── Agent State (editable files)          │
│    └── Trace (append-only JSONL)             │
└──────────────────────────────────────────────┘
```

The center is the execution engine in `@prismshadow/penguin-core`. The CLI, the Server, and the Web App are simply different "Human implementations" of that same engine. This single decision — one kernel, many front-ends — is what keeps the whole system coherent, and it comes from a small set of design tenets worth understanding on their own.

### One protocol, three jobs — OmniMessage

Everything the system does is expressed as one message type, OmniMessage. It is simultaneously:

- the SDK's external interface (what you send in and stream back out),
- the on-disk Trace format, and
- the engine's internal currency.

In other words, *what streams live, what is stored on disk, and what the model sees are literally the same object*. There is no translation layer silently reshaping your data between "what happened" and "what was recorded." That identity is the foundation for the observability and recoverability everything else relies on.

### The three-interface boundary

The engine speaks only OmniMessage and orchestrates the flow between exactly three boundaries:

- **Human** — the user side. Notably *not* a class: the SDK's single entry point `session.run(newMessages, { approve, signal })` *is* the Human boundary. Input is a list of messages plus an approval callback; output is a stream of messages. The CLI and the Server are its two shipped implementations.
- **LLM** — the model side (`LLMInterface`). All provider-specific protocol adaptation lives in the AgentHub gateway; the core never imports a vendor SDK. This is exactly why any OpenAI-compatible endpoint — including a local one — just works.
- **Environment** — the tool side (`EnvironmentInterface`). Runs approved tool calls and streams results back.

Because the kernel contains no provider, tool, or UI specifics, each side swaps by configuration alone. Today's local shell can become tomorrow's sandbox; a CLI caller can become a web caller — the core never changes.

### Agents are editable data, not code

An Agent's entire behavior — its prompt, its Skills, its runtime config — lives as editable files on disk (`agent_state/`), not as hardcoded constants. This is the quiet key to the whole project: *what you can see, an Agent can improve*. Self-improvement is not a special engine feature; it is an agent editing the same files you would edit by hand, then re-evaluating itself.

### A few more tenets that run through everything

- **Errors converge into messages.** Model and tool failures never throw into the engine; they become messages the model can react to. Robustness is a property of the protocol, not of scattered try/catch.
- **Everything is observable.** Every request, tool call, and approval decision is appended to the Trace; a Session restores fully from it.
- **Streaming first.** Text streams token by token; tool calls and results appear live.
- **Model ↔ Agent decoupling.** An Agent never binds to a model — you choose one per Session. The same Agent can run different sessions on different models.

The one-line summary of the layering: *what is editable or recorded lives in files; what makes messages flow lives in the SDK; what needs a resident process and multiple users lives in the Server; the rest is rendering.*

## Simplest is the best — six tools, and why that matters

The first pillar is the easiest to overlook and the one you feel most in practice: the toolset is deliberately tiny. PenguinHarness ships exactly six built-in tools:

| Tool | Purpose |
| --- | --- |
| `exec_command` | Run a shell command in the workspace (streams stdout/stderr) |
| `input_command` | Drive a running command — write stdin, send Ctrl-C, poll output |
| `run_subagent` | Delegate a self-contained subtask to a child agent |
| `input_subagent` | Poll or follow up with a background subagent |
| `read_image` | Read an image as image content (vision models) |
| `describe_image` | Have a vision model describe an image for text-only models |

Notice what is *not* there: no `read_file`, no `write_file`, no `edit_file`, no `list_dir`, no `grep` tool. That is intentional — the shell is the universal interface, so reading, writing, and editing files all go through `exec_command` (`cat`, `>`, `sed`, and so on). The principle is "the simplest is the best": every extra tool is more schema in the prompt, more tokens on every call, and one more thing the model can pick wrong. Fewer tools means fewer wrong calls and less token overhead — complex tasks done with less ceremony.

This is not just theory — you can read it straight out of the Trace. Here are the only three tool calls the agent made to complete the entire CSV-cleanup case, all of them `exec_command`:

```bash
# 1. read the input — no read_file tool, just cat
cat users.csv

# 2. do the work — the shell lets the model reach for Python
python3 -c "
import csv
rows = list(csv.DictReader(open('users.csv', newline='')))
cleaned = [r for r in rows if (r.__setitem__('email', r['email'].strip().lower()) or r['email'])]
seen, out = set(), []
for r in cleaned:
    key = tuple(r.values())
    if key not in seen: seen.add(key); out.append(r)
# ... write users_clean.csv, columns unchanged ...
"

# 3. verify by reading the result back — again just cat
cat users_clean.csv
```

Read the file, transform it, check the result — three calls, one tool, no special file machinery. And notice the second step: because the interface is a shell, the model naturally reached for Python to express the dedup logic, something no fixed `edit_file` tool could have done. A minimal toolset is not a limitation the model works around; it is *why* a capable model can finish a real task in so few steps.

## Agents that build agents — a worked example

This is the second pillar — *the harness for building agents* — made concrete. It has two faces. The first is the SDK: you embed an agent in your own program with a few lines — `createAgent()` → `createSession()` → `session.run(...)` (see the snippet at the end). The second is the more striking one, and the flip side of "agents are editable data": if an Agent is just files, then *an Agent can write those files for you*. That is what the built-in `agent-creation` skill does — given a plain-language requirement, an agent scaffolds a new agent: its directory layout, its `system_config.yaml` (name and description), and above all its `AGENTS.md`, the file that turns the requirement into behavior. To show that second face end-to-end, we did exactly this on the local AMD GPU stack.

**The request.** We asked the local `qwen3.6:35b` agent, using the `agent-creation` skill:

> Create a new agent called `commit-helper` that writes Conventional Commits messages — a `type(scope): subject` header (type from feat/fix/docs/…), imperative subject under ~50 chars, a blank line, then a body explaining the *why*.

**What it produced.** Working on its own, the agent created the new agent's directory, copied a base config, set its name and description, and wrote a genuinely good `AGENTS.md` — encoding the header format, a type enum, a subject-length rule, "explain the *why*, not the *what*" for the body, an optional `BREAKING CHANGE`/`Closes #` footer, and even a heuristic for inferring the type from a diff (e.g. "renames → refactor, not chore"). No hand-holding on the content.

**Then we ran the agent it built.** Pointed at a change description ("added retry-with-backoff to the payment client because transient 503s broke checkout"), the freshly-created `commit-helper` — following only the `AGENTS.md` written for it — produced:

```text
fix(payment): add retry-with-backoff for transient gateway 503 errors

Transient 503 responses from the payment gateway were causing
checkout failures for users during peak traffic. Retry with
exponential backoff gives the gateway time to recover, preventing
spurious user-facing errors without requiring manual retries.
```

It even reasoned out loud about whether the change was a `fix` or a `feat` before committing to `fix` — behavior that came entirely from the AGENTS.md its parent agent had written.

**Run it yourself.** The whole flow above is a self-contained, SDK-driven script in the repo:
[`examples/build-agent-with-agent/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/build-agent-with-agent).
Phase 1 uses `createAgent`/`createSession`/`run` to drive `default_agent` into building
`commit-helper`; phase 2 loads the new agent and runs it — all on the local Ollama + qwen3.6:35b
setup, no cloud API. See its `README.md` for the one-time Ollama configuration.

## Self-improvement, in one line

The third pillar builds on the same idea. Because agents are editable data and everything is traced, an agent can *measure itself and get better* — a loop of benchmark → evaluate → find where points were lost → edit the agent's own files → keep the change only if the score improves. There is no special engine code behind it; it is ordinary agent machinery orchestrated by Skills, and every number on the scoreboard links back to the exact Session that produced it. We walk through the full loop — with a real before/after — after the run below.

## A real local run on an AMD GPU

Design tenets are easy to claim. Here is an end-to-end run that exercises them, entirely on fully local, open-weight infrastructure with an AMD GPU — every token generated on-device, nothing sent to a cloud API.

**The setup.** An AMD GPU running ROCm, serving `qwen3:8b` — a popular, everyday local open-weight model (about 5 GB) — through Ollama's OpenAI-compatible endpoint. Ollama detected the AMD GPU natively (no architecture override needed) and loaded the model into GPU memory. This same path spans AMD's ROCm-supported lineup — from Radeon PRO workstation cards such as the W7900 (48 GB, RDNA3) up to datacenter Instinct accelerators. Wiring it into PenguinHarness took a single command, precisely because the core treats any OpenAI-compatible endpoint the same way:

```bash
penguin config model add \
  --model-id qwen3:8b \
  --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 \
  --api-key ollama --set-default
```

**The task, and how it's scored.** We gave it a constrained writing task in the style of the built-in `example-benchmark`: read a project notes file and produce a summary with an overview of at most 2 sentences, exactly 3 key facts, under 60 words total. The task carries a private rubric — a scoring checklist the agent never sees, so it cannot "teach to the test." The rubric turns each requirement into one point (file actually written · ≤2-sentence overview · exactly 3 bullets · under 60 words · facts accurate), for a score out of 5.

**The baseline — and why it isn't perfect.** Running locally on the AMD GPU, the model read the file, composed a perfectly reasonable summary… and then never wrote it to disk. It emitted the answer as chat text instead of calling the write tool. No deliverable means the rubric scores it **0 / 5**. And because every step is in the Trace, this is not guesswork — you can open the run and see exactly where it went wrong.

That is the honest starting point: on local hardware, an out-of-the-box model does *not* ace a constrained task. Which is exactly what makes the next section interesting — a measured, auditable failure is something you can systematically fix.

## How self-improvement actually works — and a real before/after

The 0 / 5 above is an *evaluation* — a snapshot of the agent as it stands. The more interesting question is how PenguinHarness turns that snapshot into progress. This is the recursive self-improvement loop, and it is worth understanding as a mechanism, because there is no magic engine code behind it — it is ordinary agent machinery, orchestrated by Skills:

1. **Benchmark** — define capability cases, each with a private rubric (as above).
2. **Evaluate** — run the agent over the cases and score against the rubrics. Each run is an ordinary, fully-traced Session.
3. **Read the Trace to find where points were lost** — because every score links back to the exact run, you can see *why* a point was missed, not just that it was.
4. **Edit the Agent's state** — the agent's behavior lives in editable files (`AGENTS.md`, Skills, config). You (or an Optimizer agent) change those to address the failure, producing version N+1.
5. **Snapshot & keep-or-roll-back** — snapshot before each round; keep N+1 only if the score strictly improves, otherwise roll back.

Let's improve the exact agent from the previous section — the same `qwen3:8b` on the same AMD GPU, the same task that just scored **0 / 5**.

- **The diagnosis (from the Trace).** The run failed for one concrete reason: the model produced the summary as chat text and never called the tool to write `summary.md`. The Trace shows it — a `cat` to read the input, then prose, and no write. So the fix is not "make the model smarter"; it is "make the behavior reliable."
- **The edit (N → N+1).** We added a short *working-discipline* section to the agent's `AGENTS.md`: *read the source first, restate the task's constraints as a checklist, actually call the tool to write the file, and re-read the output to self-check before finishing.* That is the entire change — a few sentences in an editable text file the agent reads on every run. No retraining, no code.
- **The re-evaluation.** Same model, same task, run again: this time it wrote a correct, on-topic `summary.md` to disk, with a 2-sentence overview and exactly 3 key facts drawn from the source — **4 / 5** (the one remaining miss: it ran to 70 words, over the 60-word budget).

That is a jump on the same model and the same task, achieved purely by editing a text file the agent reads. That is the loop in miniature: *what you can see, you (or an Optimizer agent) can improve* — and because the score comes from a rubric and links to a Trace, the improvement is measured, not vibes. This is exactly the "keep the change only if the score strictly improves" loop, one turn of the crank.

**Run it yourself.** This whole loop is a self-contained, SDK-driven script in the repo:
[`examples/self-improving-agent/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/self-improving-agent).
It uses a deterministic, readable rubric (file written · ≤2 sentences · exactly 3 bullets · under
60 words · facts accurate) and — because a local model is nondeterministic — averages several runs
per version, which is exactly why real benchmarks use a `runs` count. In our runs the averaged
score moved from **0.00/5** (blank `AGENTS.md`) to **5.00/5** (with the working-discipline edit),
and the script keeps N+1 only because the score strictly improved. It runs on the same local
Ollama + qwen3:8b setup and uses a dedicated agent id, so your own agents are untouched.

## No AMD GPU yet? Free cloud compute from AMD + Fireworks

Not everyone has an AMD GPU under their desk — and you do not need one to try this. Through the AMD AI Developer Program, AMD partners with Fireworks AI to hand eligible developers **$50 in free Fireworks credits**. Fireworks serves open-weight models over an OpenAI-compatible endpoint, so — just like the local Ollama setup above — it is a single-line change to point PenguinHarness at it.

Getting the credits (approval typically takes 2–3 business days):

1. Sign up at the [AMD AI Developer Program](https://developer.amd.com/ai-developer-program/).
2. Open **Member Perks → Cloud Credit Options → Request Cloud Credits**.
3. In the form, choose **Fireworks AI** as the product needed, add at least one public profile link (GitHub, LinkedIn, etc.), and submit.
4. AMD emails you a coupon code. Redeem it at [fireworks.ai](https://fireworks.ai/) via **Redeem Promo**, then generate an API key.

Then wire it into PenguinHarness exactly like any other endpoint:

```bash
penguin config model add --model-id <fireworks-model-id> \
  --provider custom --client-type openai \
  --base-url https://api.fireworks.ai/inference/v1 \
  --api-key <your-fireworks-key> --set-default
```

Same harness, same one-line swap — whether the tokens are generated on your own AMD GPU or on AMD-backed cloud credits. (Keep your coupon code and key private; program terms may change, so check the official page and approval email for current details.)

## Why this matters

- **Local-first is not a slogan.** A complete build → run → self-evaluate loop ran on-device, on an AMD GPU, with no data leaving the machine — a real answer for privacy-sensitive and enterprise settings. And because it rides on ROCm + Ollama, the same setup runs across AMD's GPU range: a single Radeon PRO workstation card (e.g. the 48 GB W7900) comfortably runs models from 8B up to 30B-plus, while Instinct accelerators scale it further.
- **The thin model layer pays off.** Because provider adaptation lives entirely in the gateway, "a local Ollama model" and "a frontier cloud API" are the same one-line change. You are never locked to a vendor — or to a GPU vendor. We ran this on an AMD GPU (ROCm), but nothing here is AMD-specific: the very same steps work on an NVIDIA GPU (Ollama's CUDA backend) or on Apple Silicon — only the Ollama runtime underneath changes, while the harness, the commands, and the examples stay identical.
- **Observability is built in, everywhere.** The local run produced the same append-only Trace and scoreboard linkage as any cloud run. Evaluation is auditable by construction.

## Get started

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh

# Point at any OpenAI-compatible endpoint — a local Ollama model included
penguin config model add --model-id <your-model> \
  --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 --api-key ollama --set-default

penguin web   # or: penguin run --approve allow-all --message "..."
```

Prefer to embed it in your own program? That is the SDK face of the "building agents" pillar — the core loop is three calls:

```ts
const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });
for await (const out of session.run([userText("...")], { approve: async () => "allow" })) { /* stream */ }
```

Complete, runnable versions live in [`examples/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples) — including an agent that builds another agent and an agent that improves itself, both on local Ollama.

Whether you run frontier cloud models or open weights on your own AMD GPU, PenguinHarness gives you the same minimal, observable, self-improving substrate. Follow us on [GitHub](https://github.com/Prism-Shadow/penguin-harness) and open your first issue.

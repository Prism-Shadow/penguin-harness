---
title: "Run a self-improving agent locally on an AMD GPU with PenguinHarness"
date: 2026-07-20
category: practice
author: Ning Zhang (AMD), Yuyang Gao (AMD), Yaowei Zheng (PrismShadow)
excerpt: "Learn how PenguinHarness is built, then run it on an AMD GPU with a local open-weight model: have an agent build another agent, and watch an agent raise its own score from about 4.6 to 9.8 out of 10, entirely on-device."
---

> Written for PenguinHarness 0.1.1. Later releases may differ in some details.

*AMD × PrismShadow — by Ning Zhang, Yuyang Gao (AMD) and Yaowei Zheng (PrismShadow).*

In this tutorial you run PenguinHarness on fully local, open-weight infrastructure with an AMD GPU. Every Token is generated on the machine, and nothing is sent to a cloud API.

You start with a short tour of how PenguinHarness is built. Then you serve a local model on the GPU, have an agent build a new agent from a one-sentence requirement, and watch an agent fail a scored task and improve itself by diagnosing the failure and rewriting its own files.

By the end you will have:

- `qwen3.6:35b` served by Ollama on your AMD GPU and registered as the default model in PenguinHarness,
- a `commit-helper` agent that another agent built for you,
- a self-improvement run that moves the score from about 4.6 to about 9.8 out of 10 in two rounds.

The tutorial is for developers who are new to PenguinHarness. If you have no AMD GPU, the section after Step 5 shows how to use Fireworks credits instead.

## Prerequisites

- An AMD GPU supported by ROCm, with ROCm installed and enough GPU memory for `qwen3.6:35b`, a model of about 24 GB.
- Ollama on the same machine.
- A clone of the [PenguinHarness repository](https://github.com/Prism-Shadow/penguin-harness), with Node.js 24 or later and pnpm, to run the two examples in Steps 3 to 5.

You do not need a cloud account or an API key.

## How PenguinHarness is built

PenguinHarness is an open-source AI agent harness: a complete TypeScript stack for *building* and *evolving* agents, not a single app. It deploys fully locally, can run on as little as a single CPU, and reaches 1000+ online and local models through one unified gateway. Its purpose fits in one line:

> Efficient Self-Improving Harness for Everyone.

The word "harness" is deliberate. PenguinHarness is not a heavyweight framework you build on top of. It is a thin, reliable, observable substrate that an agent stands inside, and one that an agent can reach back into and improve. Three pillars carry that idea:

| Pillar | Meaning |
| --- | --- |
| **Simplest Is the Best** | A deliberately minimal toolset over clean low-level interfaces: fewer tool calls, fewer Tokens, complex tasks done efficiently. |
| **Harness for building agents** | Either build one programmatically with the SDK (`createAgent` → `createSession` → `run`), or have an agent build a whole new agent for you from a plain-language requirement. |
| **Harness for Recursive Self-Improvement** | With Skills, an agent evaluates and optimizes *itself*, improving recursively over time. |

For the latter two, PenguinHarness is the first open-source implementation of its kind.

### One kernel, many front-ends

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

The center is the execution engine in `@prismshadow/penguin-core`. The CLI, the Server and the Web App are different "Human implementations" of that same engine. This one decision, a single kernel with many front-ends, keeps the whole system coherent. It follows from a few design tenets, described below.

### OmniMessage: one protocol, three jobs

Everything the system does is expressed as one message type, OmniMessage. It is at the same time:

- the SDK's external interface (what you send in and stream back out),
- the on-disk Trace format, and
- the engine's internal currency.

What streams live, what is stored on disk and what the model sees are literally the same object. No translation layer silently reshapes your data between "what happened" and "what was recorded". That identity is the foundation for the observability and recoverability that everything else relies on.

### The three-interface boundary

The engine speaks only OmniMessage and orchestrates the flow between exactly three boundaries:

- **Human**: the user side. It is not a class: the SDK's single entry point, `session.run(newMessages, { approve, signal })`, *is* the Human boundary. Its input is a list of messages plus an approval callback, and its output is a stream of messages. The CLI and the Server are its two shipped implementations.
- **LLM**: the model side (`LLMInterface`). All provider-specific protocol adaptation lives in the AgentHub gateway, and the core never imports a vendor SDK. That is why any OpenAI-compatible endpoint, including a local one, just works.
- **Environment**: the tool side (`EnvironmentInterface`). It runs approved tool calls and streams the results back.

Because the kernel contains no provider, tool or UI specifics, each side swaps by configuration alone. Today's local shell can become tomorrow's sandbox, and a CLI caller can become a web caller, while the core never changes.

### Agents are editable data, not code

An agent's entire behavior (its prompt, its Skills and its runtime config) lives as editable files on disk in `agent_state/`, not as hardcoded constants. This is the key to the whole project: what you can see, an agent can improve. Self-improvement is not a special engine feature. It is an agent editing the same files you would edit by hand, then evaluating itself again. Step 5 shows this in action.

### Tenets that run through everything

- Errors converge into messages. Model and tool failures never throw into the engine; they become messages the model can react to. Robustness is a property of the protocol, not of scattered try/catch.
- Everything is observable. Every request, tool call and approval decision is appended to the Trace, and a Session restores fully from it.
- Streaming comes first. Text streams Token by Token, and tool calls and results appear live.
- Models and agents are decoupled. An agent never binds to a model: you choose one per Session, so the same agent can run different Sessions on different models.

The layering in one sentence: *what is editable or recorded lives in files; what makes messages flow lives in the SDK; what needs a resident process and multiple users lives in the Server; the rest is rendering.*

### Six built-in tools

The first pillar is the easiest to overlook and the one you feel most in practice: the toolset is deliberately tiny. When this post was written, PenguinHarness shipped exactly six built-in tools:

| Tool | Purpose |
| --- | --- |
| `exec_command` | Run a shell command in the Workspace (streams stdout/stderr) |
| `input_command` | Drive a running command: write stdin, send Ctrl-C, poll output |
| `run_subagent` | Delegate a self-contained subtask to a child agent |
| `input_subagent` | Poll or follow up with a background subagent |
| `read_image` | Read an image as image content (vision models) |
| `describe_image` | Have a vision model describe an image for text-only models |

There was no `read_file`, `write_file`, `edit_file`, `list_dir` or `grep` tool, on purpose. The shell was the universal interface, so reading, writing and editing files all went through `exec_command` (`cat`, `>`, `sed` and so on). Every extra tool adds schema to the prompt, Tokens to every call, and one more thing the model can pick wrong. Fewer tools mean fewer wrong calls and less Token overhead.

You can read this straight out of a Trace. These are the only three tool calls an agent made to complete a CSV-cleanup case, all of them `exec_command`:

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

Read the file, transform it, check the result: three calls, one tool, no special file machinery. In the second call, because the interface is a shell, the model reached for Python to express the dedup logic, which no fixed `edit_file` tool could have done. A minimal toolset is not a limitation the model works around. It is why a capable model can finish a real task in so few steps.

## Step 1: Install PenguinHarness

Install PenguinHarness with the one-line installer:

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
```

The installer gives you the `penguin` CLI, which you use in the next step to register the local model.

## Step 2: Serve qwen3.6:35b on the AMD GPU

In this step you serve a local model through Ollama and register it with PenguinHarness.

The model is `qwen3.6:35b`, a capable local open-weight model: a ~24 GB MoE with 36B total parameters, quantized to Q4_K_M. Under ROCm, Ollama detects the AMD GPU natively, with no architecture override, and loads the model into GPU memory. The same path spans AMD's ROCm-supported lineup, from Radeon PRO workstation cards such as the W7900 (48 GB, RDNA3) up to datacenter Instinct accelerators.

Start Ollama and pull the model:

```bash
ollama serve &          # if not already running as a service
ollama pull qwen3.6:35b
```

Then register the model with PenguinHarness and make it the default:

```bash
penguin config model add \
  --model-id qwen3.6:35b \
  --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 \
  --api-key ollama --set-default
```

A single command is enough because the core treats any OpenAI-compatible endpoint the same way, and Ollama serves one at `http://localhost:11434/v1`.

## Step 3: Have an agent build an agent

In this step an agent builds a new agent for you. This is the second pillar, the harness for building agents, made concrete.

The pillar has two faces. The first is the SDK: you embed an agent in your own program with a few lines, `createAgent()` → `createSession()` → `session.run(...)` (see Next steps at the end). The second follows from agents being editable data: if an agent is just files, *an agent can write those files for you*. That is what the built-in `agent-creation` Skill does (renamed `agent-initialization` in PenguinHarness 0.2.4). Given a plain-language requirement, an agent scaffolds a new agent: its directory layout, its `system_config.yaml` (name and description), and above all its `AGENTS.md`, the file that turns the requirement into behavior.

The repository example [`examples/build-agent-with-agent/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/build-agent-with-agent) runs the whole flow as a self-contained, SDK-driven script on the local Ollama + qwen3.6:35b setup, with no cloud API. Its `README.md` covers the one-time Ollama configuration. Run it from the repository root:

```bash
pnpm install
pnpm build
pnpm --dir examples/build-agent-with-agent start
```

In phase 1, the script uses `createAgent`/`createSession`/`run` to drive `default_agent` into building `commit-helper`. The local `qwen3.6:35b` agent receives this request, using the `agent-creation` Skill:

> Create a new agent called `commit-helper` that writes Conventional Commits messages — a `type(scope): subject` header (type from feat/fix/docs/…), imperative subject under ~50 chars, a blank line, then a body explaining the *why*.

Working on its own, the agent creates the new agent's directory, copies a base config, sets its name and description, and writes a genuinely good `AGENTS.md`. The file encodes the header format, a type enum, a subject-length rule, "explain the *why*, not the *what*" for the body, an optional `BREAKING CHANGE`/`Closes #` footer, and even a heuristic for inferring the type from a diff (for example, "renames → refactor, not chore"). The content needs no hand-holding.

In phase 2, the script loads the new agent and runs it on a change description: "added retry-with-backoff to the payment client because transient 503s broke checkout". Following only the `AGENTS.md` written for it, the freshly created `commit-helper` produces:

```text
fix(payment): add retry-with-backoff for transient gateway 503 errors

Transient 503 responses from the payment gateway were causing
checkout failures for users during peak traffic. Retry with
exponential backoff gives the gateway time to recover, preventing
spurious user-facing errors without requiring manual retries.
```

It even reasons out loud about whether the change is a `fix` or a `feat` before settling on `fix`. That behavior comes entirely from the `AGENTS.md` its parent agent wrote.

## Step 4: Measure the baseline

In this step you score an agent with a blank `AGENTS.md` on a task whose rules it cannot see.

The task looks trivial: read a project notes file and produce a summary with a 2-sentence overview and exactly 3 key facts, *and follow the team's standard report format*. That last clause is the whole point. The "team format" is an arbitrary house convention: a specific marker line, a `# Report: <subject>` title, a `Classification: INTERNAL` line and a `Reviewed-by: Aurora Team` footer. It lives *only in the agent's `AGENTS.md`* and cannot be inferred from the task.

The task carries a private rubric, a checklist the agent never sees, worth 10 points:

- 5 points for content, which any capable model earns from the task alone;
- 5 points for the convention, which is knowable only from `AGENTS.md`.

The repository example [`examples/self-improving-agent/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples/self-improving-agent) runs this task, and then the improvement loop, as a self-contained, SDK-driven script. It uses a deterministic, readable rubric with the same 10 points, runs on the same local Ollama + qwen3.6:35b setup, and uses a dedicated agent id, so your own agents are untouched. Start it from the repository root:

```bash
pnpm --dir examples/self-improving-agent start
```

The first score the script reports is the baseline. With a blank `AGENTS.md`, the model writes a perfectly reasonable summary but stably loses all 5 convention points, landing around 4.6 / 10. Exact numbers vary run to run. A local model is nondeterministic, so the script averages several runs per version, which is exactly why real Benchmarks use a `runs` count.

The model could not have done otherwise. Nothing in the task reveals the house convention, so this is an *information gap, not a capability gap*, and it is why a stronger model cannot just "figure it out". Because every step is in the Trace, you can open the run and see precisely which points were missed.

This is the honest starting point: on local hardware, an out-of-the-box agent does not ace a task whose rules live in files it has not learned yet. A measured, auditable, reproducible failure is something the agent can fix systematically by teaching itself, which is what the next step shows.

## Step 5: Let the agent improve itself

In this step the same run continues into the self-improvement loop. The agent does the diagnosing and the editing; nobody hands it the answer.

The loop has five stages. There is no special engine code behind it: it is ordinary agent machinery, orchestrated by Skills.

1. Benchmark: define capability cases, each with a private rubric, as in Step 4.
2. Evaluate: run the agent over the cases and score them against the rubrics. Each run is an ordinary, fully traced Session.
3. Read the Trace to find where points were lost: every score links back to the exact run, so you can see *why* a point was missed, not just that it was.
4. Edit the agent's state: the agent's behavior lives in editable files (`AGENTS.md`, Skills, config). You, or an Optimizer agent, change those files to address the failure, producing version N+1.
5. Snapshot, then keep or roll back: take a snapshot before each round, and keep N+1 only if the score strictly improves. Otherwise, roll back.

In the example, the script supplies only the failure signal and the accepted example reports, then reports whether each round raised the score. It never writes the convention itself.

### Round 1: learn the structure

The agent gets two files and nothing else: the report that was just rejected, and a passing report from a *different* project. Nobody tells it the rules. It compares the two and infers the reusable house convention: the marker, the title shape, the metadata line and the sign-off. This is the "read the Trace to find where points were lost" stage, performed by the agent itself.

The agent then writes the convention into its own `AGENTS.md`, producing version N+1. From a single example it correctly recovers the *structure*, but it cannot yet tell which tokens are fixed constants and which are per-report fields, because one example is ambiguous. So it generalizes the marker to a placeholder. Evaluated again, the score climbs to about 6.6 / 10. There is no retraining and no code change: the agent edited a text file it reads on every run.

### Round 2: lock the constants

Next, the agent sees *several* accepted reports from different projects that share the same marker and sign-off. It reasons that whatever is identical across all of them must be a fixed constant, reads its *own* N+1 `AGENTS.md`, and refines it, locking `<!-- ACME-DATA-PLATFORM -->` and `Reviewed-by: Aurora Team` to literals. Evaluated again, the score reaches about 9.8 / 10. That is recursion in the true sense: `state_{n+1} = agent.reflect(state_n, new_evidence)`.

Each round strictly raised the score, which is the condition stage 5 sets for keeping an edit.

## No AMD GPU? Use Fireworks credits

You do not need an AMD GPU to try this. Through the AMD AI Developer Program, AMD partners with Fireworks AI to give eligible developers $50 in free Fireworks credits. Fireworks serves open-weight models over an OpenAI-compatible endpoint, so, just like the local Ollama setup, pointing PenguinHarness at it is a single-line change.

Approval typically takes 2–3 business days. To get the credits:

1. Sign up at the [AMD AI Developer Program](https://developer.amd.com/ai-developer-program/).
2. Open **Member Perks → Cloud Credit Options → Request Cloud Credits**.
3. In the form, choose **Fireworks AI** as the product needed, add at least one public profile link (GitHub, LinkedIn, etc.), and submit.
4. AMD emails you a coupon code. Redeem it at [fireworks.ai](https://fireworks.ai/) via **Redeem Promo**, then generate an API key.

[Getting Fireworks API Access](https://penguin.ooo/blog/fireworks-credits-amd) walks through redeeming the credits and creating the API key in detail.

Then register Fireworks in PenguinHarness like any other endpoint:

```bash
penguin config model add --model-id <fireworks-model-id> \
  --provider custom --client-type openai \
  --base-url https://api.fireworks.ai/inference/v1 \
  --api-key <your-fireworks-key> --set-default
```

The harness and the one-line swap stay the same, whether the Tokens are generated on your own AMD GPU or on AMD-backed cloud credits. Keep your coupon code and key private. Program terms may change, so check the official page and the approval email for current details.

## Results

In our runs, the same model and task produced this climb. The numbers vary run to run.

| Version | What the agent had written into its `AGENTS.md` | Score |
| --- | --- | --- |
| N (baseline) | Nothing: the file is blank | about 4.6 / 10 |
| N+1 | The convention's structure, with the marker as a placeholder | about 6.6 / 10 |
| N+2 | The same convention, with its constants locked to literals | about 9.8 / 10 |

The score rose purely because the agent edited a text file it reads. The run shows three things:

- Local-first works on AMD hardware. A complete build → run → self-evaluate loop ran on-device, on an AMD GPU, with no data leaving the machine. That is a real answer for privacy-sensitive and enterprise settings. Because it rides on ROCm + Ollama, the same setup runs across AMD's GPU range: a single Radeon PRO workstation card (such as the 48 GB W7900) comfortably runs models from 8B up to 30B-plus, while Instinct accelerators scale it further.
- The thin model layer pays off. Provider adaptation lives entirely in the gateway, so "a local Ollama model" and "a frontier cloud API" are the same one-line change. You are never locked to a vendor, or to a GPU vendor. We ran this on an AMD GPU (ROCm), but nothing here is AMD-specific: the same steps work on an NVIDIA GPU (Ollama's CUDA backend) or on Apple Silicon. Only the Ollama runtime underneath changes; the harness, the commands and the examples stay identical.
- Observability is built in everywhere. The local run produced the same append-only Trace and scoreboard linkage as any cloud run, and every number on the scoreboard links back to the exact Session that produced it. Evaluation is auditable by construction.

## Next steps

You served a local model on an AMD GPU, had an agent build `commit-helper`, and watched an agent raise its own score by editing its own `AGENTS.md`.

The whole setup takes three commands, for any OpenAI-compatible endpoint, a local Ollama model included:

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh

# Point at any OpenAI-compatible endpoint — a local Ollama model included
penguin config model add --model-id <your-model> \
  --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 --api-key ollama --set-default

penguin web   # or: penguin run --approve allow-all --message "..."
```

To embed an agent in your own program, use the SDK face of the "building agents" pillar. The core loop is three calls:

```ts
const agent = await createAgent({ agentId: "default_agent" });
const session = await agent.createSession({ workspaceDir: process.cwd() });
for await (const out of session.run([userText("...")], { approve: async () => "allow" })) { /* stream */ }
```

Complete, runnable versions live in [`examples/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/examples), including an agent that builds another agent and an agent that improves itself, both on local Ollama. Follow us on [GitHub](https://github.com/Prism-Shadow/penguin-harness) and open your first issue.

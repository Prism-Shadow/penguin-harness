---
title: "AI Infrastructure: Past, Present, and Future"
date: 2026-07-22
category: perspectives
excerpt: PyTorch, vLLM, Ollama and LlamaFactory were all designed for a human who reads the docs, watches the logs and remembers what is already running. Increasingly the thing driving them is an agent. Here is what changes — and what PenguinHarness ships today to make it work.
---

The infrastructure we use to build AI was designed for people. PyTorch assumes someone reading a tutorial. vLLM assumes an engineer who knows how much VRAM the card has. LlamaFactory assumes a researcher who will read the training curve and decide whether it is going well. Ollama assumes you remember whether the service is already running.

Every one of those assumptions is about a human operator. And increasingly, the operator is an agent.

This is a short post about what that changes, and what we already ship for it.

## 1. Past: three assumptions about a human operator

Three assumptions run through nearly all AI tooling, and all three quietly break when the user is a program.

### 1.1 That the user carries state in their head

You know you started an Ollama server this morning. You know the training job from last night is still holding the GPU. None of that is in any command's output, because a human did not need it written down.

### 1.2 That errors are a starting point for investigation

`CUDA out of memory` is a perfectly good message for a person — you read it, you halve the batch size, you move on. It tells an agent almost nothing about what to do next, and the ML stack is full of errors like it: shape mismatches thrown eight frames deep, NCCL timeouts, a silent fallback to CPU that only shows up as everything being forty times slower.

### 1.3 That documentation is read once, by someone who will remember it

Tutorials are written as prose, front to back, with the important constraint — the model has to fit in VRAM — in a sentence somewhere in the middle.

Stripe measured what this costs when they benchmarked whether agents could build real integrations against their API. The failure mode they found generalizes uncomfortably well: agents "would pass in nonexistent Stripe data, observe 400s, and consider the task complete." The error was correct. It still failed to communicate failure.

## 2. Present: the stack is already agent-shaped

### 2.1 The shell is the integration

The good news is that AI infrastructure is, by accident, better suited to agents than most software. It is already command-line tools, YAML configs and Python files — text in, text out, composable. There is no need to wrap `nvidia-smi` in anything. An agent with a shell can already drive the entire stack.

That is why PenguinHarness exposes the shell as its universal interface — `exec_command` is the whole filesystem and process interface, and there are no separate file tools. Driving vLLM is not an integration; it is a command.

### 2.2 What actually needs building: the operating knowledge

What is missing is not connectivity. It is the operating knowledge a competent engineer has and a model does not. We ship that as **Skills** — instruction packages an agent reads on demand. Three of them cover this stack directly, in the AI App Development group:

| Skill | What it lets an agent do |
| --- | --- |
| `ollama` | Pull and serve local models, expose the OpenAI-compatible endpoint |
| `vllm` | Serve on GPU for high throughput, with tool-calling flags enabled for agent workloads |
| `llamafactory` | Fine-tune with LoRA/QLoRA, SFT or DPO through YAML configs |

What is in them is more interesting than that they exist, because each one encodes a rule a human would never have needed:

1. **Check the world before changing it.** The `ollama` skill has the agent run `ollama --version` and `ollama ps` first, and then states the rule plainly: if port 11434 is already serving, reuse that instance — *never kill an existing Ollama process*. A human knows not to kill their colleague's server. An agent has to be told.
2. **Preflight the constraint that actually binds.** The `vllm` skill confirms hardware with `nvidia-smi` (or `rocm-smi` on AMD) before anything else, because model size and context length are bounded by VRAM. The buried sentence in the tutorial becomes step zero.
3. **Verify, do not assume.** Both serving skills end with a real check — `curl http://localhost:8000/v1/models` — before the job counts as done. This is the direct answer to the Stripe failure mode: the definition of success is an observation, not the absence of a crash.
4. **Finish the job.** A served model is invisible to PenguinHarness until it is registered, so the skills close the loop with `penguin config model add --client-type openai --base-url ...` and then confirm with `penguin config model list`. Starting a server is not the task. Having a usable model is.
5. **Ask instead of guessing.** Every skill opens the same way: if the request names a skill but no concrete goal, ask first and run nothing. Engine choice, for instance, follows the user's preference rather than a hardcoded default — vLLM for high-throughput GPU serving, Ollama as the simple default and the only option on macOS or CPU-only machines.

### 2.3 Two runtime pieces, because AI work is not shaped like web work

**Long jobs are first-class.** Training and serving do not complete in thirty seconds. `exec_command` waits in the foreground, and once a command outruns its window it keeps running in the background and hands back a `process_id`; `input_command` then polls it, writes to stdin, or sends Ctrl-C. An agent can start a fine-tune, go do something else, and come back to check on it — without a special "training tool."

**Failures come back as text, not exceptions.** Tools never throw into the loop. A non-zero exit, a timeout, an OOM — all of it converges into tool output the model reads and reacts to, with the exit code appended outside the truncation window so it survives even when a long log gets cut. That last detail matters more than it sounds: the one line telling you the run actually failed is usually the last one.

## 3. Future: what is still hard

Three problems are not solved, by us or anyone.

### 3.1 ML-stack errors are still written for humans

Nothing in an agent harness can fix a traceback that does not say what to change. The fix has to happen upstream, in the frameworks — and the guidance already exists: good tool errors are specific and actionable rather than opaque codes and tracebacks. Very little of the training stack meets that bar today.

### 3.2 GPUs are a shared resource with no protocol

An agent can read `nvidia-smi`, but there is no standard way to reserve VRAM, queue behind another job, or find out that the memory it just saw is about to be taken. Today the answer is a written rule — do not kill what you did not start — which is a convention, not a guarantee.

### 3.3 Reproducibility is unresolved

A fine-tune is a long, expensive, stochastic action. Agents make those cheap to launch, which makes it much easier to end up with a model nobody can reproduce. Snapshots and traces help; they are not a full answer.

## 4. The short version

AI infrastructure did not need to be reinvented for agents — it was already text and commands. What was missing is the operating knowledge around it: check before you change, preflight the real constraint, verify with an observation, and finish the job rather than starting it.

That is what our skills encode, on top of a shell, a two-phase process model for long jobs, and errors that come back as readable text.

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin run -m "Serve Qwen3.5-0.8B with Ollama and register it with Penguin"
```

---

- **Docs**: [Skills](https://penguin.ooo/docs/skills) · [Tools & Approval](https://penguin.ooo/docs/tools) · [Models & Providers](https://penguin.ooo/docs/models)
- **Community**: [GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**Sources**: [vLLM](https://docs.vllm.ai/) · [Ollama](https://ollama.com/) · [LlamaFactory](https://github.com/hiyouga/LlamaFactory) · [Stripe, Can AI agents build real Stripe integrations?](https://stripe.com/blog/can-ai-agents-build-real-stripe-integrations) · [Anthropic, Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)

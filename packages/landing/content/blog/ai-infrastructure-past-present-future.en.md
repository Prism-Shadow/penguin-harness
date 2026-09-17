---
title: "AI Infrastructure: Past, Present, and Future"
date: 2026-07-22
category: perspectives
excerpt: AI infrastructure was built for human operators, and agents increasingly drive it. The stack already suits agents; what they lack is an engineer's operating knowledge, which PenguinHarness ships as Skills.
---

> Written for PenguinHarness 0.1.1. Later releases may differ in some details.

The infrastructure we use to build AI was designed for people. PyTorch assumes someone reading a tutorial. vLLM assumes an engineer who knows how much VRAM the GPU has. LlamaFactory assumes a researcher who reads the training curve and decides whether training is going well. Ollama assumes you remember whether the service is already running.

Every one of these assumptions is about a human operator, and the operator is increasingly an agent: a model that does its work by calling tools. This post asks what changes when a program drives the stack. Our answer is that the stack itself needs little change, because it is already text and commands that an agent can run through a shell.

What agents lack is the operating knowledge a competent engineer carries. That knowledge can be written down, and PenguinHarness ships it today as Skills, together with runtime support for long jobs and readable failures. Three problems remain that nobody has solved yet.

## Past: the stack assumes a human operator

Three assumptions about the operator run through nearly all AI tooling, and all three quietly break when the operator is a program.

### The operator keeps state in their head

The first assumption is that the user remembers what is running. You know you started an Ollama server this morning. You know last night's training job still holds the GPU. No command prints either fact, because a human never needed it written down. An agent that sees only command output knows neither.

### Errors start an investigation

The second assumption is that an error message is where a person starts investigating. `CUDA out of memory` is a good message for a person: you read it, halve the batch size, and move on. It tells an agent almost nothing about what to do next. The ML stack is full of errors like it: shape mismatches thrown eight frames deep, NCCL timeouts, and a silent fallback to CPU whose only symptom is that everything runs forty times slower.

Stripe measured what this costs when it benchmarked whether agents could build real integrations against its API. The failure mode it found generalizes well beyond Stripe: agents "would pass in nonexistent Stripe data, observe 400s, and consider the task complete." The error was correct. It still failed to communicate failure.

### Documentation is read once

The third assumption is that documentation is read once, by someone who will remember it. Tutorials are prose, written to be read front to back. The most important constraint, for example that the model has to fit in VRAM, sits in a sentence somewhere in the middle.

## Present: the stack is already agent-shaped

The stack needs no new interfaces for agents. It needs operating knowledge and a runtime built for AI work, which is shaped differently from web work.

### The shell is the integration layer

AI infrastructure is, by accident, better suited to agents than most software. It already consists of command-line tools, YAML configs, and Python files: text in, text out, and composable. A tool like `nvidia-smi` needs no wrapper, because an agent with a shell can already drive the entire stack.

That is why PenguinHarness uses the shell as its universal interface. In 0.1.1, `exec_command` was the whole filesystem and process interface, and there were no separate file tools. Driving vLLM is not an integration; it is a command.

### What is missing is operating knowledge

What is missing is not connectivity. It is the operating knowledge a competent engineer has and a model does not. PenguinHarness ships that knowledge as **Skills**, instruction packages an agent reads on demand. Three of them, in the AI App Development group, cover this stack directly:

| Skill | What it lets an agent do |
| --- | --- |
| `ollama` | Pull and serve local models, expose the OpenAI-compatible endpoint |
| `vllm` | Serve on GPU for high throughput, with tool-calling flags enabled for agent workloads |
| `llamafactory` | Fine-tune with LoRA/QLoRA, SFT or DPO through YAML configs |

What these Skills contain matters more than the fact that they exist. They encode rules that a human operator never needed to be told:

1. **Check the world before changing it.** The `ollama` Skill has the agent run `ollama --version` and `ollama ps` first. Then it states the rule plainly: if port 11434 is already serving, reuse that instance, and *never kill an existing Ollama process*. A human knows not to kill a colleague's server. An agent has to be told.
2. **Check the real constraint first.** The `vllm` Skill confirms the hardware with `nvidia-smi` (or `rocm-smi` on AMD) before it serves anything, because VRAM limits both model size and context length. The sentence buried in the tutorial becomes step zero.
3. **Verify instead of assuming.** Both serving Skills end with a real check before the job counts as done, such as `curl http://localhost:8000/v1/models` for vLLM. This is the direct answer to the Stripe failure mode: success is defined by an observation, not by the absence of a crash.
4. **Finish the job.** PenguinHarness cannot see a served model until it is registered. The Skills therefore close the loop with `penguin config model add --client-type openai --base-url ...` and confirm the result with `penguin config model list`. Starting a server is not the task. Having a usable model is.
5. **Ask instead of guessing.** All three Skills open the same way: if the request names the Skill but gives no concrete goal, the agent asks first and runs nothing. The choice of engine also follows the user's preference rather than a hardcoded default. vLLM is for high-throughput GPU serving, while Ollama is the simple default and the only one of the two that runs on macOS or CPU-only machines.

### Long jobs are first-class

Training and serving do not finish in thirty seconds, so the runtime treats long jobs as the normal case. `exec_command` waits in the foreground. Once a command outruns its wait window, it keeps running in the background and the tool returns a `process_id`. `input_command` then polls that process, writes to its stdin, or sends Ctrl-C. An agent can start a fine-tune, do something else, and come back to check on it, without a special training tool.

### Failures come back as text

Tools never throw exceptions into the agent loop. A non-zero exit, a timeout, or an out-of-memory (OOM) error becomes tool output that the model reads and reacts to. The exit code is appended outside the truncation window, so it survives even when a long log is cut. That detail matters more than it seems, because the line that says a run failed is usually the last one.

## Future: three unsolved problems

Three problems remain unsolved, by us or by anyone else.

### ML-stack errors are still written for humans

Nothing in an agent harness, the software that runs an agent's loop and its tools, can fix a traceback that does not say what to change. The fix has to happen upstream, in the frameworks. The guidance already exists: [Anthropic's advice on writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) says good tool errors are specific and actionable, not opaque codes and tracebacks. Very little of the training stack meets that bar today.

### GPUs are shared without a protocol

An agent can read `nvidia-smi`, but there is no standard way to reserve VRAM, to queue behind another job, or to learn that the memory it just saw is about to be taken. Today the answer is a written rule: do not kill what you did not start. That is a convention, not a guarantee.

### Reproducibility is unresolved

A fine-tune is long, expensive, and stochastic. Agents make such runs cheap to launch, which makes it much easier to end up with a model nobody can reproduce. Snapshots and Traces help, but they are not a full answer.

## Conclusion

AI infrastructure did not need to be reinvented for agents, because it was already text and commands. What was missing is the operating knowledge around it: check before you change anything, check the real constraint first, verify with an observation, and finish the job instead of only starting it.

PenguinHarness encodes that knowledge in Skills. Underneath them are a shell, a two-phase process model for long jobs, and errors that come back as readable text. The commands below install PenguinHarness and ask an agent to serve a local model and register it:

```bash
curl -fsSL https://penguin.ooo/install.sh | sh
penguin run -m "Serve Qwen3.5-0.8B with Ollama and register it with Penguin"
```

---

- **Docs**: [Skills & Plugins](https://penguin.ooo/docs/skills) · [Tools & Approval](https://penguin.ooo/docs/tools) · [Models & Providers](https://penguin.ooo/docs/models)
- **Community**: [GitHub](https://github.com/Prism-Shadow/penguin-harness) · [Discord](https://discord.gg/eFHKqqcU3D)

**Sources**: [vLLM](https://docs.vllm.ai/) · [Ollama](https://ollama.com/) · [LlamaFactory](https://github.com/hiyouga/LlamaFactory) · [Stripe, Can AI agents build real Stripe integrations?](https://stripe.com/blog/can-ai-agents-build-real-stripe-integrations) · [Anthropic, Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)

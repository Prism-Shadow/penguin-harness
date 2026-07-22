---
title: "Tell the agent, not the terminal: a self-closing training loop that never leaves your machine"
date: 2026-07-22
category: practice
excerpt: PenguinHarness 0.1.1 ships the ollama, vllm and llamafactory skills. They are not three more command-line tools for you to learn — they are what the agent learns, so that "run a local model here, and fine-tune it until it passes my evaluation" becomes something you say rather than something you type. The loop that follows closes on its own, and the data in it never leaves your environment.
---

Three skills landed in 0.1.1: `ollama`, `vllm`, `llamafactory`. The easy misreading is that PenguinHarness now expects you to learn three more command-line tools.

It is the opposite. The skills are not written for you — they are written for the agent, and the entire reason they exist is that you stop running the commands. You say what you want in a sentence; the agent picks the tool, asks the questions it is required to ask, runs the thing, checks that it worked, and tells you what happened.

This post is about what that changes, in three parts:

1. **The interface is a sentence.** What you type, and what the agent then does on its own.
2. **The loop closes.** Serve → evaluate → fine-tune → redeploy → measure again, with the agent choosing each next step from the last result.
3. **Nothing you care about goes out.** The endpoint is local, the training is local, the weights are local — and where that stops being true, it says so below.

Everything attributed to the agent here is behavior a shipped skill actually specifies. The skills are plain Markdown and you can read them yourself under `packages/skills/skills/`. Where a skill stops and you take over, this post says so rather than pretending.

## 1. "Run a local model on this machine — I don't want the data going anywhere"

That sentence is the whole input. Here is what happens on the other side of it.

**The agent loads the `ollama` skill and asks two questions before touching anything.** Not out of politeness: the skill forbids running any command until the goal is clear. It asks which model you want to run — and if you have no preference it proposes a small default, Qwen3.5-0.8B, with the reminder that the model has to fit the machine's RAM or VRAM. It asks which engine you prefer, because that choice is genuinely yours: Ollama is the simple default and the only option on macOS or a CPU-only box, while vLLM is for high-throughput GPU serving.

**Then it looks before it leaps.** The skill's first rule is to check the current state — is Ollama installed, is something already serving — and if port 11434 already has an instance, to reuse it and never kill it. That is the same instinct 0.1.1 baked into the default system prompt: never kill a process you did not start; when a port is busy, take another one.

**Then it does the boring parts you would have gotten wrong.** It installs Ollama if missing, pulls the model, and raises the context window — the step people skip and then spend an afternoon debugging, because Ollama's default window is small and agent sessions are not. The skill gives it both ways to do that: `OLLAMA_CONTEXT_LENGTH` in the server environment, or `num_ctx` baked into a model variant with a Modelfile.

**Then it verifies, and only then registers.** A pulled model is invisible to PenguinHarness until it is added, and model configuration is the CLI's job:

```bash
# what the agent ran — not a checklist for you
curl http://localhost:11434/v1/models

penguin config model add --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 --model-id qwen3.5:0.8b --api-key ollama
penguin config model list
```

The details in that command are decisions, not boilerplate, and the `penguin-cli` skill is where the agent learned them. A model in PenguinHarness is the `(provider, model_id)` pair and the group is **never** inferred from the id — gateways resell vendor models under their upstream ids, so a guess could send your key to somebody else's endpoint; `custom` is the group for any endpoint outside the built-in ones. `--client-type openai --base-url <endpoint>` is the shape for any OpenAI chat-completion compatible server. And `--api-key ollama` is not decoration: Ollama accepts any key, but the field must be non-empty.

If the local model has a small context window, the agent also has a reason to cap its output — `--max-tokens` is a per-model cap, new in 0.1.1, that overrides the Agent default of 32,000, which on its own does not fit in a 32k window alongside any prompt at all.

You did not run any of that. You approved it — each tool call, as it came. That is the first of the three places a human is still genuinely in the loop, and it is there on purpose.

## 2. "Now fine-tune it until it passes my evaluation"

This is the sentence that makes the loop close, and it only works because of the word *evaluation*. There is no self-improving anything without a number, and a single run is not a number.

```text
      ┌──────────────────────────────────────────────┐
      │                                              │
serve the model  →  run the benchmark  →  read the failing traces
   (vllm/ollama)     (benchmark-design +      (session ids from
                      agent-evaluation)        the scoreboard)
      ↑                                              │
      │                                              ↓
   redeploy  ←  merge and export  ←  fine-tune on what it got wrong
   (vllm)         (llamafactory)          (llamafactory)
```

**The agent builds the measurement first.** The `benchmark-design` skill has it lay out a Benchmark directory: a `benchmark_config.toml`, a `scoreboard.yaml`, and one directory per Case containing a public `statement/README.md` that the tested agent sees and a private `rubric/README.md` that it must never see. `runs` defaults to 3, so a nondeterministic local model gets averaged instead of sampled once. Rubric maxima across the Case set total 100 points, so the score stays interpretable. Before accepting a Case the skill makes it run a counterfactual — could someone *without* the capability pass this by mechanically following the statement? If yes, the Case is rejected and redesigned.

**Then it fans the runs out.** For N Cases and R runs it emits all N × R evaluations as parallel subagent calls, each one a child that loads `agent-evaluation` and does exactly one Case run. That child creates its own throwaway workspace, copies in **only** the statement, launches the tested agent once through the CLI with the exact `(provider, model_id)` pair, and then binds the resulting trace mechanically — matching the session's recorded workspace, agent state, provider and model id rather than trusting whichever session ran most recently. It returns nothing but protocol metadata: a score, a cost, a duration, a session id. Not a sentence of prose. That silence is the design: it is how the rubric stays out of the tested agent's context and out of the transcript.

**Which gives the agent something to read, not just a number.** Every evaluation records the `(provider, model_id)` pair that produced it, so the base model and its tuned successor land in the same scoreboard and compare directly. And every run carries its session id, so the agent can open the exact trace and see which step lost the point.

**Then it fine-tunes.** The `llamafactory` skill has it confirm four things before training — available GPU memory (LoRA needs far less than full fine-tuning), the base model, the dataset and its format, and the goal, with LoRA SFT as the usual starting point. It registers the dataset in `data/dataset_info.json` in alpaca or sharegpt form, writes a training config derived from the shipped `examples/train_lora/qwen3_lora_sft.yaml`, runs `llamafactory-cli train`, and tries the result interactively before trusting it.

**Then it redeploys and measures again.** The adapter gets merged into the base weights and exported (never into a quantized base — the skill is explicit). vLLM serves the export directory directly; Ollama needs an import first. When the agent serves it, the `vllm` skill has already told it the flag that everyone forgets: an agent harness sends `tools` with its requests, and vLLM has to opt in at startup with `--enable-auto-tool-choice` and a `--tool-call-parser` matched to the model family, or every tool call comes back a 400. The tuned endpoint gets registered as its **own** model id rather than overwriting the base one, precisely so both stay on the scoreboard — and then the same Benchmark runs again.

That is the loop, and none of the steps between "serve" and "measure again" required you to name a command.

**One seam, stated plainly.** Turning failing traces into training examples is the step the skills do *not* prescribe. `llamafactory` asks where your dataset lives and what format it is in; it does not teach an agent to mine a trace into an SFT file. The agent can read the traces (`benchmark-design` has it inspect each returned session), and it can write the conversion script if you ask it to — but that is you directing it, not a skill driving it. Anyone telling you this part is already automatic is selling something.

## 3. Where the human still stands

Three places, and they are not accidents:

- **Approving tool calls.** Every tool call is gated. In the SDK that gate is literally a callback, and omitting it denies everything — the default is refusal, not permission.
- **The judgment calls.** Which base model. Which engine. What "good enough" means. All three serving and tuning skills are written to *ask* rather than assume, and `benchmark-design` requires you to name the agent under test and the capability being measured before it will start. If you also want the agent itself improved rather than the weights, `agent-optimization` works from the same scoreboard — and it refuses to touch Agent State until you have exported a snapshot from Agent settings, so there is always something to roll back to.
- **The dataset seam** from the end of part 2.

Everything else — which flags, which port, which parser, whether to reuse the running server, what to do about `400 … tools must not be an empty array` (upgrade to 0.1.1, which stopped sending an empty tool list) or an out-of-memory at vLLM startup (lower `--gpu-memory-utilization` or `--max-model-len`, or serve a quantized model) — is in the skills, which means it is in the agent.

## 4. Data never leaves your environment

This is the reason the whole arrangement is worth the trouble, so it deserves precision rather than a slogan.

**Local, in this setup:**

- **The served model.** Ollama exposes its OpenAI-compatible API on `http://localhost:11434/v1`; vLLM on `http://localhost:8000/v1`. Both are on the machine. Every prompt, tool schema, tool result and completion in an agent session against them stays on the loopback interface.
- **The training.** LlamaFactory runs on your GPU. Your dataset sits under `data/` next to `data/dataset_info.json`; the adapter and the merged export land under `saves/`. No stage of `llamafactory-cli train` ships your examples anywhere.
- **The evaluation.** Cases, statements and rubrics are files in your project — a rubric lives at a path like `~/.penguin/data/default_project/agents/tool-router/benchmarks/tool-routing-v1/CASE-003-pick-the-cheaper-endpoint/rubric/README.md` — and the evaluator reads them from disk. The scoreboard is a YAML file next to them.
- **The configuration.** `penguin config model add` writes into a single hidden project config file. It is CLI-managed, never hand-edited, and it stays where you point it.

**What does cross the network:** installs and weights, coming *in*. `ollama pull`, `pip install vllm`, cloning LlamaFactory, resolving a Hugging Face base model id — all of them download. None of them upload your data. It is worth being clear about the direction, because "local" is often quietly claimed for setups that phone home.

**And the one thing that decides everything else:** the model that drives the agent. If the agent is running on a hosted API, then the conversation itself — your instructions, the file contents it reads, the tool output it summarizes — goes to that vendor, no matter how local the model it is tuning. The fully-local configuration is a deliberate choice you make: point the harness's own default model at the local endpoint too, with the same `penguin config model add ... --set-default`, and the loop runs end to end without a third party in it. It is a real trade-off — a small local model driving the whole loop is not the same proposition as a frontier model driving it — and it should be a decision, not an assumption.

One related habit worth keeping, since it is a hard rule in both the `penguin-cli` and `penguin-sdk` skills: models and keys for an **app you are building** belong in that app's own data directory inside the project (`--root ./penguin_data`), never in the global `~/.penguin/data`, which belongs to the person running Penguin. Check both while you develop — the app's list should have your entries, the global one should stay clean.

## What actually changed

Before this release, PenguinHarness could talk to any OpenAI-compatible endpoint but had nothing to say about where that endpoint came from. Standing one up, measuring what it could do, and fixing what it could not were three different tools with three sets of conventions, and a human in between translating.

Now they are one system, and the human's job moved. You describe the outcome. The agent serves the model, runs its own benchmark, reads its own failures, tunes, redeploys, and measures again — choosing each next step from the last result. You approve the calls, make the judgment calls, and read the scoreboard.

On your hardware. On your weights. With your data staying where you put it.

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```

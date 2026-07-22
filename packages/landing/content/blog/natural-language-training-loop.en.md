---
title: "Let the agent drive Ollama, vLLM and LlamaFactory: a data-safe self-closing training loop"
date: 2026-07-22
category: practice
excerpt: PenguinHarness 0.1.1 ships the ollama, vllm and llamafactory skills. They are not three more command-line tools for you to learn — they are what the agent already knows, so "serve a model here, then fine-tune it until it passes my evaluation" becomes something you say rather than something you type. This post is mostly about why this harness drives those three tools well: what ships in the box, what it costs per request, and why the loop closes at all. The data in it never leaves your environment.
---

Three skills landed in 0.1.1: `ollama`, `vllm`, `llamafactory`. The easy misreading is that PenguinHarness now expects you to learn three more command-line tools.

It is the opposite. The skills are not written for you — they are written for the agent, and the entire reason they exist is that you stop running the commands. You say what you want in a sentence; the agent picks the tool, asks the questions it is required to ask, runs the thing, checks that it worked, and tells you what happened.

This post is about what that changes, in three parts:

1. **The interface is a sentence.** What you type, and what the agent then does on its own.
2. **Why *this* harness drives these three tools well.** Six things that are in the box rather than in your head, each one a file you can open.
3. **The loop closes, and nothing you care about goes out.** Serve → evaluate → fine-tune → redeploy → measure again, on your hardware, with your weights.

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

## 2. Why this harness drives these three tools well

Any capable agent with a shell can, in principle, run `vllm serve`. The interesting question is what it takes to get from *in principle* to a session that works the first time, and how much of that you had to supply. Six answers, each one a file in this repo rather than an adjective.

**One: the knowledge ships in the box.** `packages/skills/skills/vllm/SKILL.md`, `.../ollama/SKILL.md` and `.../llamafactory/SKILL.md` are part of the Skill library, and a project's `default_agent` is created with the whole library installed — not fetched, not configured, not pasted in by you. So on a fresh install the agent already knows that vLLM has to be started with `--enable-auto-tool-choice` and a `--tool-call-parser` matched to the model family or every tool call comes back a `400`; that Ollama's default context window is too small for agent sessions, and both ways to raise it; that a LoRA adapter must never be merged into a quantized base. None of that is exotic — it is exactly the set of things you find out by losing an afternoon to them.

<details>
<summary><strong>Expand: some of what the three skills already know</strong></summary>

Straight from the shipped `SKILL.md` files — this is the class of detail that is already in the agent's reach before you say anything:

- **vLLM, tool calling.** `vllm serve <model> --enable-auto-tool-choice --tool-call-parser hermes`, with the parser chosen for the model family (`hermes` for Qwen, `llama3_json` for Llama). Without it: `400 "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set` on every agent request.
- **vLLM, out of memory at startup.** Lower `--gpu-memory-utilization` or `--max-model-len`, or serve a quantized model.
- **Ollama, context.** `OLLAMA_CONTEXT_LENGTH=32768 ollama serve`, or `PARAMETER num_ctx 32768` in a Modelfile plus `ollama create`.
- **Ollama, an instance already running.** Port 11434 in use means reuse it — never kill a serving process you did not start.
- **LlamaFactory, merging.** Merge the adapter into the base weights for standalone serving, never into a quantized base.
- **Registering the result.** `--provider custom --client-type openai --base-url <endpoint>`; a served model is invisible to Penguin until it is added.

</details>

**Two: knowing many tools costs almost nothing per request.** Skills have no dedicated tool and are not concatenated into the prompt. The system prompt template carries a `{{SKILL_METADATA}}` placeholder, and assembly replaces it with one line per installed skill — `` - `vllm` — Deploy and serve LLMs with vLLM behind an OpenAI-compatible endpoint… `` — while the body is read from disk with a shell command only when a task matches. In 0.1.1 that is fifteen skills whose metadata lines total about 2.5 KB, against skill bodies totalling over 100 KB that never enter a context window until they are needed. Deep knowledge of a tool you are not using this turn is not a tax you pay every request.

**Three: it operates the real CLIs, because that is all it has.** A session's built-in tools are `exec_command`, `input_command`, `run_subagent`, `input_subagent` and one image tool. There is no read-file tool, no write-file tool, and no per-vendor integration: `exec_command`'s own description tells the model to read, write and edit files and run programs with the shell. That constraint is the feature here. `vllm serve`, `ollama pull` and `llamafactory-cli train` need no adapter written for them, the flags in the skills are the tools' real flags rather than whatever subset a wrapper exposed, and when vLLM adds a flag next month the fix is a Markdown edit, not a release of this harness.

**Four: the loop closes because registration is part of the job.** Serving a model and *being able to use* it are two different facts, and the gap between them is where most "the agent set it up for me" demos quietly end. The `penguin-cli` skill closes it: it teaches the agent that an endpoint is invisible until `penguin config model add` registers it, and — the part that actually matters — *which* data root to register it into. `--root` must point at the app's own data directory (`--root ./penguin_data`, the same path the app hands `createAgent({ root })`) when the agent is building an app; the default root is for Penguin's own model. So the model the agent just served becomes a model it can then run on, deliberately, in the right place. That is the difference between a loop and a demo.

**Five: measuring is a shipped capability, not an exercise for the reader.** `benchmark-design`, `agent-evaluation` and `agent-optimization` are in the same library, installed the same way. Executing is not improving; "fine-tune it until it passes" needs something that can say *passes*. Part 3 is what those three do.

**Six: the two stories are one story.** The reason the agent can drive these tools at all is that it drives them by running commands on the machine that holds the data. There is no hosted control plane in the middle that would need to see your dataset in order to orchestrate the run. "Local" is not a feature bolted onto this design; it is the same fact as "it can use the real CLI".

**And the honest version of all six.** None of this says another agent cannot do these things. Give any competent shell-using agent the same instructions and it will serve the model too. The difference is smaller and checkable than a superlative: with PenguinHarness those instructions are already installed, cost about 2.5 KB of prompt to have available, and include the registration step that makes the served model usable afterwards. Elsewhere, you are the one who has to know it — and know it again next session.

## 3. "Now fine-tune it until it passes my evaluation"

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

**The agent builds the measurement first.** `benchmark-design` has it lay out a Benchmark: a set of Cases, each with a public statement the tested agent sees and a private rubric it must never see, plus the scoreboard the results land in. Each Case runs more than once by default, because one sample from a nondeterministic local model is not a measurement. `agent-evaluation` runs each of those Case runs in isolation and returns nothing but protocol metadata — a score, a cost, a duration, a session id — which is how the rubric stays out of the tested agent's context.

**Which gives the agent something to read, not just a number.** Every evaluation records the `(provider, model_id)` pair that produced it, so the base model and its tuned successor land on the same scoreboard and compare directly. And every run carries its session id, so the agent can open the exact trace and see which step lost the point. That is the whole reason "fine-tune on what it got wrong" is a sentence with a referent.

**Then it fine-tunes.** The `llamafactory` skill has it confirm four things before training — available GPU memory (LoRA needs far less than full fine-tuning), the base model, the dataset and its format, and the goal, with LoRA SFT as the usual starting point. It registers the dataset in `data/dataset_info.json` in alpaca or sharegpt form, writes a training config derived from the shipped `examples/train_lora/qwen3_lora_sft.yaml`, runs `llamafactory-cli train`, and tries the result interactively before trusting it.

**Then it redeploys and measures again.** The adapter gets merged into the base weights and exported. vLLM serves the export directory directly; Ollama needs an import first. When the agent serves it, the `vllm` skill has already told it the flag that everyone forgets — the tool-calling pair from part 2. The tuned endpoint gets registered as its **own** model id rather than overwriting the base one, precisely so both stay on the scoreboard, and then the same Benchmark runs again.

That is the loop, and none of the steps between "serve" and "measure again" required you to name a command.

**One seam, stated plainly.** Turning failing traces into training examples is the step the skills do *not* prescribe. `llamafactory` asks where your dataset lives and what format it is in; it does not teach an agent to mine a trace into an SFT file. The agent can read the traces, and it can write the conversion script if you ask it to — but that is you directing it, not a skill driving it. Anyone telling you this part is already automatic is selling something.

## 4. Where the human still stands

Three places, and they are not accidents:

- **Approving tool calls.** Every tool call is gated. In the SDK that gate is literally a callback, and omitting it denies everything — the default is refusal, not permission.
- **The judgment calls.** Which base model. Which engine. What "good enough" means. All three serving and tuning skills are written to *ask* rather than assume, and `benchmark-design` requires you to name the agent under test and the capability being measured before it will start. If you also want the agent itself improved rather than the weights, `agent-optimization` works from the same scoreboard — and it refuses to touch Agent State until a snapshot exists to roll back to.
- **The dataset seam** from the end of part 3.

Everything else — which flags, which port, which parser, whether to reuse the running server, what to do about `400 … tools must not be an empty array` (upgrade to 0.1.1, which stopped sending an empty tool list) or an out-of-memory at vLLM startup — is in the skills, which means it is in the agent.

## 5. Data never leaves your environment

This is the reason the whole arrangement is worth the trouble, so it deserves precision rather than a slogan.

**Local, in this setup:**

- **The served model.** Ollama exposes its OpenAI-compatible API on `http://localhost:11434/v1`; vLLM on `http://localhost:8000/v1`. Both are on the machine. Every prompt, tool schema, tool result and completion in an agent session against them stays on the loopback interface.
- **The training.** LlamaFactory runs on your GPU. Your dataset sits under `data/` next to `data/dataset_info.json`; the adapter and the merged export land under `saves/`. No stage of `llamafactory-cli train` ships your examples anywhere.
- **The evaluation.** Cases, statements and rubrics are files in your project — a rubric lives at a path like `~/.penguin/data/default_project/agents/tool-router/benchmarks/tool-routing-v1/CASE-003-pick-the-cheaper-endpoint/rubric/README.md` — and the evaluator reads them from disk. The scoreboard is a YAML file next to them.
- **The configuration.** `penguin config model add` writes into a single hidden project config file. It is CLI-managed, never hand-edited, and it stays where you point it.

**What does cross the network:** installs and weights, coming *in*. `ollama pull`, `pip install vllm`, cloning LlamaFactory, resolving a Hugging Face base model id — all of them download. None of them upload your data. It is worth being clear about the direction, because "local" is often quietly claimed for setups that phone home.

**And the one thing that decides everything else:** the model that drives the agent. If the agent is running on a hosted API, then the conversation itself — your instructions, the file contents it reads, the tool output it summarizes — goes to that vendor, no matter how local the model it is tuning. The fully-local configuration is a deliberate choice you make: point the harness's own default model at the local endpoint too, with the same `penguin config model add ... --set-default`, and the loop runs end to end without a third party in it. It is a real trade-off — a small local model driving the whole loop is not the same proposition as a frontier model driving it — and it should be a decision, not an assumption.

## What actually changed

Before this release, PenguinHarness could talk to any OpenAI-compatible endpoint but had nothing to say about where that endpoint came from. Standing one up, measuring what it could do, and fixing what it could not were three different tools with three sets of conventions, and a human in between translating.

Now they are one system, and the human's job moved. You describe the outcome. The agent serves the model, runs its own benchmark, reads its own failures, tunes, redeploys, and measures again — choosing each next step from the last result. You approve the calls, make the judgment calls, and read the scoreboard.

On your hardware. On your weights. With your data staying where you put it.

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```

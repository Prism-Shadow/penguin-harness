---
title: "Ask the agent to serve, evaluate and fine-tune a local model with Ollama, vLLM and LlamaFactory"
date: 2026-07-22
category: practice
excerpt: "Ask a PenguinHarness agent to serve a model with Ollama or vLLM, measure it with a Benchmark, fine-tune it with LlamaFactory and measure it again. You write two requests, approve tool calls and provide the training data, and with a local model driving the agent, your data never leaves your environment."
---

> Written for PenguinHarness 0.1.1. Later releases may differ in some details.

PenguinHarness 0.1.1 ships three Skills for working with models on your own hardware: `ollama`, `vllm` and `llamafactory`. They are not three more command-line tools for you to learn. They are written for the agent, so that you stop running the commands. You say what you want in a sentence, and the agent picks the tool, asks the questions it is required to ask, runs the commands, checks that they worked and tells you what happened.

In this tutorial you use them to close a training loop on your own hardware. You send the agent two messages: the first asks it to serve a model, the second to fine-tune that model until it passes an evaluation. The agent serves the model, builds a Benchmark and measures a baseline, fine-tunes the model on the training data you point it to, redeploys it and measures again. You answer its questions, approve its tool calls, provide the training data and read the scoreboard. The commands shown along the way are what the agent ran, not a checklist for you.

The tutorial is for anyone who wants to serve, evaluate and fine-tune models on their own hardware and keep their data where they put it. At the end, the base model and its fine-tuned successor are both registered and compared on one scoreboard. If a local model also drives the agent (Step 3), your data never leaves your environment.

Every agent behavior described here is specified by a Skill that ships with PenguinHarness. Skills are plain Markdown files, under `packages/skills/skills/` in 0.1.1, so you can read what the agent will do before you ask. Where a Skill stops and you take over, this tutorial says so.

This is the loop you are about to run:

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

## Prerequisites

- PenguinHarness. This tutorial follows 0.1.1, the release that added the `ollama`, `vllm` and `llamafactory` Skills. Later releases moved the Skills into plugins and changed some names and flag values, so newer versions differ in the details; the agent follows the Skills of the version you install.
- A model configured for the agent itself to run on. It can be a hosted API or a local model; Step 3 explains the difference.
- A machine to serve the model. Ollama is the simple default and the only option on macOS or a CPU-only machine; vLLM is for high-throughput serving on a GPU.
- A GPU for fine-tuning with LlamaFactory. LoRA needs far less GPU memory than full fine-tuning.
- Network access to download installs and model weights. Serving, training and evaluation upload none of your data; the one exception is the model that drives the agent, covered in Step 3.

## Step 1: Install PenguinHarness and open the Web App

Install PenguinHarness and start the Web App:

```bash
curl -fsSL https://github.com/Prism-Shadow/penguin-harness/releases/latest/download/install.sh | sh
penguin web
```

`penguin web` opens the Web App in your browser. The first time, sign in as the built-in admin: in 0.1.1 the login page shows the initial password, while later releases print a one-time sign-in link in the terminal instead. If the model the agent runs on is not configured yet, add it on the Models page and set it as the default model.

Click **New chat**, then set the chat's approval mode to **Ask every time**. A new chat approves every tool call automatically by default; with **Ask every time**, each call waits for your **Allow** or **Deny**, which is how this tutorial keeps you in the loop. You send the next request from this chat.

## Step 2: Ask the agent to serve a local model

Send this message:

> Run a local model on this machine — I don't want the data going anywhere

That sentence is the whole input. The agent loads the `ollama` Skill and works through the rest:

1. It asks two questions before touching anything, because the Skill forbids running any command until the goal is clear. First, which model to run: if you have no preference, it proposes a small default, Qwen3.5-0.8B, and reminds you that the model has to fit the machine's RAM or VRAM. Second, which engine: Ollama is the simple default and the only option on macOS or a CPU-only machine, while vLLM is for high-throughput GPU serving. That choice is yours.
2. It checks the current state. Is Ollama installed, and is something already serving? If port 11434 already has an instance, the agent reuses it and never kills it. The 0.1.1 default system prompt carries the same rule: never kill a process you did not start, and when a port is busy, take another one.
3. It installs Ollama if it is missing, pulls the model, and raises the context window, the step people skip and then spend an afternoon debugging: Ollama's default window is small, and agent Sessions are not. The Skill gives two ways to raise it: `OLLAMA_CONTEXT_LENGTH` in the server environment, or `num_ctx` baked into a model variant with a Modelfile.
4. It verifies the endpoint, and only then registers the model. A pulled model is invisible to PenguinHarness until it is added, and model configuration is the CLI's job:

   ```bash
   # what the agent ran — not a checklist for you
   curl http://localhost:11434/v1/models

   penguin config model add --provider custom --client-type openai \
     --base-url http://localhost:11434/v1 --model-id qwen3.5:0.8b --api-key ollama
   penguin config model list
   ```

You do not run any of these commands. You answer the two questions and approve each tool call as it comes, with **Allow** or **Deny**; the approval mode you set in Step 1 is what makes each call wait for you. In the SDK, the same approval gate is a callback, and an app that supplies none has every tool call denied.

### What the registration command means

The details in that command are decisions, and the `penguin-cli` Skill is where the agent learned them:

- A model in PenguinHarness is the `(provider, model_id)` pair, and the group is never inferred from the id. Gateways resell vendor models under their upstream ids, so a guess could send your key to somebody else's endpoint. `custom` is the group for any endpoint outside the built-in ones.
- `--client-type openai --base-url <endpoint>` is the shape for any OpenAI chat-completion compatible server.
- `--api-key ollama` is not decoration: Ollama accepts any key, but the field must be non-empty.

The Skill also covers two flags that this command does not use:

- `--max-tokens` is a per-model output cap, new in 0.1.1, that overrides the agent default of 32,000. That default does not fit in a 32k window alongside any prompt, so with a small local context window the agent has a reason to set it.
- `--root` chooses the data root. When the agent builds an app, `--root` must point at the app's own data directory (`--root ./penguin_data`, the same path the app hands `createAgent({ root })`). The default root is for the model PenguinHarness itself runs on, and it is where this tutorial registers the model. Registering in the right place is what closes the loop: the model the agent just served becomes a model the agent itself can run on.

## Step 3 (optional): Keep the whole loop local

From the next step on, the agent works with your data: it reads evaluation Cases, Traces and your training set. One choice decides whether any of that leaves your machine: the model that drives the agent. If the agent runs on a hosted API, the conversation itself goes to that vendor, even though the model it tunes is local. That includes your instructions, the file contents the agent reads and the tool output it summarizes.

To keep everything on your machine, make the endpoint the agent just served PenguinHarness's own default model too, with the same `penguin config model add ...` command plus `--set-default`. Ask the agent to run it, or run it yourself. In 0.1.1 a chat keeps the model it started with, so send the Step 4 request from a new chat, and name the model you served, because the new chat does not know what happened in Step 2. The loop then runs end to end without a third party in it.

This is a real trade-off: a small local model driving the whole loop is not the same proposition as a frontier model driving it. Make it a decision, not an assumption.

## Step 4: Ask for a fine-tune that must pass your evaluation

Send the second message:

> Now fine-tune it until it passes my evaluation

This sentence closes the loop, and it works because of the word *evaluation*. Nothing improves itself without a number, and a single run is not a number. So the agent builds the measurement first, with the `benchmark-design` Skill:

- It lays out a Benchmark: a set of Cases, each with a public statement that the tested agent sees and a private rubric that it must never see, plus the scoreboard the results land in.
- It needs the agent under test and the capability being measured, and asks you for either one that is missing.
- Each Case runs more than once by default, because one sample from a nondeterministic local model is not a measurement.
- The `agent-evaluation` Skill runs each Case run in isolation and returns only protocol metadata: a score, a cost, a duration and a Session id. That is how the rubric stays out of the tested agent's context.

The result gives the agent more to read than a number. Every evaluation records the `(provider, model_id)` pair that produced it, so the base model and its tuned successor land on the same scoreboard and compare directly. Every run carries its Session id, so the agent can open the exact Trace and see which step lost the point. That is what gives "fine-tune on what it got wrong" something concrete to refer to.

## Step 5: Provide the training data and fine-tune with LlamaFactory

Before training, the `llamafactory` Skill has the agent confirm four things with you:

- the available GPU memory (LoRA needs far less than full fine-tuning),
- the base model,
- the dataset and its format,
- the goal, with LoRA SFT as the usual starting point.

The dataset is yours to provide. Turning failing Traces into training examples is the one step the Skills do not prescribe: the `llamafactory` Skill asks where your dataset lives and what format it is in, but it does not teach the agent to mine a Trace into an SFT file. Point the agent at your dataset. If you want the failing Traces turned into training data, ask the agent to write the conversion script: it can read the Traces and write the script, but that is you directing it, not a Skill driving it.

Then the agent registers the dataset in `data/dataset_info.json` in alpaca or sharegpt form, writes a training config derived from LlamaFactory's bundled `examples/train_lora/qwen3_lora_sft.yaml`, runs `llamafactory-cli train`, and tries the result interactively before trusting it.

## Step 6: Redeploy and measure again

The agent merges the adapter into the base weights and exports the result. vLLM serves the export directory directly; Ollama needs an import first. When the agent serves the export with vLLM, the `vllm` Skill has already told it the flags everyone forgets: `--enable-auto-tool-choice` and a `--tool-call-parser` matched to the model family.

The agent registers the tuned endpoint as its own model id rather than overwriting the base one, so both stay on the scoreboard. Then the same Benchmark runs again, and you compare the two results on the scoreboard. None of the steps between serving and measuring again required you to name a command.

If you want to improve the agent itself rather than the weights, the `agent-optimization` Skill works from the same scoreboard. It refuses to touch Agent State until a snapshot exists to roll back to.

## How the pieces fit

Three facts explain why the agent can run this loop, and each one is backed by a file you can open.

### The knowledge ships with the agent

In 0.1.1, `packages/skills/skills/vllm/SKILL.md`, `.../ollama/SKILL.md` and `.../llamafactory/SKILL.md` are part of the Skill library, and a Project's `default_agent` is created with the whole library installed. You do not fetch, configure or paste anything. The Skills that measure and improve, `benchmark-design`, `agent-evaluation` and `agent-optimization`, are in the same library and installed the same way. On a fresh install the agent already knows that vLLM must start with `--enable-auto-tool-choice` and a `--tool-call-parser` matched to the model family, or every tool call comes back a `400`; that Ollama's default context window is too small for agent Sessions, and both ways to raise it; and that a LoRA adapter must never be merged into a quantized base. These are the details people otherwise lose an afternoon to.

### Knowing many tools costs almost nothing per request

Skills have no dedicated tool and are not pasted into the prompt. The system prompt template carries a `{{SKILL_METADATA}}` placeholder, which assembly replaces with one line per installed Skill, such as `` - `vllm` — Deploy and serve LLMs with vLLM behind an OpenAI-compatible endpoint… ``. The agent reads a Skill's body from disk with a shell command only when a task matches. In 0.1.1 that is fifteen Skills whose metadata lines total about 2.5 KB, while their bodies total over 100 KB and stay out of the context window until they are needed.

### The agent operates the real CLIs

In 0.1.1, a Session's built-in tools are `exec_command`, `input_command`, `run_subagent`, `input_subagent` and one image tool. There is no read-file tool, no write-file tool and no per-vendor integration: `exec_command`'s own description tells the model to read, write and edit files and run programs with the shell. So `vllm serve`, `ollama pull` and `llamafactory-cli train` need no adapter, the flags in the Skills are the tools' real flags, and when vLLM adds a flag, the fix is a Markdown edit, not a release of the harness. This is also why the loop can stay local: the agent runs commands on the machine that holds the data, with no hosted control plane in between that would need to see your dataset.

Another capable agent with a shell could do these things too, given the same instructions. The difference is that in PenguinHarness the instructions are already installed, cost about 2.5 KB of prompt, and include the registration step that makes a served model usable afterwards. Elsewhere you have to know all of it yourself, again in every Session.

## Troubleshooting

The failures below are already written into the Skills, so the agent knows how to handle them. They are listed here so you recognize them when they appear in a Session:

- vLLM rejects every tool call: the server was started without the tool-calling flags. Restart it with `vllm serve <model> --enable-auto-tool-choice --tool-call-parser hermes`, choosing the parser for the model family (`hermes` for Qwen, `llama3_json` for Llama). Without it, every agent request fails with `400 "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set`.
- vLLM runs out of memory at startup: lower `--gpu-memory-utilization` or `--max-model-len`, or serve a quantized model.
- Ollama's context window is too small: start the server with `OLLAMA_CONTEXT_LENGTH=32768 ollama serve`, or put `PARAMETER num_ctx 32768` in a Modelfile and run `ollama create`.
- Ollama is already running: port 11434 in use means reuse the instance, and never kill a serving process you did not start.
- Merging a LoRA adapter: merge the adapter into the base weights for standalone serving, but never into a quantized base.
- A served model does not show up in PenguinHarness: it stays invisible until it is added, so register it with `--provider custom --client-type openai --base-url <endpoint>`.

One more error comes from the harness rather than from a Skill. Before 0.1.1, requests that carried no tools still sent an empty tool list, which vLLM rejects with `400 … tools must not be an empty array`; 0.1.1 stopped sending it, so upgrading fixes the error.

## What stays on your machine

In this setup, these stay local:

- The served model. Ollama exposes its OpenAI-compatible API on `http://localhost:11434/v1`, and vLLM on `http://localhost:8000/v1`. Every prompt, tool schema, tool result and completion in an agent Session against them stays on the loopback interface.
- The training. LlamaFactory runs on your GPU. Your dataset sits under `data/` next to `data/dataset_info.json`, and the adapter and the merged export land under `saves/`. No stage of `llamafactory-cli train` ships your examples anywhere.
- The evaluation. Cases, statements and rubrics are files in your Project, and the evaluator reads them from disk. A rubric lives at a path like `~/.penguin/data/default_project/agents/tool_router/benchmarks/tool-routing-v1/CASE-003-pick-the-cheaper-endpoint/rubric/README.md`, and the scoreboard is a YAML file next to them.
- The configuration. `penguin config model add` writes into a single hidden Project config file. The CLI manages it, it is never edited by hand, and it stays where you point it.

If a local model drives the agent, only installs and weights cross the network, and they come in. `ollama pull`, `pip install vllm`, cloning LlamaFactory and resolving a Hugging Face base model id all download; none of them upload your data. If a hosted model drives the agent, the conversation also goes to that vendor, as Step 3 describes.

## Wrap-up

Before 0.1.1, PenguinHarness could talk to any OpenAI-compatible endpoint but had nothing to say about where that endpoint came from. Standing one up, measuring what it could do and fixing what it could not were three tools with three sets of conventions, and a person in between translating.

In this tutorial you described two outcomes. The agent served a model, ran its own Benchmark, read its own failures, fine-tuned, redeployed and measured again, choosing each next step from the last result. You stayed in the loop in three places: approving tool calls, making the judgment calls (which base model, which engine, what counts as good enough), and providing the training data. Everything else, from flags and ports to parsers and whether to reuse a running server, is in the Skills, which means it is in the agent.

Where to go next:

- Read the Skills the agent had available, as they shipped in 0.1.1, under [`packages/skills/skills/`](https://github.com/Prism-Shadow/penguin-harness/tree/v0.1.1/packages/skills/skills).
- If a hosted model drove the agent this time, run the loop again with a local model driving it, as described in Step 3.

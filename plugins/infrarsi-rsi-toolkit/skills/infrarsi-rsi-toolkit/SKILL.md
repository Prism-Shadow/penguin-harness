---
name: infrarsi-rsi-toolkit
description: Speed up an existing GPU training job with InfraRSI, running the upstream engine and its infrarsi-optimize Skill at a pinned commit, with every search request answered by a fresh subagent and only verified changes reported. Use when asked to make a training job faster, raise its MFU or throughput, or tune its launch settings and hot-path code without changing what it trains.
version: 2026.11.13.1
---

# InfraRSI

[InfraRSI: Harnessing Recursive Self-Improvement for Training Infrastructure](https://arxiv.org/abs/2611.11558) improves the infrastructure around a training job that already runs. Its engine fixes a task contract (same data, model, batch, precision rules and optimizer steps), measures the reference run and its noise, and searches launch settings and code patches with B-Comp. Every candidate is a real training run checked against the reference; the winner is re-run back to back with the original, and only verified results enter an experience library that orders the next job's search. The goal is one number: the time one optimizer update takes.

This toolkit runs the [upstream engine and its `infrarsi-optimize` Skill](https://github.com/TokenRhythm/InfraRSI/tree/512f8ea784054f4ca3331d03cc6589267a4cbdf5) unchanged. It supplies only what PenguinHarness needs around them: fetching the pinned build, the subagent that answers the engine's requests, the tools' time limits, and the go-aheads the engine needs.

## Before you start

You need a training job that already runs, on this machine or on SSH hosts, and the command that starts it today. If the request only names this Skill, ask for the project directory and that command. If the job does not run as it is, fix that with the user first.

The engine runs with the training environment's Python: 3.11 or newer with PyYAML, or 3.10 with PyYAML and `tomli`. Fetching needs `git` and access to GitHub once.

## Fetch the pinned engine

| Item | Value |
| --- | --- |
| Repository | `https://github.com/TokenRhythm/InfraRSI` |
| Commit | `512f8ea784054f4ca3331d03cc6589267a4cbdf5` |
| Engine | `infrarsi` 0.3.0 |

Build the upstream Skill once per machine, outside the user's project and outside the engine's home directory:

```bash
SRC="${XDG_CACHE_HOME:-$HOME/.cache}/penguin-infrarsi/512f8ea7"
if [ ! -d "$SRC/.git" ]; then
  rm -rf "$SRC" && git clone https://github.com/TokenRhythm/InfraRSI.git "$SRC"
fi
git -C "$SRC" checkout --detach 512f8ea784054f4ca3331d03cc6589267a4cbdf5
<python> -I "$SRC/agent_skill/build_skill.py" --out "$SRC/dist"
```

Run these lines as they are, in one command; do not create `$SRC` or `dist` beforehand. `<python>` is the training environment's interpreter. The built Skill is `SKILL_DIR="$SRC/dist/infrarsi-optimize"`; check that `$SKILL_DIR/scripts/engine/VERSION.json` names the pinned commit without `+changes`. Do not run `install_skill.py`: it writes Claude Code and Codex directories this Session does not use. Do not edit anything under `$SRC`.

The upstream repository carries no license file. This toolkit does not redistribute its code or text; the user's machine fetches them from upstream. Say so in the report.

## Follow the upstream Skill

Read `$SKILL_DIR/SKILL.md` and the references it names, and follow its rules and workflow exactly: numbers come only from the engine, the contract is fixed before the search, you never answer the engine's requests, the engine schedules, and failures are data. `infrarsi` in those files means `<python> "$SKILL_DIR/scripts/infrarsi.py"`, run from the project directory.

Make these substitutions for PenguinHarness:

| Upstream says | Here |
| --- | --- |
| `<skill-dir>`, `${CLAUDE_SKILL_DIR}` | `$SKILL_DIR` |
| `--model <your model name>` | This Session's model id from the Environment section |
| The Agent tool, `spawn_agent`, `codex exec` | `run_subagent`, as described below |
| Give your shell tool a timeout above 9 minutes | `exec_command` waits at most two minutes: call `infrarsi agent next --wait 100`. Start `infrarsi doctor` and other commands that last longer with `run_in_background` |
| Agree the contract and the apply step with the user | Ask in the conversation. A quick-start prompt agrees to neither; it never loosens the contract or applies a change |

### Answer each request with a fresh subagent

When `infrarsi agent next` returns `"state": "request"`:

1. Start a **new** `run_subagent` session. Omit `agent_id`, `provider`, `model_id` and `thinking_level`, so the answerer runs on this Session's model: the engine weighs answers by the model named in `--model`. Never send a request to a cheaper model, and never continue an earlier answerer with `input_subagent`.
2. Its prompt is the line `Caller agent: <your agent id>`, then the prompt in the *The prompt* section of `$SKILL_DIR/references/answering.md` with the request's id, directory and answer file filled in, then the rules in [answerer.md](references/answerer.md). Add nothing else: no advice, numbers, file contents or view of the job.
3. Hand the answer in with `infrarsi agent answer <id> --by <model id>`, adding `--tokens N` when the `run_subagent` result reports the tokens used. Follow the answering reference's table for refused answers: a refused answer gets another new subagent with the feedback line it gives.

If `run_subagent` is not in your tool list, you are a subagent yourself: do not answer the request. Run `infrarsi agent stop` and report that this Session cannot start an independent answerer.

### Go-aheads and the engine's home

The engine writes its experience library, cost ledger and signing key under `$INFRARSI_HOME`, by default `~/.infrarsi`, and its runs under the project's `.infrarsi/`. When a command policy or sandbox stops `infrarsi agent start` or `infrarsi agent resume` from writing there, ask the user for a go-ahead to run that command as it is, or to choose an `INFRARSI_HOME` they allow. Never create or edit the files in that directory yourself.

## Report

Report from `infrarsi report <run_dir>` and `infrarsi agent status` only: the original and new time per update (and MFU when reported), the speed-up of the back-to-back re-run, what changed, what was rejected and why, the checks the logs could not support, and the cost. Add the pinned commit and engine hash from `VERSION.json`, the model, the number of requests answered with their subagent tokens, and the GPUs used. A run that ends with `no_change` keeps the current configuration (×1.00); say so.

## Trying the setup

Upstream's `examples/toy_cpu` is a simulated job that needs neither a GPU nor PyTorch. To check the whole loop end to end, copy it from `$SRC` to a scratch directory and run the workflow there with a small budget, for example `--screens 4`. Its speed-ups are simulated; a real result needs a real training job.

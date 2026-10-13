---
title: "Pick an algorithm and let your agent evolve itself on a Benchmark"
date: 2026-10-13
category: practice
excerpt: "Pick one of the five self-evolution algorithms in PenguinHarness 0.2.14, run it against your own agent on the built-in GDPevo Benchmark, read the result in the Evaluation Center, and keep or roll back the new version."
---

PenguinHarness 0.2.14 ships five self-evolution algorithms as plugins, the RSI toolkits, and gives every new Project seven built-in Benchmarks to run them on. An RSI toolkit changes your agent's harness (its prompts and Skills) while the model stays fixed, and measures every change on a Benchmark.

In this tutorial you run one optimization of your own agent on GDPevo Train, read the result in the Evaluation Center, and decide whether to keep the new version.

## Prerequisites

- PenguinHarness 0.2.14 and a Project created with it. The built-in Benchmarks are written when a Project is created; in an older Project, open **New chat** and pick **Import the GDPevo benchmark** under **Evaluate and optimize agents**.
- A model with its API key saved on the **Models** page.
- An agent of your own on the **Agents** page. The screenshots use one called Business Analyst (`biz_analyst`).
- Docker with Compose v2 and [uv](https://docs.astral.sh/uv/) on the machine PenguinHarness runs on, with access to GitHub, Docker Hub, nodejs.org, the npm registry and your model provider. Every case of a built-in Benchmark runs as a [Harbor](https://github.com/harbor-framework/harbor) task in Docker.

## Step 1: Pick an algorithm

Open **Plugins**. The **Agent Self-Evolution** category holds the five toolkits:

- `default-rsi-toolkit`: trial, reflect, improve. One hypothesis and one change per round; a version is kept only if the score strictly rises.
- `opro-rsi-toolkit` ([OPRO](https://arxiv.org/abs/2309.03409)): proposes new instructions from the history of scored instructions.
- `ape-rsi-toolkit` ([APE](https://arxiv.org/abs/2211.01910)): induces candidate instructions from input/output examples in one pass.
- `ace-rsi-toolkit` ([ACE](https://arxiv.org/abs/2510.04618)): a Reflector reads training Traces and a Curator folds the lessons into a playbook.
- `awm-rsi-toolkit` ([AWM](https://arxiv.org/abs/2409.07429)): induces workflows from successful trajectories into the agent's memory.

![The Agent Self-Evolution category on the Plugins page, with the five RSI toolkits](/blog-assets/penguinharness-0-2-14-rsi-plugins-en.png)

The toolkit has to be installed on the agent that runs it, not on the agent being improved. By default that is General Agent, and in a Project created with 0.2.14 it has all five. In an older Project, or to run a toolkit from another agent, install it on that agent from the toolkit's card. This tutorial uses the default toolkit; the other four are picked the same way in Step 4.

## Step 2: Open GDPevo Train

Open **Evaluation Center**. A new Project lists PenguinHarness Benchmark Sec A to Sec E and the GDPevo pair. GDPevo is built for self-evolution: optimize on GDPevo Train, then check on GDPevo Test, 30 held-out tasks in the same six company environments.

![The Evaluation Center listing the built-in Benchmarks](/blog-assets/penguinharness-0-2-14-benchmarks-en.png)

## Step 3: Take a baseline

The default toolkit compares every candidate with your agent's last score, so it needs one first. The other four toolkits measure their own baseline; skip this step for them.

1. On GDPevo Train, select **Use**. The dialog opens on **Evaluate**.
2. In **Tested agent**, pick your agent.
3. In **Model of the evaluation conversation**, pick the model to test on. Your agent runs on it, at the thinking level the agent is configured with.
4. Select **Edit in a new conversation**, then send.

Each case is one Harbor trial, four at a time, and a trial takes from a few minutes to about an hour.

## Step 4: Start the optimization

1. Select **Use** again and open the **Optimize** tab.
2. In **Method**, pick the toolkit. The list is read from the plugin library each time the dialog opens.
3. In **Tested agent**, pick your agent. With the default toolkit, the tab shows its current baseline and the target.
4. Leave **Optimizer agent** as General Agent, or pick another agent that has the method's Skill.
5. For the default toolkit, set **Round limit** (3 by default) and **Target score** (the baseline rounded up, plus 10). The other toolkits hide both and run their paper's defaults reduced to a smoke budget, unless **Focus** says otherwise.
6. Select **Edit in a new conversation**, read the prompt, and send it.

![The Optimize tab with the Method list open](/blog-assets/rsi-toolkits-method-en.png)

## Step 5: Follow the round

Each round of the default toolkit reads the scores and the Traces, states one falsifiable hypothesis, snapshots the current version to `snapshots/v<N>.tar.gz`, and makes one change under the next version number. It then starts one evaluator subagent per case and run, on the model and thinking level of the baseline. The version is kept only if its total is strictly higher; otherwise the change is rolled back.

![An optimization round: the change, the evaluation of all 30 cases, and the scores before and after](/blog-assets/rsi-toolkits-optimize-chat-en.png)

## Step 6: Read the result

Open the Benchmark's page. **Score over time** draws one line per agent, model and thinking level. A kept version is a new point on its line, with the version in the hover text and in the **Version** column. Runs of different toolkits on the same agent, model and thinking level share a line, and the version of each point tells them apart.

![Score over time for three agents on GDPevo Train, and the evaluations table](/blog-assets/penguinharness-0-2-14-benchmark-detail-en.png)

Select a row under **Evaluations** to see every case and run. A run recorded as a Harbor trial has a button that copies the trial's name; the trial's files stay in the Benchmark's `.jobs/` directory.

![The scores of one evaluation, case by case](/blog-assets/rsi-toolkits-evaluation-en.png)

## Step 7: Keep or roll back

- **Keep.** The version a run ends on is already the agent's current version. To see whether the gain holds on tasks the agent has not seen, evaluate it on GDPevo Test on the same model (Step 3).
- **Roll back.** Open the agent from **Agents**, and under **Agent State** select **Import snapshot**. Choose `snapshots/v<N>.tar.gz` from the agent's directory, copied to your computer first if PenguinHarness runs elsewhere. Only the Project owner can import. Every import asks for confirmation, and a snapshot that is not newer than the current version asks a second time. The current version is snapshotted first, and the Vault is kept.

## Limits

- One candidate on GDPevo Train is 30 Harbor trials at one run per case, and each trial costs model tokens.
- Trials run four at a time unless you name another limit (in the evaluation's **Note**, for example), eight at most.
- During a GDPevo task the agent can reach only the model provider's API host, because GDPevo's answers are public.
- An agent created before 0.2.14 does not have the OPRO, APE, ACE and AWM toolkits until you install them, and a new agent has only the plugins picked when it was created.

For every field of the dialog, see the [Evaluation Center documentation](https://penguin.ooo/docs/evaluation-center). For how each algorithm runs, see [RSI toolkits](https://penguin.ooo/docs/self-improvement#rsi-toolkits).

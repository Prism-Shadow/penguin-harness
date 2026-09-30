---
title: "Create, evaluate and evolve as many agents as you like"
date: 2026-09-16
category: practice
excerpt: Have AI write a Benchmark and take a baseline score, ask AI what a case tests, replace the Benchmark when it needs to change, then evaluate your agents and optimize them, with an Optimizer that improves the agent and an Evaluator that scores it strictly.
---

Most agent projects stall at the same point: you change a prompt, try two or three questions by hand, and cannot tell whether the agent got better or you got lucky. The Evaluation Center in PenguinHarness replaces that guesswork with a repeatable loop.

A Benchmark is a set of cases, each with a scoring rubric. You evaluate an agent against a Benchmark to get a score, and you can let AI optimize the agent against it. Each agent and each Benchmark is a directory in your Project, and there is no limit on how many of either you create.

This tutorial is for anyone who runs agents in PenguinHarness and wants to know whether a change actually helped. In it, you will:

- have AI write a Benchmark for an agent and take its first score;
- open a case and ask AI what it is testing;
- replace the Benchmark with an improved one, and delete the old one;
- evaluate an agent, then optimize it, and read the results.

By the end, you will have a published Benchmark, a chart that compares every version you have tested, and, if an optimization round beats the baseline, an improved version of your agent.

## Prerequisites

- PenguinHarness 0.2.13 or later, as the desktop app or the Web App.
- A model configured on the **Models** page.
- An agent to test: any agent you created on the **Agents** page, or **General Agent** (`default_agent`), the agent every Project starts with.

The agent that carries out each step needs the Skills from the `agent-tuning` plugin: `benchmark-design`, `agent-evaluation` and `agent-optimization`. General Agent has them preinstalled, and the dialogs below pick it by default.

## How the loop fits together

The Evaluation Center divides the work among four roles:

| Role | What it does | What it may not do |
| --- | --- | --- |
| Builder | Writes the cases and rubrics, trial-runs them to calibrate difficulty, and records the baseline score. | Change the agent under test. |
| Agent under test | Works on one case at a time, in a fresh Workspace that holds only the case's task materials. | See the rubric. |
| Evaluator | Runs the agent under test once on one case, and scores the result strictly against the rubric. | Change the agent or the Benchmark. |
| Optimizer | Reads the scores, the case statements and the Traces of the test runs, and changes the agent one hypothesis at a time. | Read rubrics, reference answers or the Evaluator's reasoning. |

You start the Builder and the Optimizer from the Evaluation Center's dialogs, each in a conversation of its own. An evaluation also runs in a conversation you start, where the **Evaluator agent** coordinates the work. Each Evaluator that scores a run is a subagent: an evaluation, or a round of optimization, sends out one Evaluator for every case and run.

![What the Optimizer and the Evaluator can read and change](/blog-assets/evaluation-center-roles-en.png)

The Evaluator and the Optimizer pull in opposite directions on purpose. The Evaluator judges strictly, against a rubric the Optimizer never reads. The Optimizer tries as hard as it can to raise the score, but because it cannot see how answers are graded, the dependable way to raise the score is to make the agent better at the task.

## Step 1: Open the Evaluation Center

The tutorial starts on the Evaluation Center page. In the sidebar, select **Evaluation Center**.

The page has three cards that summarize the workflow (**Create**, **Evaluate**, **Optimize**), followed by the Project's Benchmarks. Each Benchmark card shows its number of cases, the agents it has tested, a score trend and the latest score.

![The Evaluation Center with its three workflow cards and a list of Benchmarks](/blog-assets/evaluation-center-overview-en.png)

## Step 2: Create a Benchmark with AI

In this step, AI writes your first Benchmark: a set of cases with rubrics, calibrated so your agent has room to improve.

1. At the top right, select **Create with AI**.
2. In **Test Agent**, pick the agent the cases are for.
3. Describe the capability and the scenarios you want to test, or select one of the examples under **Try an example**. A good description names what makes the task hard: conflicting sources, missing information, strict formats.
4. Select **Edit in a new conversation**.

![The Create a Benchmark with AI dialog](/blog-assets/evaluation-center-create-with-ai-en.png)

PenguinHarness opens a new conversation with the full prompt filled in and the `benchmark-design` and `agent-evaluation` Skills selected. Nothing is sent yet, so you can still edit the prompt.

Before you send, check the model in the message box's toolbar. The Builder runs the agent under test on this conversation's model for its trial runs and for the baseline. Evaluations you start later from the **Evaluate** tab run the agent on the model it is configured with, and the chart draws a separate line for each model. To keep the baseline and your later scores on one line, pick the model the agent is configured with. When the prompt and the model are right, send the message.

The Builder now writes about three cases, each with a statement for the agent and a rubric worth 100 points. It trial-runs the cases and adjusts them for up to four rounds, aiming for a baseline below 50, because a Benchmark the agent already passes cannot show improvement. Each case runs once per trial. While this runs, the new Benchmark's card is marked **Being built**. When calibration finishes, the Builder records the agent's first score, the baseline, and publishes the Benchmark, as long as the baseline is below 85.

## Step 3: Read the Benchmark

Before you rely on any score, look at what the Builder produced. Select **View** on the Benchmark's card. The Benchmark page shows:

- **Cases**: every case in the Benchmark.
- **Score over time**: each point is one evaluation. Evaluations of the same agent on the same model and thinking level form one series, so you can follow an agent's versions over time.
- **Evaluations**: every evaluation, newest first, with the tested agent, its version, model, thinking level, score, cost and duration. Select a row to see the score of each case and each run.

![A new Benchmark's page: its cases, the baseline on the score chart, and the evaluation table](/blog-assets/evaluation-center-benchmark-detail-en.png)

You will come back to the **Score over time** chart in Step 8, once it has more results on it.

## Step 4: Ask AI what a case is testing

A score only helps if you understand what earned it. In this step you open one case and ask AI to explain what it measures.

1. Next to a case, select **View details**. The case opens in a file browser with two folders: **Task materials**, which is what the agent under test receives, and **Scoring rubric**, marked **Hidden from Target Agent**.
2. Select **Ask AI**.
3. The suggested question is **Explain what this case tests and what a strong answer looks like**. Keep it, or pick another example, such as **What does the rubric reward?**
4. Select **Edit in a new conversation** and send the message.

![A case opened in the Benchmark, with its task materials, its hidden rubric and the Ask AI button](/blog-assets/evaluation-center-case-en.png)

The agent receives the paths to the statement and the rubric, reads both, and explains the case in plain language. It only reads the case; it does not change it.

## Step 5: Replace the Benchmark with a better one

This step is optional: follow it when the Benchmark itself needs to change. A Benchmark's cases are frozen once it exists: neither the Web App nor the API edits a statement or a rubric. This keeps every score on one Benchmark comparable. To change the cases, you create a new Benchmark and retire the old one.

1. Ask AI what should change. On a case, the example question **How could the statement be clearer?** asks exactly that, and the answer describes how to write the case in the next Benchmark.
2. Select **Create with AI** again and pick the same **Test Agent**. In the description, name the new Benchmark and the one it replaces, and list the changes you want, for example: "Create `report-writing-v2`, based on `report-writing-v1`. Keep its three cases, make the expected length in case 2 explicit, and make the citation format in case 3 stricter."
3. Send the message and let the Builder create and calibrate the new Benchmark. It records a new baseline on it.
4. When the new Benchmark is published, go back to the Evaluation Center, select the trash icon on the old Benchmark's card, and select **Delete** to confirm. Only the Project owner can delete a Benchmark.

> **Deletion is permanent.** Deleting a Benchmark removes its cases and evaluation records. They cannot be restored.

## Step 6: Evaluate an agent

Evaluating gives an agent a score on a Benchmark. Use it to score another agent you want to compare, or the same agent after you changed it by hand.

1. On the Benchmark's card or page, select **Use**, then the **Evaluate** tab.
2. In **Tested agent**, pick the agent to score.
3. Leave **Evaluator agent** as **General Agent**, or pick another agent that has the `agent-evaluation` Skill.
4. Optionally change **Model of the evaluation conversation**, **Runs per case** and **Note**. That model runs the Evaluator agent's own conversation; the agent under test runs on the model it is configured with. **Runs per case** starts at the Benchmark's own count, which is 1 for a Benchmark built with AI; more runs average out lucky and unlucky runs.
5. Select **Edit in a new conversation**, then send.

![The Use dialog on its Evaluate tab](/blog-assets/evaluation-center-use-evaluate-en.png)

The Evaluator agent sends out one Evaluator subagent for every case and run. Each one gives the agent under test a fresh Workspace that contains only the case's task materials, runs it, and scores the result against the rubric. When all runs finish, the Evaluator agent averages the scores and records the evaluation. It appears on the chart as a new point, labelled with the agent, its model and its thinking level.

> **Where the conversations go.** The conversations an evaluation creates are filed under the **Evaluations** folder in the sidebar, so they do not crowd the agent's own conversation list.

## Step 7: Optimize an agent

Optimization needs a baseline for the agent on this Benchmark. If the agent was the **Test Agent** when the Benchmark was built, it already has one. Otherwise, evaluate it first (Step 6). The **Optimize** tab warns you when the selected agent has no baseline yet.

1. Select **Use**, then the **Optimize** tab.
2. In **Tested agent**, pick the agent to improve. The tab shows the current baseline and the target score.
3. Leave **Optimizer agent** as **General Agent**, or pick another agent that has the `agent-optimization` and `agent-evaluation` Skills.
4. Set **Round limit** (default 3) and **Target score** (by default, ten points above the baseline).
5. Optionally describe a **Focus**, for example "Focus on citation rules; leave the writing style alone."
6. Select **Edit in a new conversation**, then send.

![The Use dialog on its Optimize tab, with the current baseline and the target score](/blog-assets/evaluation-center-use-optimize-en.png)

Every evaluation during optimization runs the agent on the model and thinking level its baseline recorded, whichever model the Optimizer's own conversation uses. Each round follows the same pattern:

1. The Optimizer reads the latest scores and the Traces of the test runs, and forms one falsifiable hypothesis about why the agent loses points.
2. It makes sure a snapshot of the current version exists, then makes one change: the agent's instructions, a focused Skill, or a safe configuration field.
3. Evaluator subagents run the full Benchmark against the changed agent.
4. If the total score is strictly higher, the change is kept as a new version of the agent. Otherwise the Optimizer restores the snapshot and tries a different hypothesis in the next round.

![One optimization round: the Optimizer changes the agent, the Evaluator scores the candidate, and the change is kept only if the score rises](/blog-assets/evaluation-center-optimize-round-en.png)

The loop stops when the agent reaches the target score or the round limit runs out. Rejected attempts never reach the Benchmark's records; the conversation reports every round, including the ones that failed.

The separation between the two roles is written into their Skills. An Evaluator copies only the case's task materials into the test Workspace and keeps rubrics, reference answers and its scoring reasoning private. The Optimizer is instructed not to open rubrics or evaluation files, and to stop if private evaluation information ever reaches its context. Every read and every change is recorded in the Traces, so you can audit a run afterwards.

## Step 8: Compare agents and keep improving

Back on the Benchmark page, each kept version appears as a new point in the agent's series. In the example below, version 2 raised the score from 43.33 to 48.33, and version 3 reached 55, above the target of 54, so the loop stopped there. Evaluate other agents, or the same agent on a different model or thinking level, and each gets its own series on the same chart.

![Score over time after optimization, with a second agent evaluated on the same Benchmark](/blog-assets/evaluation-center-results-en.png)

Some ways to keep going:

- **Ask AI about an evaluation.** Select a row in **Evaluations**, then **Ask AI**, and try **Which cases are weakest, and what should change?**
- **Try more agents.** Create agents with different instructions or models on the **Agents** page, and evaluate each one on the same Benchmark.
- **Go back to an earlier version.** Each version the Optimizer changed leaves a snapshot, `snapshots/v<N>.tar.gz`, in the agent's directory. To restore one, open the agent's settings, select **Import snapshot** and choose that file; if PenguinHarness runs on another machine, copy the file to your computer first. Importing an older version asks you to confirm, and only the Project owner can import.

## Troubleshooting

- **A Benchmark card shows Creation failed.** Calibration produced no valid trial run, or the agent still scored 85 or more after the last round, so the Benchmark cannot be evaluated or optimized. Check the building conversation for failed trial runs, then delete the Benchmark and create it again, asking for harder cases if the agent scored too high.
- **The Use dialog warns that an agent lacks a Skill.** The Evaluator or Optimizer agent you picked is missing `agent-evaluation` or `agent-optimization` and will most likely not finish. Switch back to **General Agent**, or install the `agent-tuning` plugin on that agent.
- **The Optimize tab says the agent has no baseline.** Evaluate the agent on the **Evaluate** tab first (Step 6).
- **The baseline and later evaluations are on separate lines.** They ran on different models: the baseline on the model of the conversation that built the Benchmark, and evaluations from the **Evaluate** tab on the agent's configured model. See Step 2.

## Wrap-up

You had AI build a Benchmark and take a baseline, asked AI to explain a case, replaced the Benchmark with a better one, evaluated an agent, and let the Optimizer improve it against a strict Evaluator. Every case, score and version is a file in your Project, so you can inspect, back up and version all of it.

For every option in these dialogs, see the [Evaluation Center documentation](https://penguin.ooo/docs/evaluation-center). For the design of the loop, read [Self-improvement](https://penguin.ooo/docs/self-improvement).
